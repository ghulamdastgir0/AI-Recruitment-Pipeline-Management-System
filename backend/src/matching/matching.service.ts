import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditLogService } from '../audit/audit-log.service';
import { resolveCandidateIdentity } from '../candidates/candidate-identity.util';
import type { ExtractedCvProfileDto } from '../candidates/dto/extracted-cv-profile.dto';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../shared/email/email.service';
import { EmbeddingsService } from '../shared/embeddings/embeddings.service';
import { CandidateLinksService } from '../shared/links/candidate-links.service';
import {
  INTERVIEW_SCORE_THRESHOLD,
  INTERVIEW_WINDOW_HOURS,
} from './matching.constants';
import {
  computeMatch,
  EvidenceEntry,
  MatchComputation,
  ResumePage,
} from './scoring';

const MODEL_VERSION = 'matching-v1';

export interface MatchResultView {
  applicationId: string;
  candidateProfileId: string;
  jobPostingId: string;
  candidateName: string | null;
  candidateEmail: string | null;
  candidatePhone: string | null;
  applicationStatus: string;
  overallScore: number;
  recommendation: string;
  confidence: string;
  summary: string;
  matchedSkills: string[];
  missingRequiredSkills: string[];
  evidence: EvidenceEntry[];
  breakdown: MatchComputation['breakdown'];
  modelVersion: string;
  processedAt: Date;
}

export type MatchOutcome =
  | { status: 'READY'; matchResult: MatchResultView }
  | { status: 'PROCESSING' | 'FAILED'; message: string };

@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: EmbeddingsService,
    private readonly audit: AuditLogService,
    private readonly email: EmailService,
    private readonly links: CandidateLinksService,
  ) {}

  /**
   * `actorUserId` is omitted for system-triggered auto-matching (e.g. right
   * after a CV finishes processing) — there's no human actor to attribute an
   * audit row to there, same reasoning as CvUploadService's SELF_APPLIED
   * uploads.
   */
  async match(
    candidateProfileId: string,
    jobPostingId: string,
    actorUserId?: string,
  ): Promise<MatchOutcome> {
    const [job, candidate] = await Promise.all([
      this.loadJob(jobPostingId),
      this.loadCandidate(candidateProfileId),
    ]);

    if (candidate.cvStatus !== 'READY') {
      return {
        status: candidate.cvStatus,
        message:
          candidate.cvStatus === 'PROCESSING'
            ? 'This CV is still being processed (text extraction/parsing/embedding). Try again shortly.'
            : `CV processing failed: ${candidate.cvProcessingError ?? 'unknown error'}`,
      };
    }

    const application = await this.prisma.application.upsert({
      where: {
        candidateProfileId_jobId: { candidateProfileId, jobId: jobPostingId },
      },
      update: {},
      create: { candidateProfileId, jobId: jobPostingId, status: 'APPLIED' },
    });

    const extracted =
      candidate.extractedDataJson as ExtractedCvProfileDto | null;
    const computation = computeMatch(
      {
        title: job.title,
        description: job.description,
        embedding: job.embedding,
        requiredSkills: job.jobSkills
          .filter((js) => js.required)
          .map((js) => js.skill.name),
        preferredSkills: job.jobSkills
          .filter((js) => !js.required)
          .map((js) => js.skill.name),
        experienceMin: job.experienceMin,
      },
      {
        skills: extracted?.skills ?? [],
        experienceYears: candidate.experienceYears ?? 0,
        embedding: candidate.embedding,
        projects: extracted?.projects ?? [],
        education: extracted?.education ?? [],
        certifications: extracted?.certifications ?? [],
        resumePages: (candidate.resumePagesJson as ResumePage[] | null) ?? [],
      },
    );

    this.logger.log(
      `Match score for candidate ${candidateProfileId} vs job "${job.title}" (${jobPostingId}): ` +
        `${computation.overallScore}/100 — ${computation.recommendation} (${computation.confidence} confidence) | ` +
        `breakdown: requiredSkills=${computation.breakdown.requiredSkills} preferredSkills=${computation.breakdown.preferredSkills} ` +
        `experience=${computation.breakdown.relevantExperience} projects=${computation.breakdown.projects} education=${computation.breakdown.education} | ` +
        `matched=[${computation.matchedSkills.join(', ')}] missing=[${computation.missingRequiredSkills.join(', ')}]`,
    );

    const matchResult = await this.prisma.matchResult.create({
      data: {
        applicationId: application.id,
        overallScore: computation.overallScore,
        recommendation: computation.recommendation,
        confidence: computation.confidence,
        summary: computation.summary,
        matchedSkillsJson: computation.matchedSkills,
        missingRequiredSkillsJson: computation.missingRequiredSkills,
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- see cv-processor.service.ts
        evidenceJson: computation.evidence as unknown as object,
        breakdownJson: computation.breakdown,
        modelVersion: MODEL_VERSION,
      },
    });

    await this.prisma.application.update({
      where: { id: application.id },
      data: { skillMatchPct: computation.overallScore, screenedAt: new Date() },
    });

    // Only decide once — matchAllPendingApplications / a manual re-match both
    // reuse this same match() method, and status !== 'APPLIED' means this
    // application already got its invite/rejection email on an earlier run.
    let finalStatus = application.status;
    if (application.status === 'APPLIED') {
      finalStatus = await this.applyScreeningDecision(
        application.id,
        job.title,
        candidate,
        computation.overallScore,
      );
    }

    if (actorUserId) {
      await this.audit.record({
        actorUserId,
        action: 'candidate_score.generated',
        resourceType: 'MatchResult',
        resourceId: matchResult.id,
        details: {
          candidateProfileId,
          jobPostingId,
          overallScore: computation.overallScore,
        },
      });
    }

    const { name, email, phone } = resolveCandidateIdentity(candidate);

    return {
      status: 'READY',
      matchResult: {
        applicationId: application.id,
        candidateProfileId,
        jobPostingId,
        candidateName: name,
        candidateEmail: email,
        candidatePhone: phone,
        applicationStatus: finalStatus,
        overallScore: Number(matchResult.overallScore),
        recommendation: matchResult.recommendation,
        confidence: matchResult.confidence,
        summary: matchResult.summary,
        matchedSkills: computation.matchedSkills,
        missingRequiredSkills: computation.missingRequiredSkills,
        evidence: computation.evidence,
        breakdown: computation.breakdown,
        modelVersion: matchResult.modelVersion,
        processedAt: matchResult.processedAt,
      },
    };
  }

  /**
   * First-time-only screening decision: score >= threshold opens the 48h
   * interview window and sends the invite; otherwise the application is
   * screened out with a rejection email. Both branches are best-effort on
   * the email — a Brevo failure shouldn't lose the status transition, and
   * EmailService.send() itself never throws (returns false on failure).
   */
  private async applyScreeningDecision(
    applicationId: string,
    jobTitle: string,
    candidate: {
      candidateName: string | null;
      candidateEmail: string | null;
      candidatePhone: string | null;
      extractedDataJson: unknown;
    },
    overallScore: number,
  ): Promise<'INTERVIEW_PENDING' | 'SCREENING_REJECTED'> {
    const { email: candidateEmail, name: candidateName } =
      resolveCandidateIdentity(candidate);

    if (overallScore >= INTERVIEW_SCORE_THRESHOLD) {
      const now = new Date();
      const windowExpiresAt = new Date(
        now.getTime() + INTERVIEW_WINDOW_HOURS * 60 * 60 * 1000,
      );

      await this.prisma.application.update({
        where: { id: applicationId },
        data: {
          status: 'INTERVIEW_PENDING',
          interviewWindowOpensAt: now,
          interviewWindowExpiresAt: windowExpiresAt,
        },
      });
      await this.prisma.aIInterviewSession.create({
        data: { applicationId, status: 'PENDING', windowExpiresAt },
      });

      const sent = await this.email.send({
        to: candidateEmail,
        type: 'INTERVIEW_ACKNOWLEDGEMENT',
        variables: {
          candidateName,
          jobTitle,
          interviewDeadline: windowExpiresAt,
          interviewLink: this.links.interviewUrl(applicationId),
        },
      });
      if (sent) {
        await this.prisma.emailLog.create({
          data: { applicationId, type: 'INTERVIEW_ACKNOWLEDGEMENT' },
        });
      }
      return 'INTERVIEW_PENDING';
    } else {
      await this.prisma.application.update({
        where: { id: applicationId },
        data: { status: 'SCREENING_REJECTED' },
      });

      const sent = await this.email.send({
        to: candidateEmail,
        type: 'SCREENING_REJECTION',
        variables: { candidateName, jobTitle },
      });
      if (sent) {
        await this.prisma.emailLog.create({
          data: { applicationId, type: 'SCREENING_REJECTION' },
        });
      }
      return 'SCREENING_REJECTED';
    }
  }

  /**
   * Auto-scores every application for this candidate that doesn't have a
   * match result yet (called once a CV reaches READY, and again whenever a
   * content-hash-deduped CV is reused against a new job posting). Each
   * application is scored independently — one bad job posting embedding
   * shouldn't stop the candidate from being scored against the others.
   */
  async matchAllPendingApplications(candidateProfileId: string): Promise<void> {
    const pending = await this.prisma.application.findMany({
      where: { candidateProfileId, matchResults: { none: {} } },
    });

    for (const application of pending) {
      try {
        await this.match(candidateProfileId, application.jobId);
      } catch (error) {
        this.logger.warn(
          `Auto-match failed for candidate ${candidateProfileId} / job ${application.jobId}: ` +
            (error instanceof Error ? error.message : String(error)),
        );
      }
    }
  }

  async getLatestExplanation(
    candidateProfileId: string,
    jobPostingId: string,
  ): Promise<MatchResultView> {
    const application = await this.prisma.application.findUnique({
      where: {
        candidateProfileId_jobId: { candidateProfileId, jobId: jobPostingId },
      },
      include: {
        candidateProfile: true,
        matchResults: { orderBy: { processedAt: 'desc' }, take: 1 },
      },
    });

    const latest = application?.matchResults[0];
    if (!application || !latest) {
      throw new NotFoundException(
        `No match result found for this candidate/job posting pair yet — call matchCandidateToJob first.`,
      );
    }

    const { name, email, phone } = resolveCandidateIdentity(
      application.candidateProfile,
    );

    return {
      applicationId: application.id,
      candidateProfileId,
      jobPostingId,
      candidateName: name,
      candidateEmail: email,
      candidatePhone: phone,
      applicationStatus: application.status,
      overallScore: Number(latest.overallScore),
      recommendation: latest.recommendation,
      confidence: latest.confidence,
      summary: latest.summary,
      matchedSkills: latest.matchedSkillsJson as unknown as string[],
      missingRequiredSkills:
        latest.missingRequiredSkillsJson as unknown as string[],
      evidence: latest.evidenceJson as unknown as EvidenceEntry[],
      breakdown:
        latest.breakdownJson as unknown as MatchComputation['breakdown'],
      modelVersion: latest.modelVersion,
      processedAt: latest.processedAt,
    };
  }

  /** Resolves the on-disk path for a candidate's original CV, for the staff CV-download endpoint. Never returns the path itself to a caller outside this service. */
  async getResumeFile(
    candidateProfileId: string,
  ): Promise<{ filePath: string; displayName: string }> {
    const candidate = await this.prisma.candidateProfile.findUnique({
      where: { id: candidateProfileId },
    });
    if (!candidate?.resumeFilePath) {
      throw new NotFoundException(
        `No CV file found for candidate "${candidateProfileId}".`,
      );
    }
    const { name } = resolveCandidateIdentity(candidate);
    return {
      filePath: candidate.resumeFilePath,
      displayName: `${name ?? candidateProfileId}.pdf`,
    };
  }

  private async loadJob(jobPostingId: string) {
    const job = await this.prisma.job.findUnique({
      where: { id: jobPostingId },
      include: { jobSkills: { include: { skill: true } } },
    });
    if (!job) {
      throw new NotFoundException(
        `No job posting found with id "${jobPostingId}".`,
      );
    }

    const rows = await this.prisma.$queryRaw<
      { embeddingText: string | null }[]
    >`
      SELECT embedding::text AS "embeddingText" FROM "Job" WHERE id = ${jobPostingId}
    `;

    return {
      ...job,
      embedding: this.embeddings.parseVectorLiteral(rows[0]?.embeddingText),
    };
  }

  private async loadCandidate(candidateProfileId: string) {
    const candidate = await this.prisma.candidateProfile.findUnique({
      where: { id: candidateProfileId },
    });
    if (!candidate) {
      throw new NotFoundException(
        `No candidate found with id "${candidateProfileId}".`,
      );
    }

    const rows = await this.prisma.$queryRaw<
      { embeddingText: string | null }[]
    >`
      SELECT "resumeEmbedding"::text AS "embeddingText" FROM "CandidateProfile" WHERE id = ${candidateProfileId}
    `;

    return {
      ...candidate,
      embedding: this.embeddings.parseVectorLiteral(rows[0]?.embeddingText),
    };
  }
}
