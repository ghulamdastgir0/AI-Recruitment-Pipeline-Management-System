import { NotFoundException } from '@nestjs/common';
import { AuditLogService } from '../audit/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { CandidateCommentsService } from './candidate-comments.service';

function buildService() {
  const prisma = {
    application: { findUnique: jest.fn() },
    candidateComment: { create: jest.fn(), findMany: jest.fn() },
  } as unknown as jest.Mocked<PrismaService>;
  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<AuditLogService>;
  return {
    service: new CandidateCommentsService(prisma, audit),
    prisma,
    audit,
  };
}

describe('CandidateCommentsService', () => {
  describe('add', () => {
    it('throws NotFoundException when the candidate has no application for that job posting', async () => {
      const { service, prisma } = buildService();
      (prisma.application.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.add('cand-1', 'job-1', 'hm-1', 'Great candidate'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('creates the comment and audit-logs candidate_comment.created', async () => {
      const { service, prisma, audit } = buildService();
      (prisma.application.findUnique as jest.Mock).mockResolvedValue({
        id: 'app-1',
      });
      (prisma.candidateComment.create as jest.Mock).mockResolvedValue({
        id: 'comment-1',
        candidateId: 'cand-1',
        jobPostingId: 'job-1',
        authorUserId: 'hm-1',
        content: 'Great candidate',
        createdAt: new Date(),
        updatedAt: new Date(),
        author: { firstName: 'Pat', lastName: 'Manager' },
      });

      const result = await service.add(
        'cand-1',
        'job-1',
        'hm-1',
        'Great candidate',
      );

      expect(result.id).toBe('comment-1');
      expect(result.authorName).toBe('Pat Manager');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 'hm-1',
          action: 'candidate_comment.created',
        }),
      );
    });
  });

  describe('list', () => {
    it('returns comments scoped to the candidate/job-posting pair, attributed by author name', async () => {
      const { service, prisma } = buildService();
      (prisma.candidateComment.findMany as jest.Mock).mockResolvedValue([
        { id: 'comment-1', author: { firstName: 'Pat', lastName: 'Manager' } },
      ]);

      const result = await service.list('cand-1', 'job-1');

      expect(result).toHaveLength(1);
      expect(result[0].authorName).toBe('Pat Manager');
      expect(prisma.candidateComment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { candidateId: 'cand-1', jobPostingId: 'job-1' },
        }),
      );
    });
  });
});
