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
import {
  BASE_QUESTION_COUNT,
  COMPOSITE_SCORE_WEIGHTS,
  MAX_FOLLOWUPS,
  MAX_TOTAL_QUESTIONS,
} from '../interview.constants';
import {
  InterviewOrchestratorService,
  NextTurnResult,
  SkillEvidenceGroup,
} from './interview-orchestrator.service';

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
  message: string;
  interviewDeadline?: Date;
  currentQuestion?: InterviewTurnView;
  result?: InterviewResultView;
  /** CV processing failed permanently — nothing will change without a fresh upload; lets pollers stop. */
  terminal?: boolean;
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
  startedAt: Date | null;
  completedAt: Date | null;
  questions: TranscriptQuestionView[];
  skillGrades: SkillResultView[];
}

const invitePlainMessage = (deadline: Date): string =>
  `Congratulations — your application passed our initial screening. Please complete a short AI-conducted technical interview before ${deadline.toISOString()}.`;

const rejectionPlainMessage =
  "Thank you for applying. After careful review, we've decided not to move forward with your application at this time.";

const interviewSubmittedMessage =
  'Your interview was submitted successfully. Our team will review your responses and let you know if you are eligible to move forward.';

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
  ): Promise<InterviewTurnView | InterviewResultView> {
    const { application, session } = await this.loadContext(applicationId);

    if (await this.expireIfNeeded(session, applicationId)) {
      throw new GoneException(
        'The interview window for this application has expired.',
      );
    }

    if (session.status !== 'IN_PROGRESS') {
      throw new ConflictException(
        `This interview session is ${session.status.toLowerCase()}, not awaiting an answer.`,
      );
    }

    const pending = session.questions.find((q) => !q.answeredAt);
    if (!pending) {
      throw new ConflictException('No pending question to answer.');
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
          message: rejectionPlainMessage,
        };
      }
      // Distinct from the generic "still being reviewed" — scoring never
      // ran and never will for this CV, so the candidate shouldn't be left
      // thinking it's still in progress.
      if (application.candidateProfile.cvStatus === 'FAILED') {
        return {
          applicationStatus: application.status,
          message:
            'We had trouble reading your CV, so we could not complete your application. Please try uploading it again — a clearer scan or a text-based PDF usually resolves this.',
          terminal: true,
        };
      }
      return {
        applicationStatus: application.status,
        message: 'Your application is still being reviewed.',
      };
    }

    const session = application.interviewSession;
    if (await this.expireIfNeeded(session, applicationId)) {
      return {
        applicationStatus: 'INTERVIEW_EXPIRED',
        message:
          'The window to complete your technical interview has expired. Please contact us if you believe this is a mistake.',
      };
    }

    switch (session.status) {
      case 'PENDING':
        return {
          applicationStatus: application.status,
          message: invitePlainMessage(session.windowExpiresAt),
          interviewDeadline: session.windowExpiresAt,
        };
      case 'IN_PROGRESS': {
        const pending = session.questions.find((q) => !q.answeredAt);
        return {
          applicationStatus: application.status,
          message: 'Your technical interview is in progress.',
          currentQuestion: pending ? this.toTurnView(pending) : undefined,
        };
      }
      case 'COMPLETED':
        return {
          applicationStatus: application.status,
          message: interviewSubmittedMessage,
          result: { status: 'COMPLETED', message: interviewSubmittedMessage },
        };
      default:
        return {
          applicationStatus: application.status,
          message: 'This interview is no longer active.',
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
      startedAt: session.startedAt,
      completedAt: session.completedAt,
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

  private async completeInterview(
    applicationId: string,
    sessionId: string,
    questions: {
      questionText: string;
      answerText: string | null;
      expectedCore: string;
      targetSkill: { name: string } | null;
    }[],
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
