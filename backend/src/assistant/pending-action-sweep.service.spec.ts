import { PrismaService } from '../prisma/prisma.service';
import { PendingActionSweepService } from './pending-action-sweep.service';

function buildService() {
  const prisma = {
    pendingAssistantAction: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  } as unknown as jest.Mocked<PrismaService>;

  return { service: new PendingActionSweepService(prisma), prisma };
}

describe('PendingActionSweepService', () => {
  it('expires only PENDING actions past their expiresAt', async () => {
    const { service, prisma } = buildService();

    await service.expireDuePendingActions();

    expect(prisma.pendingAssistantAction.updateMany).toHaveBeenCalledWith({
      where: { status: 'PENDING', expiresAt: { lt: expect.any(Date) } },
      data: { status: 'EXPIRED' },
    });
  });

  it('does not throw when nothing is due', async () => {
    const { service } = buildService();
    await expect(service.expireDuePendingActions()).resolves.toBeUndefined();
  });
});
