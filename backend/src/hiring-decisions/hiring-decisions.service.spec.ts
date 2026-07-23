import { ConflictException, NotFoundException } from '@nestjs/common';
import { AuditLogService } from '../audit/audit-log.service';
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

  return {
    service: new HiringDecisionsService(prisma, email, audit),
    prisma,
    email,
    audit,
  };
}

function mockApplication() {
  return {
    id: 'app-1',
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
});
