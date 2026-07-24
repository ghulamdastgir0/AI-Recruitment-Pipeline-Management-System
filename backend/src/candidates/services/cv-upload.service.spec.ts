import { ConflictException, NotFoundException } from '@nestjs/common';
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
import { CvUploadService } from './cv-upload.service';

const PDF_BYTES = Buffer.from('%PDF-1.4 fake pdf content');

function buildService() {
  const prisma = {
    job: { findUnique: jest.fn() },
    candidateProfile: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    application: {
      upsert: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    emailLog: { create: jest.fn().mockResolvedValue(undefined) },
  } as unknown as jest.Mocked<PrismaService>;
  const storage = {
    save: jest.fn().mockResolvedValue({ filePath: '/storage/cvs/x.pdf' }),
  } as unknown as jest.Mocked<CvStorageService>;
  const jobQueue = {
    enqueue: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<BackgroundJobQueueService>;
  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<AuditLogService>;
  const email = {
    send: jest.fn().mockResolvedValue(true),
  } as unknown as jest.Mocked<EmailService>;
  const links = {
    interviewUrl: jest.fn().mockReturnValue('http://localhost:3001/interview/app-1'),
    statusUrl: jest.fn().mockReturnValue('http://localhost:3001/status/app-1'),
  } as unknown as jest.Mocked<CandidateLinksService>;

  return {
    service: new CvUploadService(prisma, storage, jobQueue, audit, email, links),
    prisma,
    storage,
    jobQueue,
    audit,
    email,
    links,
  };
}

function p2002Error(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
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

    it('persists candidate-supplied contact info on a fresh profile', async () => {
      const { service, prisma } = buildService();
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
        'SELF_APPLIED',
        undefined,
        {
          name: 'Jane Candidate',
          email: 'jane@example.com',
          phone: '555-0100',
        },
      );

      expect(prisma.candidateProfile.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            candidateName: 'Jane Candidate',
            candidateEmail: 'jane@example.com',
            candidatePhone: '555-0100',
          }),
        }),
      );
      expect(prisma.candidateProfile.update).not.toHaveBeenCalled();
    });

    it('overwrites contact info on a content-hash-deduped reused profile', async () => {
      const { service, prisma } = buildService();
      (prisma.job.findUnique as jest.Mock).mockResolvedValue({
        id: 'job-1',
        status: 'PUBLISHED',
      });
      (prisma.candidateProfile.findFirst as jest.Mock).mockResolvedValue({
        id: 'cand-1',
        cvStatus: 'READY',
      });
      (prisma.candidateProfile.update as jest.Mock).mockResolvedValue({
        id: 'cand-1',
        cvStatus: 'READY',
      });
      (prisma.application.upsert as jest.Mock).mockResolvedValue({
        id: 'app-1',
      });

      await service.uploadCv(
        'job-1',
        { buffer: PDF_BYTES, originalname: 'resume.pdf' },
        'SELF_APPLIED',
        undefined,
        {
          name: 'Jane Candidate',
          email: 'jane@example.com',
          phone: '555-0100',
        },
      );

      expect(prisma.candidateProfile.create).not.toHaveBeenCalled();
      expect(prisma.candidateProfile.update).toHaveBeenCalledWith({
        where: { id: 'cand-1' },
        data: {
          candidateName: 'Jane Candidate',
          candidateEmail: 'jane@example.com',
          candidatePhone: '555-0100',
        },
      });
    });

    it('does not touch candidateProfile.update when no contact info is supplied (HR-sourced path)', async () => {
      const { service, prisma } = buildService();
      (prisma.job.findUnique as jest.Mock).mockResolvedValue({
        id: 'job-1',
        status: 'DRAFT',
      });
      (prisma.candidateProfile.findFirst as jest.Mock).mockResolvedValue({
        id: 'cand-1',
        cvStatus: 'READY',
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

      expect(prisma.candidateProfile.update).not.toHaveBeenCalled();
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
      const { service, prisma, storage, jobQueue } = buildService();
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
      expect(jobQueue.enqueue).not.toHaveBeenCalledWith(
        CV_PROCESSING_JOB_TYPE,
        expect.anything(),
      );
    });

    it('auto-triggers scoring for the new application when a content-hash-reused CV is already READY', async () => {
      const { service, prisma, jobQueue } = buildService();
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
      expect(jobQueue.enqueue).toHaveBeenCalledWith(
        CV_MATCH_ALL_PENDING_JOB_TYPE,
        'existing-cand',
      );
    });

    it('queues cv-processing for a brand-new profile', async () => {
      const { service, prisma, jobQueue } = buildService();
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
        'SELF_APPLIED',
      );

      expect(jobQueue.enqueue).toHaveBeenCalledWith(
        CV_PROCESSING_JOB_TYPE,
        'cand-1',
      );
    });

    it('converts a (jobId, applicantEmail) unique-constraint race into the same ConflictException as the pre-check', async () => {
      const { service, prisma } = buildService();
      (prisma.job.findUnique as jest.Mock).mockResolvedValue({
        id: 'job-1',
        status: 'PUBLISHED',
      });
      // The pre-check race: findFirst sees nothing yet (a concurrent request
      // for the same email hasn't committed its Application row when this
      // one reads), so both proceed — the DB unique index is what actually
      // catches the second writer.
      (prisma.application.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.candidateProfile.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.candidateProfile.create as jest.Mock).mockResolvedValue({
        id: 'cand-race',
        cvStatus: 'PROCESSING',
      });
      (prisma.application.upsert as jest.Mock).mockRejectedValue(p2002Error());

      await expect(
        service.uploadCv(
          'job-1',
          { buffer: PDF_BYTES, originalname: 'resume.pdf' },
          'SELF_APPLIED',
          undefined,
          { name: 'Jane Candidate', email: 'jane@example.com', phone: '555-0100' },
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rethrows a non-P2002 error from the application upsert unchanged', async () => {
      const { service, prisma } = buildService();
      (prisma.job.findUnique as jest.Mock).mockResolvedValue({
        id: 'job-1',
        status: 'PUBLISHED',
      });
      (prisma.candidateProfile.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.candidateProfile.create as jest.Mock).mockResolvedValue({
        id: 'cand-1',
        cvStatus: 'PROCESSING',
      });
      (prisma.application.upsert as jest.Mock).mockRejectedValue(
        new Error('connection lost'),
      );

      await expect(
        service.uploadCv(
          'job-1',
          { buffer: PDF_BYTES, originalname: 'resume.pdf' },
          'SELF_APPLIED',
        ),
      ).rejects.toThrow('connection lost');
    });

    it('rejects a second application to the same job with the same email, with ConflictException', async () => {
      const { service, prisma } = buildService();
      (prisma.job.findUnique as jest.Mock).mockResolvedValue({
        id: 'job-1',
        status: 'PUBLISHED',
      });
      (prisma.application.findFirst as jest.Mock).mockResolvedValue({
        id: 'existing-app',
      });

      await expect(
        service.uploadCv(
          'job-1',
          { buffer: PDF_BYTES, originalname: 'resume.pdf' },
          'SELF_APPLIED',
          undefined,
          {
            name: 'Jane Candidate',
            email: 'jane@example.com',
            phone: '555-0100',
          },
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.candidateProfile.findFirst).not.toHaveBeenCalled();
      expect(prisma.application.upsert).not.toHaveBeenCalled();
    });

    it('includes the existing applicationId in the 409 payload so the apply form can link back to it', async () => {
      const { service, prisma } = buildService();
      (prisma.job.findUnique as jest.Mock).mockResolvedValue({
        id: 'job-1',
        status: 'PUBLISHED',
      });
      (prisma.application.findFirst as jest.Mock).mockResolvedValue({
        id: 'existing-app',
      });

      try {
        await service.uploadCv(
          'job-1',
          { buffer: PDF_BYTES, originalname: 'resume.pdf' },
          'SELF_APPLIED',
          undefined,
          { name: 'Jane Candidate', email: 'jane@example.com', phone: '555-0100' },
        );
        throw new Error('expected uploadCv to reject');
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictException);
        expect((err as ConflictException).getResponse()).toEqual(
          expect.objectContaining({ applicationId: 'existing-app' }),
        );
      }
    });

    it('sends an APPLICATION_RECEIVED confirmation email with a status link once the application is created', async () => {
      const { service, prisma, email, links } = buildService();
      (prisma.job.findUnique as jest.Mock).mockResolvedValue({
        id: 'job-1',
        status: 'PUBLISHED',
        title: 'Senior Backend Engineer',
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
        'SELF_APPLIED',
        undefined,
        {
          name: 'Jane Candidate',
          email: 'jane@example.com',
          phone: '555-0100',
        },
      );

      expect(email.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'jane@example.com',
          type: 'APPLICATION_RECEIVED',
          variables: expect.objectContaining({
            candidateName: 'Jane Candidate',
            jobTitle: 'Senior Backend Engineer',
            applicationReference: 'app-1',
            statusLink: 'http://localhost:3001/status/app-1',
          }),
        }),
      );
      expect(links.statusUrl).toHaveBeenCalledWith('app-1');
      expect(prisma.emailLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            applicationId: 'app-1',
            type: 'APPLICATION_RECEIVED',
          }),
        }),
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
