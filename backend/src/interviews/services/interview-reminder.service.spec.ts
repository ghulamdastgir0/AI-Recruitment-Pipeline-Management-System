import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../shared/email/email.service';
import { CandidateLinksService } from '../../shared/links/candidate-links.service';
import { InterviewReminderService } from './interview-reminder.service';

function buildService() {
  const prisma = {
    aIInterviewSession: {
      findMany: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    emailLog: { create: jest.fn().mockResolvedValue({}) },
  } as unknown as jest.Mocked<PrismaService>;
  const email = {
    send: jest.fn().mockResolvedValue(true),
  } as unknown as jest.Mocked<EmailService>;
  const links = {
    interviewUrl: jest
      .fn()
      .mockReturnValue('http://localhost:3001/interview/app-1'),
  } as unknown as jest.Mocked<CandidateLinksService>;

  return {
    service: new InterviewReminderService(prisma, email, links),
    prisma,
    email,
  };
}

function dueSession() {
  return {
    id: 'session-1',
    windowExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    application: {
      id: 'app-1',
      job: { title: 'Backend Engineer' },
      candidateProfile: {
        extractedDataJson: {
          name: 'Jane Candidate',
          email: 'jane@example.com',
        },
      },
    },
  };
}

describe('InterviewReminderService', () => {
  it('emails INTERVIEW_REMINDER and marks reminderSentAt for a due, unstarted session', async () => {
    const { service, prisma, email } = buildService();
    (prisma.aIInterviewSession.findMany as jest.Mock).mockResolvedValue([
      dueSession(),
    ]);

    await service.sendDueReminders();

    expect(email.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'jane@example.com',
        type: 'INTERVIEW_REMINDER',
        variables: expect.objectContaining({
          interviewLink: 'http://localhost:3001/interview/app-1',
        }),
      }),
    );
    expect(prisma.aIInterviewSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'session-1' },
        data: expect.objectContaining({ reminderSentAt: expect.any(Date) }),
      }),
    );
    expect(prisma.emailLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { applicationId: 'app-1', type: 'INTERVIEW_REMINDER' },
      }),
    );
  });

  it('queries only PENDING sessions without a reminder yet, past the delay window', async () => {
    const { service, prisma } = buildService();
    (prisma.aIInterviewSession.findMany as jest.Mock).mockResolvedValue([]);

    await service.sendDueReminders();

    expect(prisma.aIInterviewSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'PENDING',
          reminderSentAt: null,
        }),
      }),
    );
  });

  it('still marks reminderSentAt (no infinite retry) even when the email fails to send', async () => {
    const { service, prisma, email } = buildService();
    (prisma.aIInterviewSession.findMany as jest.Mock).mockResolvedValue([
      dueSession(),
    ]);
    (email.send as jest.Mock).mockResolvedValue(false);

    await service.sendDueReminders();

    expect(prisma.aIInterviewSession.update).toHaveBeenCalled();
    expect(prisma.emailLog.create).not.toHaveBeenCalled();
  });
});
