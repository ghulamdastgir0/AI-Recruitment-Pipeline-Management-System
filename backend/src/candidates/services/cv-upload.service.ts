import { createHash } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditLogService } from '../../audit/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BackgroundJobQueueService } from '../../shared/background-jobs/background-job-queue.service';
import { CvProcessorService } from './cv-processor.service';
import { CvStorageService } from './cv-storage.service';

export interface UploadedCv {
  buffer: Buffer;
  originalname: string;
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
    private readonly processor: CvProcessorService,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * Uploads a CV against a job posting. Identical bytes already on file
   * (any job) are reused instead of reprocessed — this is what "prevents
   * duplicate CV processing" in practice. A fresh Application row (or the
   * existing one) is what ties this candidate to this specific posting.
   */
  async uploadCv(
    jobPostingId: string,
    file: UploadedCv,
    uploadedByUserId: string,
  ): Promise<UploadCvResult> {
    this.assertIsPdf(file);

    const job = await this.prisma.job.findUnique({
      where: { id: jobPostingId },
    });
    if (!job) {
      throw new NotFoundException(
        `No job posting found with id "${jobPostingId}".`,
      );
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
          source: 'HR_SOURCED',
          cvStatus: 'PROCESSING',
        },
      });
      this.jobQueue.enqueue(() => this.processor.process(profile!.id));
    }

    const application = await this.prisma.application.upsert({
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
      },
    });

    await this.audit.record({
      actorUserId: uploadedByUserId,
      action: 'candidate_cv.uploaded',
      resourceType: 'CandidateProfile',
      resourceId: profile.id,
      details: { jobPostingId, applicationId: application.id },
    });

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
