import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditLogService } from '../../audit/audit-log.service';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BackgroundJobQueueService } from '../../shared/background-jobs/background-job-queue.service';
import { EmailService } from '../../shared/email/email.service';
import { CandidateLinksService } from '../../shared/links/candidate-links.service';
import {
  CV_MATCH_ALL_PENDING_JOB_TYPE,
  CV_PROCESSING_JOB_TYPE,
} from './cv-processor.service';
import { CvStorageService } from './cv-storage.service';

export interface UploadedCv {
  buffer: Buffer;
  originalname: string;
}

export type CandidateCvSource = 'HR_SOURCED' | 'SELF_APPLIED';

export interface CandidateContact {
  name: string;
  email: string;
  phone: string;
}

export interface UploadCvResult {
  candidateProfileId: string;
  applicationId: string;
  cvStatus: string;
}

export interface CandidateProcessingStatus {
  candidateProfileId: string;
  cvStatus: string;
  cvProcessingError: string | null;
}

const PDF_MAGIC_BYTES = '%PDF-';

@Injectable()
export class CvUploadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: CvStorageService,
    private readonly jobQueue: BackgroundJobQueueService,
    private readonly audit: AuditLogService,
    private readonly email: EmailService,
    private readonly links: CandidateLinksService,
  ) {}

  /**
   * Uploads a CV against a job posting. Identical bytes already on file
   * (any job) are reused instead of reprocessed — this is what "prevents
   * duplicate CV processing" in practice. A fresh Application row (or the
   * existing one) is what ties this candidate to this specific posting.
   *
   * `uploadedByUserId` is omitted for SELF_APPLIED uploads (the public apply
   * endpoint has no authenticated user) — AuditLog.actorUserId is a required
   * FK to User, so there's nothing valid to attribute a self-apply audit row
   * to; the CandidateProfile/Application timestamps are the record instead.
   */
  async uploadCv(
    jobPostingId: string,
    file: UploadedCv,
    source: CandidateCvSource,
    uploadedByUserId?: string,
    contact?: CandidateContact,
  ): Promise<UploadCvResult> {
    this.assertIsPdf(file);

    const job = await this.prisma.job.findUnique({
      where: { id: jobPostingId },
    });
    // Self-apply is only allowed against a live posting; treat a
    // draft/closed/archived job the same as "doesn't exist" so the public
    // endpoint never leaks which unannounced roles are in the pipeline.
    if (!job || (source === 'SELF_APPLIED' && job.status !== 'PUBLISHED')) {
      throw new NotFoundException(
        `No job posting found with id "${jobPostingId}".`,
      );
    }

    // A candidate must not be able to apply twice to the same job with the
    // same email OR the same phone number — this is independent of the
    // CV-content-hash dedup below, which only reuses a *processed CV*, not
    // an application decision. Two different CVs typed against the same
    // contact info for the same job would otherwise each get their own
    // CandidateProfile/Application row.
    if (contact?.email || contact?.phone) {
      const alreadyApplied = await this.prisma.application.findFirst({
        where: {
          jobId: jobPostingId,
          candidateProfile: {
            OR: [
              ...(contact.email
                ? [
                    {
                      candidateEmail: {
                        equals: contact.email,
                        mode: 'insensitive' as const,
                      },
                    },
                  ]
                : []),
              ...(contact.phone
                ? [{ candidatePhone: contact.phone }]
                : []),
            ],
          },
        },
      });
      if (alreadyApplied) {
        // Structured payload (not just a message string) — the apply form
        // uses applicationId to link straight back to the existing
        // application's status page instead of leaving the candidate with
        // a dead-end error and no way to find what they already submitted.
        throw new ConflictException({
          message:
            'You have already applied to this job posting with this email or phone number.',
          applicationId: alreadyApplied.id,
        });
      }
    }

    const contentHash = createHash('sha256').update(file.buffer).digest('hex');

    let profile = await this.prisma.candidateProfile.findFirst({
      where: { resumeContentHash: contentHash, cvStatus: { not: 'FAILED' } },
    });

    if (!profile) {
      const { filePath } = await this.storage.save(
        file.buffer,
        file.originalname,
      );
      profile = await this.prisma.candidateProfile.create({
        data: {
          resumeUrl: filePath,
          resumeFilePath: filePath,
          resumeContentHash: contentHash,
          source,
          cvStatus: 'PROCESSING',
          candidateName: contact?.name,
          candidateEmail: contact?.email,
          candidatePhone: contact?.phone,
        },
      });
      await this.jobQueue.enqueue(CV_PROCESSING_JOB_TYPE, profile.id);
    } else if (contact) {
      // Dedupe-reuse path: the same CV bytes were already on file for this
      // profile, so no create() ran above to persist contact info — a
      // returning applicant's freshly-typed details should still win over
      // whatever (or nothing) was recorded before.
      profile = await this.prisma.candidateProfile.update({
        where: { id: profile.id },
        data: {
          candidateName: contact.name,
          candidateEmail: contact.email,
          candidatePhone: contact.phone,
        },
      });
    }

    const applicantEmail = contact?.email?.toLowerCase() ?? null;
    let application: { id: string };
    try {
      application = await this.prisma.application.upsert({
        where: {
          candidateProfileId_jobId: {
            candidateProfileId: profile.id,
            jobId: jobPostingId,
          },
        },
        update: {},
        create: {
          candidateProfileId: profile.id,
          jobId: jobPostingId,
          status: 'APPLIED',
          applicantEmail,
        },
      });
    } catch (error) {
      // Closes the race the findFirst check above can't: two near-simultaneous
      // uploads with the same email but different file bytes each create their
      // own CandidateProfile and pass the check before either has written —
      // the (jobId, applicantEmail) unique index is what actually stops the
      // second one from landing as a duplicate Application.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const winner = applicantEmail
          ? await this.prisma.application.findFirst({
              where: { jobId: jobPostingId, applicantEmail },
            })
          : null;
        throw new ConflictException({
          message:
            'You have already applied to this job posting with this email address.',
          applicationId: winner?.id,
        });
      }
      throw error;
    }

    if (uploadedByUserId) {
      await this.audit.record({
        actorUserId: uploadedByUserId,
        action: 'candidate_cv.uploaded',
        resourceType: 'CandidateProfile',
        resourceId: profile.id,
        details: { jobPostingId, applicationId: application.id },
      });
    }

    // Best-effort, same pattern as MatchingService.applyScreeningDecision —
    // a Brevo failure shouldn't fail the upload, and EmailService.send()
    // itself never throws.
    if (contact?.email) {
      const sent = await this.email.send({
        to: contact.email,
        type: 'APPLICATION_RECEIVED',
        variables: {
          candidateName: contact.name,
          jobTitle: job.title,
          applicationReference: application.id,
          statusLink: this.links.statusUrl(application.id),
        },
      });
      if (sent) {
        await this.prisma.emailLog.create({
          data: { applicationId: application.id, type: 'APPLICATION_RECEIVED' },
        });
      }
    }

    if (profile.cvStatus === 'READY') {
      // Reused (content-hash deduped) CV that already finished processing —
      // CvProcessorService won't run again for it, so this Application row
      // (just created/confirmed above) is the only place left to trigger
      // scoring against this job posting.
      await this.jobQueue.enqueue(CV_MATCH_ALL_PENDING_JOB_TYPE, profile.id);
    }

    return {
      candidateProfileId: profile.id,
      applicationId: application.id,
      cvStatus: profile.cvStatus,
    };
  }

  async getStatus(
    candidateProfileId: string,
  ): Promise<CandidateProcessingStatus> {
    const profile = await this.prisma.candidateProfile.findUnique({
      where: { id: candidateProfileId },
    });
    if (!profile) {
      throw new NotFoundException(
        `No candidate found with id "${candidateProfileId}".`,
      );
    }
    return {
      candidateProfileId: profile.id,
      cvStatus: profile.cvStatus,
      cvProcessingError: profile.cvProcessingError,
    };
  }

  private assertIsPdf(file: UploadedCv): void {
    if (
      file.buffer.subarray(0, PDF_MAGIC_BYTES.length).toString('latin1') !==
      PDF_MAGIC_BYTES
    ) {
      throw new BadRequestException('The uploaded file is not a valid PDF.');
    }
  }
}
