import {
  ConflictException,
  GoneException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { ExtractedCvProfileDto } from '../../candidates/dto/extracted-cv-profile.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { AudioStorageService } from '../../shared/audio/audio-storage.service';
import { GroqAudioService } from '../../shared/audio/groq-audio.service';
import { CandidateStatus, toCandidateStatus } from '../candidate-status.util';
import {
  BASE_QUESTION_COUNT,
  COMPOSITE_SCORE_WEIGHTS,
  MAX_FOLLOWUPS,
  MAX_TOTAL_QUESTIONS,
} from '../interview.constants';
import { MAX_INTERVIEW_WARNINGS, riskLevelFor } from '../violation.util';
import {
  InterviewOrchestratorService,
  NextTurnResult,
  SkillEvidenceGroup,
} from './interview-orchestrator.service';

export type ViolationType =
  | 'FACE_MISSING'
  | 'MULTIPLE_FACES'
  | 'LOOKING_AWAY'
  | 'MOBILE_DETECTED'
  | 'TAB_SWITCH'
  | 'FULLSCREEN_EXIT'
  | 'WINDOW_BLUR'
  | 'CAMERA_DISABLED'
  | 'MICROPHONE_DISABLED'
  | 'BROWSER_CLOSED'
  | 'SHORTCUT_ATTEMPTED';

export interface ViolationSummary {
  counts: Partial<Record<ViolationType, number>>;
  total: number;
  riskLevel: ReturnType<typeof riskLevelFor>;
}

export interface LogViolationResult extends ViolationSummary {
  /** True if this report pushed the session into an early forced completion. */
  forced: boolean;
}

export interface UploadedAudio {
  buffer: Buffer;
  originalname: string;
}

export interface InterviewTurnView {
  questionId: string;
  sequenceOrder: number;
  questionText: string;
  questionAudioUrl: string;
}

export interface SkillResultView {
  skillName: string;
  proficiencyScore: number;
  justification: string;
}

// Deliberately score-free — candidates never see their interview score or
// per-skill breakdown (same "don't expose scoring" stance as the CV match
// score), only a plain confirmation that their interview was recorded.
// Staff get the real numbers via getTranscript()/InterviewTranscriptView.
export interface InterviewResultView {
  status: 'COMPLETED';
  message: string;
}

export interface InterviewStatusView {
  applicationStatus: string;
  /** Closed 7-value candidate-facing badge — see candidate-status.util.ts. */
  candidateStatus: CandidateStatus;
  message: string;
  interviewDeadline?: Date;
  currentQuestion?: InterviewTurnView;
  result?: InterviewResultView;
  /** CV processing failed permanently — nothing will change without a fresh upload; lets pollers stop. */
  terminal?: boolean;
  /** Only present once an AIInterviewSession exists — lets the frontend rehydrate its warning count after a refresh. */
  violations?: ViolationSummary;
}

export interface TranscriptQuestionView {
  sequenceOrder: number;
  questionText: string;
  expectedCore: string;
  answerText: string | null;
  targetSkillName: string | null;
  isFollowUp: boolean;
  askedAt: Date | null;
  answeredAt: Date | null;
}

export interface InterviewTranscriptView {
  sessionStatus: string;
  overallScore: number | null;
  /** Interview-level hire/no-hire-leaning call (STRONG_HIRE/HIRE/NO_HIRE/STRONG_NO_HIRE) — distinct from MatchResult's CV-match recommendation. */
  recommendation: string | null;
  /** Narrative summary of the whole session, not just per-skill scores. */
  summary: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  /** Set only if this session was auto-submitted early by the proctoring system rather than completed naturally. */
  terminationReason: string | null;
  questions: TranscriptQuestionView[];
  skillGrades: SkillResultView[];
  violations: ViolationSummary;
}

const invitePlainMessage = (deadline: Date): string =>
  `Congratulations — your application passed our initial screening. Please complete a short AI-conducted technical interview before ${deadline.toISOString()}.`;

const rejectionPlainMessage =
  "Thank you for applying. After careful review, we've decided not to move forward with your application at this time.";

const interviewSubmittedMessage =
  'Your interview has been completed and is under review.';

// After the interview finishes, the application keeps moving (manager
// review, then a final decision) but the AI session itself stays
// COMPLETED — so this picks the message off the current application
// status instead of freezing on the interview-just-finished text.
const postInterviewMessage = (applicationStatus: string): string => {
  switch (applicationStatus) {
    case 'MANAGER_REVIEW':
    case 'MANAGER_REVIEWED':
      return 'Your interview is complete and your application is in final review.';
    case 'SELECTED':
    case 'HIRED':
      return "Congratulations — you've been selected for this position. Our team will be in touch shortly with next steps.";
    case 'NEXT_ROUND':
      return "You've been invited to a further interview round. Please check your email for details.";
    case 'REJECTED':
      return "Thank you for the time and effort you invested throughout the interview process. After careful consideration, we've decided not to move forward with your application.";
    case 'WITHDRAWN':
      return 'You withdrew this application.';
    default:
      return interviewSubmittedMessage;
  }
};

@Injectable()
export class InterviewSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audio: GroqAudioService,
    private readonly storage: AudioStorageService,
    private readonly orchestrator: InterviewOrchestratorService,
  ) {}

  async start(applicationId: string): Promise<InterviewTurnView> {
    const { application, session } = await this.loadContext(applicationId);

    if (await this.expireIfNeeded(session, applicationId)) {
      throw new GoneException(
        'The interview window for this application has expired.',
      );
    }

    if (session.status === 'IN_PROGRESS') {
      const pending = session.questions.find((q) => !q.answeredAt);
      if (pending) return this.toTurnView(pending);
      throw new ConflictException(
        'This interview has no pending question — check its status.',
      );
    }

    if (session.status !== 'PENDING') {
      throw new ConflictException(
        `This interview session is already ${session.status.toLowerCase()}.`,
      );
    }

    const decision = await this.orchestrator.nextTurn({
      jobTitle: application.job.title,
      requiredSkills: requiredSkillNames(application.job.jobSkills),
      preferredSkills: preferredSkillNames(application.job.jobSkills),
      candidateSkills: extractSkills(application.candidateProfile),
      transcript: [],
      canAskFresh: true,
      canFollowUp: false,
    });

    if (decision.complete) {
      throw new InternalServerErrorException(
        'The interview could not be started — the question generator returned no question.',
      );
    }

    const question = await this.createQuestion(session.id, 1, decision);
    await this.prisma.aIInterviewSession.update({
      where: { id: session.id },
      data: { status: 'IN_PROGRESS', startedAt: new Date() },
    });

    return this.toTurnView(question);
  }

  async answer(
    applicationId: string,
    file: UploadedAudio,
    questionId?: string,
  ): Promise<InterviewTurnView | InterviewResultView> {
    const { application, session } = await this.loadContext(applicationId);

    if (await this.expireIfNeeded(session, applicationId)) {
      throw new GoneException(
        'The interview window for this application has expired.',
      );
    }

    if (session.status !== 'IN_PROGRESS') {
      // A stale retry (client-side timeout) whose original request already
      // completed the interview lands here — the audio was recorded for a
      // question that's now closed out, so hand back the terminal result
      // instead of throwing on what looks like a genuine conflict.
      if (session.status === 'COMPLETED' && questionId) {
        return { status: 'COMPLETED', message: interviewSubmittedMessage };
      }
      throw new ConflictException(
        `This interview session is ${session.status.toLowerCase()}, not awaiting an answer.`,
      );
    }

    const pending = session.questions.find((q) => !q.answeredAt);
    if (!pending) {
      throw new ConflictException('No pending question to answer.');
    }

    // Tie this submission to the question it was actually recorded for — a
    // client-side timeout retry resends the same (possibly stale) audio, and
    // by the time it arrives the original (slow-but-not-failed) request may
    // already have advanced the session to the next question. Without this
    // check the retried audio would get silently attached to a *different*
    // question and corrupt the transcript. See interview-session.service.ts
    // audit finding #12.
    if (questionId && questionId !== pending.id) {
      const staleTarget = session.questions.find((q) => q.id === questionId);
      if (staleTarget?.answeredAt) {
        return this.toTurnView(pending);
      }
      throw new ConflictException(
        'This question is no longer awaiting an answer — refresh and try again.',
      );
    }

    const answerText = await this.audio.transcribe(
      file.buffer,
      file.originalname,
    );
    const { filePath } = await this.storage.save(
      file.buffer,
      `answer-${pending.sequenceOrder}.audio`,
    );
    await this.prisma.aIInterviewQuestion.update({
      where: { id: pending.id },
      data: { answerText, candidateAudioUrl: filePath, answeredAt: new Date() },
    });

    const answeredQuestions = session.questions.map((q) =>
      q.id === pending.id ? { ...q, answerText, answeredAt: new Date() } : q,
    );

    const distinctSkillsAsked = answeredQuestions.filter(
      (q) => !q.isFollowUp,
    ).length;
    const followUpsUsed = answeredQuestions.filter((q) => q.isFollowUp).length;
    const totalAsked = answeredQuestions.length;

    const canAskFresh =
      distinctSkillsAsked < BASE_QUESTION_COUNT &&
      totalAsked < MAX_TOTAL_QUESTIONS;
    const canFollowUp =
      followUpsUsed < MAX_FOLLOWUPS && totalAsked < MAX_TOTAL_QUESTIONS;

    if (!canAskFresh && !canFollowUp) {
      return this.completeInterview(
        applicationId,
        session.id,
        answeredQuestions,
      );
    }

    const decision = await this.orchestrator.nextTurn({
      jobTitle: application.job.title,
      requiredSkills: requiredSkillNames(application.job.jobSkills),
      preferredSkills: preferredSkillNames(application.job.jobSkills),
      candidateSkills: extractSkills(application.candidateProfile),
      transcript: answeredQuestions.map((q) => ({
        questionText: q.questionText,
        answerText: q.answerText,
        targetSkillName: q.targetSkill?.name ?? null,
        isFollowUp: q.isFollowUp,
      })),
      canAskFresh,
      canFollowUp,
    });

    if (decision.complete) {
      return this.completeInterview(
        applicationId,
        session.id,
        answeredQuestions,
      );
    }

    const nextQuestion = await this.createQuestion(
      session.id,
      pending.sequenceOrder + 1,
      decision,
    );
    return this.toTurnView(nextQuestion);
  }

  async getStatus(applicationId: string): Promise<InterviewStatusView> {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: {
        candidateProfile: true,
        interviewSession: {
          include: {
            questions: {
              orderBy: { sequenceOrder: 'asc' },
              include: { targetSkill: true },
            },
          },
        },
      },
    });
    if (!application) {
      throw new NotFoundException(
        `No application found with id "${applicationId}".`,
      );
    }

    if (!application.interviewSession) {
      if (application.status === 'SCREENING_REJECTED') {
        return {
          applicationStatus: application.status,
          candidateStatus: toCandidateStatus(application.status),
          message: rejectionPlainMessage,
        };
      }
      // Distinct from the generic "still being reviewed" — scoring never
      // ran and never will for this CV, so the candidate shouldn't be left
      // thinking it's still in progress.
      if (application.candidateProfile.cvStatus === 'FAILED') {
        return {
          applicationStatus: application.status,
          candidateStatus: toCandidateStatus(application.status),
          message:
            'We had trouble reading your CV, so we could not complete your application. Please try uploading it again — a clearer scan or a text-based PDF usually resolves this.',
          terminal: true,
        };
      }
      if (application.status === 'WITHDRAWN') {
        return {
          applicationStatus: application.status,
          candidateStatus: toCandidateStatus(application.status),
          message: 'You withdrew this application.',
          terminal: true,
        };
      }
      return {
        applicationStatus: application.status,
        candidateStatus: toCandidateStatus(application.status),
        message: 'Your application is still being reviewed.',
      };
    }

    const session = application.interviewSession;
    const violations = await this.getViolationSummaryBySessionId(session.id);
    if (await this.expireIfNeeded(session, applicationId)) {
      return {
        applicationStatus: 'INTERVIEW_EXPIRED',
        candidateStatus: toCandidateStatus('INTERVIEW_EXPIRED'),
        message:
          'The window to complete your technical interview has expired. Please contact us if you believe this is a mistake.',
        violations,
      };
    }

    switch (session.status) {
      case 'PENDING':
        return {
          applicationStatus: application.status,
          candidateStatus: toCandidateStatus(application.status),
          message: invitePlainMessage(session.windowExpiresAt),
          interviewDeadline: session.windowExpiresAt,
          violations,
        };
      case 'IN_PROGRESS': {
        const pending = session.questions.find((q) => !q.answeredAt);
        return {
          applicationStatus: application.status,
          candidateStatus: toCandidateStatus(application.status),
          message: 'Your technical interview is in progress.',
          currentQuestion: pending ? this.toTurnView(pending) : undefined,
          violations,
        };
      }
      case 'COMPLETED':
        return {
          applicationStatus: application.status,
          candidateStatus: toCandidateStatus(application.status),
          message: postInterviewMessage(application.status),
          result: { status: 'COMPLETED', message: interviewSubmittedMessage },
          violations,
        };
      default:
        return {
          applicationStatus: application.status,
          candidateStatus: toCandidateStatus(application.status),
          message: 'This interview is no longer active.',
          violations,
        };
    }
  }

  /** Staff-facing: full transcript + skill grades for HR/Hiring Manager review before deciding. */
  async getTranscript(
    candidateProfileId: string,
    jobPostingId: string,
  ): Promise<InterviewTranscriptView> {
    const application = await this.prisma.application.findUnique({
      where: {
        candidateProfileId_jobId: { candidateProfileId, jobId: jobPostingId },
      },
      include: {
        interviewSession: {
          include: {
            questions: {
              orderBy: { sequenceOrder: 'asc' },
              include: { targetSkill: true },
            },
            skillGrades: { include: { skill: true } },
          },
        },
      },
    });
    if (!application?.interviewSession) {
      throw new NotFoundException(
        'No interview has been scheduled for this candidate/job posting pair.',
      );
    }

    const session = application.interviewSession;
    return {
      sessionStatus: session.status,
      overallScore: session.overallScore ? Number(session.overallScore) : null,
      recommendation: session.recommendation,
      summary: session.summary,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      terminationReason: session.terminationReason,
      violations: await this.getViolationSummaryBySessionId(session.id),
      questions: session.questions.map((q) => ({
        sequenceOrder: q.sequenceOrder,
        questionText: q.questionText,
        expectedCore: q.expectedCore,
        answerText: q.answerText,
        targetSkillName: q.targetSkill?.name ?? null,
        isFollowUp: q.isFollowUp,
        askedAt: q.askedAt,
        answeredAt: q.answeredAt,
      })),
      skillGrades: session.skillGrades.map((g) => ({
        skillName: g.skill.name,
        proficiencyScore: g.proficiencyScore,
        justification: g.justification,
      })),
    };
  }

  async getQuestionAudio(questionId: string): Promise<Buffer> {
    const question = await this.prisma.aIInterviewQuestion.findUnique({
      where: { id: questionId },
    });
    if (!question?.questionAudioUrl) {
      throw new NotFoundException(
        `No audio found for question "${questionId}".`,
      );
    }
    return this.storage.read(question.questionAudioUrl);
  }

  /**
   * Reports one proctoring irregularity for the given application's live
   * interview session. A BROWSER_CLOSED report always force-completes the
   * session immediately (there's no one left to see further warnings); any
   * other type force-completes once the running total reaches
   * MAX_INTERVIEW_WARNINGS. Always records the row first, even if the
   * session has already finished, so the audit trail stays complete.
   */
  async logViolation(
    applicationId: string,
    type: ViolationType,
    metadata?: Record<string, unknown>,
  ): Promise<LogViolationResult> {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: { interviewSession: true },
    });
    if (!application?.interviewSession) {
      throw new NotFoundException(
        'No interview has been scheduled for this application.',
      );
    }
    const session = application.interviewSession;

    await this.prisma.interviewViolation.create({
      data: {
        sessionId: session.id,
        type,
        metadataJson: metadata === undefined ? undefined : (metadata as object),
      },
    });

    const summary = await this.getViolationSummaryBySessionId(session.id);
    const sessionStillActive =
      session.status === 'PENDING' || session.status === 'IN_PROGRESS';

    let forced = false;
    if (sessionStillActive && type === 'BROWSER_CLOSED') {
      await this.forceSubmit(applicationId, 'AUTO_SUBMITTED_BROWSER_CLOSED');
      forced = true;
    } else if (sessionStillActive && summary.total >= MAX_INTERVIEW_WARNINGS) {
      await this.forceSubmit(applicationId, 'AUTO_SUBMITTED_VIOLATIONS');
      forced = true;
    }

    return { ...summary, forced };
  }

  async getViolationSummary(applicationId: string): Promise<ViolationSummary> {
    const session = await this.prisma.aIInterviewSession.findUnique({
      where: { applicationId },
      select: { id: true },
    });
    if (!session) {
      throw new NotFoundException(
        'No interview has been scheduled for this application.',
      );
    }
    return this.getViolationSummaryBySessionId(session.id);
  }

  private async getViolationSummaryBySessionId(
    sessionId: string,
  ): Promise<ViolationSummary> {
    const grouped = await this.prisma.interviewViolation.groupBy({
      by: ['type'],
      where: { sessionId },
      _count: { _all: true },
    });
    const counts: Partial<Record<ViolationType, number>> = {};
    let total = 0;
    for (const row of grouped) {
      counts[row.type] = row._count._all;
      total += row._count._all;
    }
    return { counts, total, riskLevel: riskLevelFor(total) };
  }

  /**
   * Ends the interview early and grades whatever was answered so far —
   * triggered by the proctoring system (5-warning cap, or a browser-close
   * ping), never by the candidate. A no-op if the session already finished
   * (e.g. a late sendBeacon arriving after a normal completion).
   */
  async forceSubmit(
    applicationId: string,
    reason: 'AUTO_SUBMITTED_VIOLATIONS' | 'AUTO_SUBMITTED_BROWSER_CLOSED',
  ): Promise<InterviewResultView> {
    const { session } = await this.loadContext(applicationId);
    if (session.status !== 'PENDING' && session.status !== 'IN_PROGRESS') {
      return { status: 'COMPLETED', message: interviewSubmittedMessage };
    }
    const answeredQuestions = session.questions.filter(
      (q) => q.answerText !== null,
    );
    return this.completeInterview(
      applicationId,
      session.id,
      answeredQuestions,
      reason,
    );
  }

  private async completeInterview(
    applicationId: string,
    sessionId: string,
    questions: {
      questionText: string;
      answerText: string | null;
      expectedCore: string;
      targetSkill: { name: string } | null;
    }[],
    terminationReason?:
      'AUTO_SUBMITTED_VIOLATIONS' | 'AUTO_SUBMITTED_BROWSER_CLOSED',
  ): Promise<InterviewResultView> {
    const application = await this.prisma.application.findUniqueOrThrow({
      where: { id: applicationId },
      include: { job: true },
    });

    const skillGroups = groupBySkill(questions);
    const grade = await this.orchestrator.grade({
      jobTitle: application.job.title,
      skillGroups,
    });

    for (const s of grade.skills) {
      const skill = await this.prisma.skill.upsert({
        where: { name: s.skillName },
        update: {},
        create: { name: s.skillName },
      });
      await this.prisma.candidateSkillGrade.upsert({
        where: { sessionId_skillId: { sessionId, skillId: skill.id } },
        update: {
          proficiencyScore: s.proficiencyScore,
          justification: s.justification,
        },
        create: {
          sessionId,
          skillId: skill.id,
          proficiencyScore: s.proficiencyScore,
          justification: s.justification,
        },
      });
    }

    await this.prisma.aIInterviewSession.update({
      where: { id: sessionId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        overallScore: grade.overallScore,
        recommendation: grade.recommendation,
        summary: grade.summary,
        terminationReason: terminationReason ?? null,
      },
    });

    const matchPct = application.skillMatchPct
      ? Number(application.skillMatchPct)
      : null;
    const compositeScore =
      matchPct !== null
        ? round(
            COMPOSITE_SCORE_WEIGHTS.match * matchPct +
              COMPOSITE_SCORE_WEIGHTS.interview * grade.overallScore,
          )
        : grade.overallScore;

    await this.prisma.application.update({
      where: { id: applicationId },
      data: { compositeScore, status: 'IN_REVIEW' },
    });

    return {
      status: 'COMPLETED',
      message: interviewSubmittedMessage,
    };
  }

  private async createQuestion(
    sessionId: string,
    sequenceOrder: number,
    decision: Extract<NextTurnResult, { complete: false }>,
  ) {
    const audioBuffer = await this.audio.synthesizeSpeech(
      decision.questionText,
    );
    const { filePath } = await this.storage.save(
      audioBuffer,
      `question-${sequenceOrder}.wav`,
    );

    const skill = await this.prisma.skill.upsert({
      where: { name: decision.targetSkillName },
      update: {},
      create: { name: decision.targetSkillName },
    });

    return this.prisma.aIInterviewQuestion.create({
      data: {
        sessionId,
        sequenceOrder,
        questionText: decision.questionText,
        expectedCore: decision.expectedCore,
        questionAudioUrl: filePath,
        targetSkillId: skill.id,
        isFollowUp: decision.isFollowUp,
        askedAt: new Date(),
      },
    });
  }

  private toTurnView(question: {
    id: string;
    sequenceOrder: number;
    questionText: string;
  }): InterviewTurnView {
    return {
      questionId: question.id,
      sequenceOrder: question.sequenceOrder,
      questionText: question.questionText,
      questionAudioUrl: `/interview-sessions/questions/${question.id}/audio`,
    };
  }

  private async loadContext(applicationId: string) {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: {
        candidateProfile: true,
        job: { include: { jobSkills: { include: { skill: true } } } },
        interviewSession: {
          include: {
            questions: {
              orderBy: { sequenceOrder: 'asc' },
              include: { targetSkill: true },
            },
          },
        },
      },
    });
    if (!application) {
      throw new NotFoundException(
        `No application found with id "${applicationId}".`,
      );
    }
    if (!application.interviewSession) {
      throw new NotFoundException(
        'No interview has been scheduled for this application.',
      );
    }
    return { application, session: application.interviewSession };
  }

  private async expireIfNeeded(
    session: { id: string; status: string; windowExpiresAt: Date },
    applicationId: string,
  ): Promise<boolean> {
    if (
      (session.status === 'PENDING' || session.status === 'IN_PROGRESS') &&
      new Date() > session.windowExpiresAt
    ) {
      await this.prisma.aIInterviewSession.update({
        where: { id: session.id },
        data: { status: 'EXPIRED' },
      });
      await this.prisma.application.update({
        where: { id: applicationId },
        data: { status: 'INTERVIEW_EXPIRED' },
      });
      return true;
    }
    return false;
  }
}

function requiredSkillNames(
  jobSkills: { required: boolean; skill: { name: string } }[],
): string[] {
  return jobSkills.filter((js) => js.required).map((js) => js.skill.name);
}

function preferredSkillNames(
  jobSkills: { required: boolean; skill: { name: string } }[],
): string[] {
  return jobSkills.filter((js) => !js.required).map((js) => js.skill.name);
}

function extractSkills(candidateProfile: {
  extractedDataJson: unknown;
}): string[] {
  const extracted =
    candidateProfile.extractedDataJson as ExtractedCvProfileDto | null;
  return extracted?.skills ?? [];
}

function groupBySkill(
  questions: {
    questionText: string;
    answerText: string | null;
    expectedCore: string;
    targetSkill: { name: string } | null;
  }[],
): SkillEvidenceGroup[] {
  const map = new Map<string, SkillEvidenceGroup>();
  for (const q of questions) {
    const name = q.targetSkill?.name ?? 'General';
    if (!map.has(name)) map.set(name, { skillName: name, entries: [] });
    map.get(name)!.entries.push({
      questionText: q.questionText,
      answerText: q.answerText,
      expectedCore: q.expectedCore,
    });
  }
  return [...map.values()];
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
