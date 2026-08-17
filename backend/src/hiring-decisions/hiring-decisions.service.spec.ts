import { ConflictException, NotFoundException } from '@nestjs/common';
import { AuditLogService } from '../audit/audit-log.service';
import { CandidateCommentsService } from '../candidate-comments/candidate-comments.service';
import { JobPostingsService } from '../job-postings/job-postings.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../shared/email/email.service';
import { HiringDecisionsService } from './hiring-decisions.service';

function buildService() {
  const prisma = {
    application: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    emailLog: { create: jest.fn().mockResolvedValue({}) },
  } as unknown as jest.Mocked<PrismaService>;
  const email = {
    send: jest.fn().mockResolvedValue(true),
  } as unknown as jest.Mocked<EmailService>;
  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<AuditLogService>;
  const jobPostings = {
    incrementHiredCountAndMaybeAutoClose: jest
      .fn()
      .mockResolvedValue(undefined),
  } as unknown as jest.Mocked<JobPostingsService>;
  const comments = {
    add: jest.fn().mockResolvedValue({
      id: 'comment-1',
      candidateId: 'cand-1',
      jobPostingId: 'job-1',
      authorUserId: 'hm-1',
      content: 'Looks strong.',
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  } as unknown as jest.Mocked<CandidateCommentsService>;

  return {
    service: new HiringDecisionsService(
      prisma,
      email,
      audit,
      jobPostings,
      comments,
    ),
    prisma,
    email,
    audit,
    jobPostings,
    comments,
  };
}

function mockApplication(
  overrides: { status?: string; terminationReason?: string | null } = {},
) {
  return {
    id: 'app-1',
    status: overrides.status ?? 'MANAGER_REVIEWED',
    interviewSession:
      overrides.terminationReason === undefined
        ? null
        : { terminationReason: overrides.terminationReason },
    job: { title: 'Backend Engineer' },
    candidateProfile: {
      extractedDataJson: { name: 'Jane', email: 'jane@example.com' },
    },
  };
}

describe('HiringDecisionsService', () => {
  it('throws NotFoundException when no application exists for the candidate/job pair', async () => {
    const { service, prisma } = buildService();
    (prisma.application.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(
      service.decide('cand-1', 'job-1', 'hr-1', { decision: 'SELECTED' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('SELECTED: sets status, sends a SELECTION email, logs it, and audit-logs the decision', async () => {
    const { service, prisma, email, audit } = buildService();
    (prisma.application.findUnique as jest.Mock).mockResolvedValue(
      mockApplication(),
    );

    const result = await service.decide('cand-1', 'job-1', 'hr-1', {
      decision: 'SELECTED',
    });

    expect(result).toEqual({
      applicationId: 'app-1',
      status: 'SELECTED',
      emailSent: true,
    });
    expect(prisma.application.update).toHaveBeenCalledWith({
      where: { id: 'app-1' },
      data: { status: 'SELECTED' },
    });
    expect(email.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'jane@example.com', type: 'SELECTION' }),
    );
    expect(prisma.emailLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          applicationId: 'app-1',
          type: 'SELECTION',
          triggeredByUserId: 'hr-1',
        }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'hr-1',
        action: 'application_decision.made',
      }),
    );
  });

  it('NEXT_ROUND: forwards nextRoundTime/nextRoundDeadline into the email variables', async () => {
    const { service, prisma, email } = buildService();
    (prisma.application.findUnique as jest.Mock).mockResolvedValue(
      mockApplication(),
    );

    await service.decide('cand-1', 'job-1', 'hr-1', {
      decision: 'NEXT_ROUND',
      nextRoundTime: '2026-08-05T14:00:00.000Z',
      nextRoundDeadline: '2026-08-08T23:59:00.000Z',
    });

    expect(prisma.application.update).toHaveBeenCalledWith({
      where: { id: 'app-1' },
      data: { status: 'NEXT_ROUND' },
    });
    expect(email.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'NEXT_ROUND',
        variables: expect.objectContaining({
          nextRoundTime: new Date('2026-08-05T14:00:00.000Z'),
          nextRoundDeadline: new Date('2026-08-08T23:59:00.000Z'),
        }),
      }),
    );
  });

  it('REJECTED: sends a REJECTION email', async () => {
    const { service, prisma, email } = buildService();
    (prisma.application.findUnique as jest.Mock).mockResolvedValue(
      mockApplication(),
    );

    await service.decide('cand-1', 'job-1', 'hr-1', { decision: 'REJECTED' });

    expect(prisma.application.update).toHaveBeenCalledWith({
      where: { id: 'app-1' },
      data: { status: 'REJECTED' },
    });
    expect(email.send).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'REJECTION' }),
    );
  });

  it('REJECTED: allowed directly from IN_REVIEW when the interview was auto-submitted by the proctoring system', async () => {
    const { service, prisma, email } = buildService();
    (prisma.application.findUnique as jest.Mock).mockResolvedValue(
      mockApplication({
        status: 'IN_REVIEW',
        terminationReason: 'AUTO_SUBMITTED_VIOLATIONS',
      }),
    );

    const result = await service.decide('cand-1', 'job-1', 'hr-1', {
      decision: 'REJECTED',
    });

    expect(result.status).toBe('REJECTED');
    expect(prisma.application.update).toHaveBeenCalledWith({
      where: { id: 'app-1' },
      data: { status: 'REJECTED' },
    });
    expect(email.send).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'REJECTION' }),
    );
  });

  it('SELECTED/NEXT_ROUND: still blocked from IN_REVIEW even when the interview was auto-submitted — only a direct REJECTED bypasses manager review', async () => {
    const { service, prisma } = buildService();
    (prisma.application.findUnique as jest.Mock).mockResolvedValue(
      mockApplication({
        status: 'IN_REVIEW',
        terminationReason: 'AUTO_SUBMITTED_VIOLATIONS',
      }),
    );

    await expect(
      service.decide('cand-1', 'job-1', 'hr-1', { decision: 'SELECTED' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('REJECTED: still blocked from IN_REVIEW when the interview completed normally (no terminationReason)', async () => {
    const { service, prisma } = buildService();
    (prisma.application.findUnique as jest.Mock).mockResolvedValue(
      mockApplication({ status: 'IN_REVIEW' }),
    );

    await expect(
      service.decide('cand-1', 'job-1', 'hr-1', { decision: 'REJECTED' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('throws ConflictException (and never re-sends an email) when the application already has a decision', async () => {
    const { service, prisma, email } = buildService();
    (prisma.application.findUnique as jest.Mock).mockResolvedValue(
      mockApplication({ status: 'SELECTED' }),
    );

    await expect(
      service.decide('cand-1', 'job-1', 'hr-1', { decision: 'REJECTED' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.application.update).not.toHaveBeenCalled();
    expect(email.send).not.toHaveBeenCalled();
  });

  it('does not write an EmailLog row when the email failed to send', async () => {
    const { service, prisma, email } = buildService();
    (prisma.application.findUnique as jest.Mock).mockResolvedValue(
      mockApplication(),
    );
    (email.send as jest.Mock).mockResolvedValue(false);

    const result = await service.decide('cand-1', 'job-1', 'hr-1', {
      decision: 'REJECTED',
    });

    expect(result.emailSent).toBe(false);
    expect(prisma.emailLog.create).not.toHaveBeenCalled();
  });

  describe('sendOfferLetter', () => {
    it('throws NotFoundException when no application exists for the candidate/job pair', async () => {
      const { service, prisma } = buildService();
      (prisma.application.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.sendOfferLetter('cand-1', 'job-1', 'hr-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ConflictException when the application is not SELECTED', async () => {
      const { service, prisma, jobPostings } = buildService();
      (prisma.application.findUnique as jest.Mock).mockResolvedValue(
        mockApplication({ status: 'MANAGER_REVIEW' }),
      );

      await expect(
        service.sendOfferLetter('cand-1', 'job-1', 'hr-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.application.update).not.toHaveBeenCalled();
      expect(
        jobPostings.incrementHiredCountAndMaybeAutoClose,
      ).not.toHaveBeenCalled();
    });

    it('moves a SELECTED application to HIRED, sends OFFER_LETTER, and increments hiredCount', async () => {
      const { service, prisma, email, jobPostings, audit } = buildService();
      (prisma.application.findUnique as jest.Mock).mockResolvedValue(
        mockApplication({ status: 'SELECTED' }),
      );

      const result = await service.sendOfferLetter(
        'cand-1',
        'job-1',
        'hr-1',
        'Start date: Sept 1.',
      );

      expect(result).toEqual({
        applicationId: 'app-1',
        status: 'HIRED',
        emailSent: true,
      });
      expect(prisma.application.update).toHaveBeenCalledWith({
        where: { id: 'app-1' },
        data: { status: 'HIRED' },
      });
      expect(email.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'jane@example.com',
          type: 'OFFER_LETTER',
          variables: expect.objectContaining({
            offerDetails: 'Start date: Sept 1.',
          }),
        }),
      );
      expect(prisma.emailLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            applicationId: 'app-1',
            type: 'OFFER_LETTER',
            triggeredByUserId: 'hr-1',
          }),
        }),
      );
      expect(
        jobPostings.incrementHiredCountAndMaybeAutoClose,
      ).toHaveBeenCalledWith('job-1', 'hr-1');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'application_offer_letter.sent',
          actorUserId: 'hr-1',
        }),
      );
    });

    it('does not write an EmailLog row when the offer email fails to send, but still increments hiredCount', async () => {
      const { service, prisma, email, jobPostings } = buildService();
      (prisma.application.findUnique as jest.Mock).mockResolvedValue(
        mockApplication({ status: 'SELECTED' }),
      );
      (email.send as jest.Mock).mockResolvedValue(false);

      const result = await service.sendOfferLetter('cand-1', 'job-1', 'hr-1');

      expect(result.emailSent).toBe(false);
      expect(prisma.emailLog.create).not.toHaveBeenCalled();
      expect(
        jobPostings.incrementHiredCountAndMaybeAutoClose,
      ).toHaveBeenCalledWith('job-1', 'hr-1');
    });
  });

  describe('moveToManagerReview', () => {
    it('throws NotFoundException when no application exists for the candidate/job pair', async () => {
      const { service, prisma } = buildService();
      (prisma.application.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.moveToManagerReview('cand-1', 'job-1', 'hr-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ConflictException when the application is not IN_REVIEW', async () => {
      const { service, prisma } = buildService();
      (prisma.application.findUnique as jest.Mock).mockResolvedValue({
        id: 'app-1',
        status: 'INTERVIEW_PENDING',
      });

      await expect(
        service.moveToManagerReview('cand-1', 'job-1', 'hr-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.application.update).not.toHaveBeenCalled();
    });

    it('moves an IN_REVIEW application to MANAGER_REVIEW and audit-logs it', async () => {
      const { service, prisma, audit } = buildService();
      (prisma.application.findUnique as jest.Mock).mockResolvedValue({
        id: 'app-1',
        status: 'IN_REVIEW',
      });

      const result = await service.moveToManagerReview(
        'cand-1',
        'job-1',
        'hr-1',
      );

      expect(result).toEqual({
        applicationId: 'app-1',
        status: 'MANAGER_REVIEW',
      });
      expect(prisma.application.update).toHaveBeenCalledWith({
        where: { id: 'app-1' },
        data: { status: 'MANAGER_REVIEW' },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 'hr-1',
          action: 'application.moved_to_manager_review',
          resourceId: 'app-1',
        }),
      );
    });
  });

  describe('markManagerReviewed', () => {
    it('throws NotFoundException when no application exists for the candidate/job pair', async () => {
      const { service, prisma } = buildService();
      (prisma.application.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.markManagerReviewed('cand-1', 'job-1', 'hm-1', 'Looks strong.'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ConflictException when the application is not MANAGER_REVIEW', async () => {
      const { service, prisma, comments } = buildService();
      (prisma.application.findUnique as jest.Mock).mockResolvedValue({
        id: 'app-1',
        status: 'IN_REVIEW',
      });

      await expect(
        service.markManagerReviewed('cand-1', 'job-1', 'hm-1', 'Looks strong.'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(comments.add).not.toHaveBeenCalled();
      expect(prisma.application.update).not.toHaveBeenCalled();
    });

    it('posts the comment, moves a MANAGER_REVIEW application to MANAGER_REVIEWED, and audit-logs it', async () => {
      const { service, prisma, comments, audit } = buildService();
      (prisma.application.findUnique as jest.Mock).mockResolvedValue({
        id: 'app-1',
        status: 'MANAGER_REVIEW',
      });

      const result = await service.markManagerReviewed(
        'cand-1',
        'job-1',
        'hm-1',
        'Looks strong.',
      );

      expect(comments.add).toHaveBeenCalledWith(
        'cand-1',
        'job-1',
        'hm-1',
        'Looks strong.',
      );
      expect(prisma.application.update).toHaveBeenCalledWith({
        where: { id: 'app-1' },
        data: { status: 'MANAGER_REVIEWED' },
      });
      expect(result).toEqual(
        expect.objectContaining({
          applicationId: 'app-1',
          status: 'MANAGER_REVIEWED',
          comment: expect.objectContaining({ id: 'comment-1' }),
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 'hm-1',
          action: 'application.marked_manager_reviewed',
          resourceId: 'app-1',
        }),
      );
    });
  });

  describe('revertManagerReview', () => {
    it('throws NotFoundException when no application exists for the candidate/job pair', async () => {
      const { service, prisma } = buildService();
      (prisma.application.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.revertManagerReview('cand-1', 'job-1', 'hm-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ConflictException when the application is not MANAGER_REVIEWED (e.g. HR already decided)', async () => {
      const { service, prisma } = buildService();
      (prisma.application.findUnique as jest.Mock).mockResolvedValue({
        id: 'app-1',
        status: 'SELECTED',
      });

      await expect(
        service.revertManagerReview('cand-1', 'job-1', 'hm-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.application.update).not.toHaveBeenCalled();
    });

    it('moves a MANAGER_REVIEWED application back to MANAGER_REVIEW and audit-logs it', async () => {
      const { service, prisma, audit } = buildService();
      (prisma.application.findUnique as jest.Mock).mockResolvedValue({
        id: 'app-1',
        status: 'MANAGER_REVIEWED',
      });

      const result = await service.revertManagerReview('cand-1', 'job-1', 'hm-1');

      expect(prisma.application.update).toHaveBeenCalledWith({
        where: { id: 'app-1' },
        data: { status: 'MANAGER_REVIEW' },
      });
      expect(result).toEqual({ applicationId: 'app-1', status: 'MANAGER_REVIEW' });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 'hm-1',
          action: 'application.manager_review_reverted',
          resourceId: 'app-1',
        }),
      );
    });
  });

  describe('revertDecision', () => {
    it('throws NotFoundException when no application exists for the candidate/job pair', async () => {
      const { service, prisma } = buildService();
      (prisma.application.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.revertDecision('cand-1', 'job-1', 'hr-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each(['REJECTED', 'HIRED', 'MANAGER_REVIEWED', 'IN_REVIEW'])(
      'throws ConflictException when the application is %s',
      async (status) => {
        const { service, prisma } = buildService();
        (prisma.application.findUnique as jest.Mock).mockResolvedValue({
          id: 'app-1',
          status,
        });

        await expect(
          service.revertDecision('cand-1', 'job-1', 'hr-1'),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(prisma.application.update).not.toHaveBeenCalled();
      },
    );

    it.each(['SELECTED', 'NEXT_ROUND'])(
      'moves a %s application back to MANAGER_REVIEWED and audit-logs it',
      async (status) => {
        const { service, prisma, audit } = buildService();
        (prisma.application.findUnique as jest.Mock).mockResolvedValue({
          id: 'app-1',
          status,
        });

        const result = await service.revertDecision('cand-1', 'job-1', 'hr-1');

        expect(prisma.application.update).toHaveBeenCalledWith({
          where: { id: 'app-1' },
          data: { status: 'MANAGER_REVIEWED' },
        });
        expect(result).toEqual({
          applicationId: 'app-1',
          status: 'MANAGER_REVIEWED',
        });
        expect(audit.record).toHaveBeenCalledWith(
          expect.objectContaining({
            actorUserId: 'hr-1',
            action: 'application_decision.reverted',
            resourceId: 'app-1',
            details: { previousStatus: status },
          }),
        );
      },
    );
  });
});
