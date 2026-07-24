import { PrismaService } from '../prisma/prisma.service';
import { DraftJobsSweepService } from './draft-jobs-sweep.service';

function buildService() {
  const prisma = {
    job: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
  } as unknown as jest.Mocked<PrismaService>;

  return { service: new DraftJobsSweepService(prisma), prisma };
}

describe('DraftJobsSweepService', () => {
  it('archives only old DRAFT jobs with no Hiring Managers and no applications', async () => {
    const { service, prisma } = buildService();

    await service.archiveAbandonedDrafts();

    expect(prisma.job.updateMany).toHaveBeenCalledWith({
      where: {
        status: 'DRAFT',
        createdAt: { lt: expect.any(Date) },
        hiringManagers: { none: {} },
        applications: { none: {} },
      },
      data: { status: 'ARCHIVED' },
    });
  });

  it('does not throw when nothing is due', async () => {
    const { service } = buildService();
    await expect(service.archiveAbandonedDrafts()).resolves.toBeUndefined();
  });
});
