import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuditLogService } from '../audit/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { JobPostingAssignmentsService } from './job-posting-assignments.service';

function buildService() {
  const prisma = {
    job: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    jobPostingHiringManager: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn(),
    },
  } as unknown as jest.Mocked<PrismaService>;
  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<AuditLogService>;
  return {
    service: new JobPostingAssignmentsService(prisma, audit),
    prisma,
    audit,
  };
}

describe('JobPostingAssignmentsService', () => {
  describe('assign', () => {
    it('rejects a target user who is not a HIRING_MANAGER', async () => {
      const { service, prisma } = buildService();
      (prisma.job.findUnique as jest.Mock).mockResolvedValue({ id: 'job-1' });
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-1',
        role: 'HR_ADMIN',
      });

      await expect(
        service.assign('job-1', 'user-1', 'actor-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException for an unknown job posting', async () => {
      const { service, prisma } = buildService();
      (prisma.job.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.assign('missing-job', 'user-1', 'actor-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('upserts (idempotent re-assignment) and audit-logs', async () => {
      const { service, prisma, audit } = buildService();
      (prisma.job.findUnique as jest.Mock).mockResolvedValue({ id: 'job-1' });
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'hm-1',
        role: 'HIRING_MANAGER',
      });
      (prisma.jobPostingHiringManager.upsert as jest.Mock).mockResolvedValue({
        id: 'assignment-1',
        jobId: 'job-1',
        hiringManagerUserId: 'hm-1',
        assignedByUserId: 'actor-1',
        assignedAt: new Date(),
      });

      const result = await service.assign('job-1', 'hm-1', 'actor-1');

      expect(result.id).toBe('assignment-1');
      expect(prisma.jobPostingHiringManager.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            jobId_hiringManagerUserId: {
              jobId: 'job-1',
              hiringManagerUserId: 'hm-1',
            },
          },
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'job_posting.hiring_manager_assigned',
        }),
      );
    });
  });

  describe('unassign', () => {
    it('throws NotFoundException when no assignment exists', async () => {
      const { service, prisma } = buildService();
      (
        prisma.jobPostingHiringManager.findUnique as jest.Mock
      ).mockResolvedValue(null);

      await expect(
        service.unassign('job-1', 'hm-1', 'actor-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.jobPostingHiringManager.delete).not.toHaveBeenCalled();
    });

    it('deletes the row and audit-logs when an assignment exists', async () => {
      const { service, prisma, audit } = buildService();
      (
        prisma.jobPostingHiringManager.findUnique as jest.Mock
      ).mockResolvedValue({ id: 'assignment-1' });

      await service.unassign('job-1', 'hm-1', 'actor-1');

      expect(prisma.jobPostingHiringManager.delete).toHaveBeenCalledWith({
        where: {
          jobId_hiringManagerUserId: {
            jobId: 'job-1',
            hiringManagerUserId: 'hm-1',
          },
        },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'job_posting.hiring_manager_unassigned',
        }),
      );
    });
  });
});
