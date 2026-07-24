import { PrismaService } from '../../prisma/prisma.service';
import { InterviewExpiryService } from './interview-expiry.service';

function buildService() {
  const prisma = {
    aIInterviewSession: {
      findMany: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    application: {
      update: jest.fn().mockResolvedValue({}),
    },
  } as unknown as jest.Mocked<PrismaService>;

  return { service: new InterviewExpiryService(prisma), prisma };
}

describe('InterviewExpiryService', () => {
  it('queries only PENDING/IN_PROGRESS sessions past their window', async () => {
    const { service, prisma } = buildService();
    (prisma.aIInterviewSession.findMany as jest.Mock).mockResolvedValue([]);

    await service.expireDueSessions();

    expect(prisma.aIInterviewSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['PENDING', 'IN_PROGRESS'] },
          windowExpiresAt: { lt: expect.any(Date) },
        }),
      }),
    );
  });

  it('flips each overdue session to EXPIRED and its application to INTERVIEW_EXPIRED', async () => {
    const { service, prisma } = buildService();
    (prisma.aIInterviewSession.findMany as jest.Mock).mockResolvedValue([
      { id: 'session-1', applicationId: 'app-1' },
      { id: 'session-2', applicationId: 'app-2' },
    ]);

    await service.expireDueSessions();

    expect(prisma.aIInterviewSession.update).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      data: { status: 'EXPIRED' },
    });
    expect(prisma.application.update).toHaveBeenCalledWith({
      where: { id: 'app-1' },
      data: { status: 'INTERVIEW_EXPIRED' },
    });
    expect(prisma.aIInterviewSession.update).toHaveBeenCalledWith({
      where: { id: 'session-2' },
      data: { status: 'EXPIRED' },
    });
    expect(prisma.application.update).toHaveBeenCalledWith({
      where: { id: 'app-2' },
      data: { status: 'INTERVIEW_EXPIRED' },
    });
  });

  it('does nothing when no sessions are overdue', async () => {
    const { service, prisma } = buildService();
    (prisma.aIInterviewSession.findMany as jest.Mock).mockResolvedValue([]);

    await service.expireDueSessions();

    expect(prisma.aIInterviewSession.update).not.toHaveBeenCalled();
    expect(prisma.application.update).not.toHaveBeenCalled();
  });
});
