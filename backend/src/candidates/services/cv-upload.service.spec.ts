import { NotFoundException } from '@nestjs/common';
import { AuditLogService } from '../../audit/audit-log.service';
import { MatchingService } from '../../matching/matching.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BackgroundJobQueueService } from '../../shared/background-jobs/background-job-queue.service';
import { CvProcessorService } from './cv-processor.service';
import { CvStorageService } from './cv-storage.service';
import { CvUploadService } from './cv-upload.service';

const PDF_BYTES = Buffer.from('%PDF-1.4 fake pdf content');

function buildService() {
  const prisma = {
    job: { findUnique: jest.fn() },
    candidateProfile: { findFirst: jest.fn(), create: jest.fn() },
    application: { upsert: jest.fn() },
  } as unknown as jest.Mocked<PrismaService>;
  const storage = {
    save: jest.fn().mockResolvedValue({ filePath: '/storage/cvs/x.pdf' }),
  } as unknown as jest.Mocked<CvStorageService>;
  const jobQueue = {
    enqueue: jest.fn(),
  } as unknown as jest.Mocked<BackgroundJobQueueService>;
  const processor = {
    process: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<CvProcessorService>;
  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<AuditLogService>;
  const matching = {
    matchAllPendingApplications: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<MatchingService>;

  return {
    service: new CvUploadService(
      prisma,
      storage,
      jobQueue,
      processor,
      audit,
      matching,
    ),
    prisma,
    storage,
    jobQueue,
    processor,
    audit,
    matching,
  };
}

describe('CvUploadService', () => {
  describe('uploadCv', () => {
    it('lets HR upload against a DRAFT job', async () => {
      const { service, prisma } = buildService();
      (prisma.job.findUnique as jest.Mock).mockResolvedValue({
        id: 'job-1',
        status: 'DRAFT',
      });
      (prisma.candidateProfile.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.candidateProfile.create as jest.Mock).mockResolvedValue({
        id: 'cand-1',
        cvStatus: 'PROCESSING',
      });
      (prisma.application.upsert as jest.Mock).mockResolvedValue({
        id: 'app-1',
      });

      const result = await service.uploadCv(
        'job-1',
        { buffer: PDF_BYTES, originalname: 'resume.pdf' },
        'HR_SOURCED',
        'hr-user-1',
      );

      expect(result.candidateProfileId).toBe('cand-1');
      expect(prisma.candidateProfile.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ source: 'HR_SOURCED' }),
        }),
      );
    });

    it('rejects a SELF_APPLIED upload against a DRAFT job with NotFoundException', async () => {
      const { service, prisma } = buildService();
      (prisma.job.findUnique as jest.Mock).mockResolvedValue({
        id: 'job-1',
        status: 'DRAFT',
      });

      await expect(
        service.uploadCv(
          'job-1',
          { buffer: PDF_BYTES, originalname: 'resume.pdf' },
          'SELF_APPLIED',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.candidateProfile.create).not.toHaveBeenCalled();
    });

    it('rejects a SELF_APPLIED upload against a CLOSED job', async () => {
      const { service, prisma } = buildService();
      (prisma.job.findUnique as jest.Mock).mockResolvedValue({
        id: 'job-1',
        status: 'CLOSED',
      });

      await expect(
        service.uploadCv(
          'job-1',
          { buffer: PDF_BYTES, originalname: 'resume.pdf' },
          'SELF_APPLIED',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('allows a SELF_APPLIED upload against a PUBLISHED job, tagged with source SELF_APPLIED', async () => {
      const { service, prisma, audit } = buildService();
      (prisma.job.findUnique as jest.Mock).mockResolvedValue({
        id: 'job-1',
        status: 'PUBLISHED',
      });
      (prisma.candidateProfile.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.candidateProfile.create as jest.Mock).mockResolvedValue({
        id: 'cand-1',
        cvStatus: 'PROCESSING',
      });
      (prisma.application.upsert as jest.Mock).mockResolvedValue({
        id: 'app-1',
      });

      const result = await service.uploadCv(
        'job-1',
        { buffer: PDF_BYTES, originalname: 'resume.pdf' },
        'SELF_APPLIED',
      );

      expect(result.cvStatus).toBe('PROCESSING');
      expect(prisma.candidateProfile.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ source: 'SELF_APPLIED' }),
        }),
      );
      // No authenticated actor -> nothing valid to attribute an audit row to.
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('audit-logs only when uploadedByUserId is provided', async () => {
      const { service, prisma, audit } = buildService();
      (prisma.job.findUnique as jest.Mock).mockResolvedValue({
        id: 'job-1',
        status: 'PUBLISHED',
      });
      (prisma.candidateProfile.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.candidateProfile.create as jest.Mock).mockResolvedValue({
        id: 'cand-1',
        cvStatus: 'PROCESSING',
      });
      (prisma.application.upsert as jest.Mock).mockResolvedValue({
        id: 'app-1',
      });

      await service.uploadCv(
        'job-1',
        { buffer: PDF_BYTES, originalname: 'resume.pdf' },
        'HR_SOURCED',
        'hr-user-1',
      );

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 'hr-user-1',
          action: 'candidate_cv.uploaded',
        }),
      );
    });

    it('reuses an existing profile by content hash regardless of source, without reprocessing', async () => {
      const { service, prisma, storage, processor } = buildService();
      (prisma.job.findUnique as jest.Mock).mockResolvedValue({
        id: 'job-1',
        status: 'PUBLISHED',
      });
      (prisma.candidateProfile.findFirst as jest.Mock).mockResolvedValue({
        id: 'existing-cand',
        cvStatus: 'READY',
      });
      (prisma.application.upsert as jest.Mock).mockResolvedValue({
        id: 'app-1',
      });

      const result = await service.uploadCv(
        'job-1',
        { buffer: PDF_BYTES, originalname: 'resume.pdf' },
        'SELF_APPLIED',
      );

      expect(result.candidateProfileId).toBe('existing-cand');
      expect(storage.save).not.toHaveBeenCalled();
      expect(processor.process).not.toHaveBeenCalled();
    });

    it('auto-triggers scoring for the new application when a content-hash-reused CV is already READY', async () => {
      const { service, prisma, jobQueue, matching } = buildService();
      (prisma.job.findUnique as jest.Mock).mockResolvedValue({
        id: 'job-1',
        status: 'PUBLISHED',
      });
      (prisma.candidateProfile.findFirst as jest.Mock).mockResolvedValue({
        id: 'existing-cand',
        cvStatus: 'READY',
      });
      (prisma.application.upsert as jest.Mock).mockResolvedValue({
        id: 'app-1',
      });

      await service.uploadCv(
        'job-1',
        { buffer: PDF_BYTES, originalname: 'resume.pdf' },
        'SELF_APPLIED',
      );

      expect(jobQueue.enqueue).toHaveBeenCalledTimes(1);
      // Run whatever job was queued and confirm it's the matching trigger,
      // scoped to the profile that was actually reused.
      const calls = (jobQueue.enqueue as jest.Mock).mock.calls as Array<
        [() => Promise<void>]
      >;
      await calls[0][0]();
      expect(matching.matchAllPendingApplications).toHaveBeenCalledWith(
        'existing-cand',
      );
    });

    it('does not trigger scoring for a reused profile that is still PROCESSING', async () => {
      const { service, prisma, jobQueue } = buildService();
      (prisma.job.findUnique as jest.Mock).mockResolvedValue({
        id: 'job-1',
        status: 'PUBLISHED',
      });
      (prisma.candidateProfile.findFirst as jest.Mock).mockResolvedValue({
        id: 'existing-cand',
        cvStatus: 'PROCESSING',
      });
      (prisma.application.upsert as jest.Mock).mockResolvedValue({
        id: 'app-1',
      });

      await service.uploadCv(
        'job-1',
        { buffer: PDF_BYTES, originalname: 'resume.pdf' },
        'SELF_APPLIED',
      );

      // The in-flight CvProcessorService.process() run for this profile
      // will pick this application up itself once it finishes.
      expect(jobQueue.enqueue).not.toHaveBeenCalled();
    });
  });
});
