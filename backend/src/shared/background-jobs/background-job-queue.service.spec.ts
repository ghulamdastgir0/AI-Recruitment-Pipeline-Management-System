import { PrismaService } from '../../prisma/prisma.service';
import { BackgroundJobQueueService } from './background-job-queue.service';

function buildService() {
  const rows = new Map<string, { id: string; type: string; targetId: string; status: string; attempts: number; error: string | null; createdAt: Date; updatedAt: Date }>();
  let seq = 0;

  const prisma = {
    backgroundJob: {
      create: jest.fn(async ({ data }: { data: { type: string; targetId: string } }) => {
        const id = `job-${++seq}`;
        const row = {
          id,
          type: data.type,
          targetId: data.targetId,
          status: 'QUEUED',
          attempts: 0,
          error: null,
          createdAt: new Date(Date.now() + seq),
          updatedAt: new Date(),
        };
        rows.set(id, row);
        return row;
      }),
      findFirst: jest.fn(async ({ where }: { where: { status: string; attempts: { lt: number } } }) => {
        const candidates = [...rows.values()]
          .filter((r) => r.status === where.status && r.attempts < where.attempts.lt)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        return candidates[0] ?? null;
      }),
      updateMany: jest.fn(async ({ where, data }: { where: { id?: string; status?: string | { in: string[] } }; data: Record<string, unknown> }) => {
        let count = 0;
        for (const row of rows.values()) {
          if (where.id && row.id !== where.id) continue;
          if (where.status) {
            const statuses = typeof where.status === 'string' ? [where.status] : where.status.in;
            if (!statuses.includes(row.status)) continue;
          }
          Object.assign(row, applyIncrement(data));
          count++;
        }
        return { count };
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = rows.get(where.id);
        if (row) Object.assign(row, data);
        return row;
      }),
      findMany: jest.fn(async () => []),
    },
  } as unknown as jest.Mocked<PrismaService>;

  return { service: new BackgroundJobQueueService(prisma), prisma, rows };
}

function applyIncrement(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  if (
    data.attempts &&
    typeof data.attempts === 'object' &&
    'increment' in (data.attempts as object)
  ) {
    out.attempts = ((data.attempts as { increment: number }).increment);
  }
  return out;
}

describe('BackgroundJobQueueService', () => {
  it('persists the job before draining, then runs the registered handler and marks it COMPLETED', async () => {
    const { service, rows } = buildService();
    const handler = jest.fn().mockResolvedValue(undefined);
    service.registerHandler('cv-processing', handler);

    await service.enqueue('cv-processing', 'cand-1');
    await flushMicrotasks();

    expect(handler).toHaveBeenCalledWith('cand-1');
    const job = [...rows.values()][0];
    expect(job.status).toBe('COMPLETED');
  });

  it('marks a job FAILED (with the error message) when its handler throws, without losing the row', async () => {
    const { service, rows } = buildService();
    service.registerHandler('cv-processing', () => {
      throw new Error('boom');
    });

    await service.enqueue('cv-processing', 'cand-1');
    await flushMicrotasks();

    const job = [...rows.values()][0];
    expect(job.status).toBe('FAILED');
    expect(job.error).toBe('boom');
  });

  it('marks a job FAILED when no handler is registered for its type', async () => {
    const { service, rows } = buildService();

    await service.enqueue('unknown-type', 'x-1');
    await flushMicrotasks();

    const job = [...rows.values()][0];
    expect(job.status).toBe('FAILED');
  });

  it('requeues QUEUED/PROCESSING jobs left over from a previous run on bootstrap, then drains them', async () => {
    const { service, prisma, rows } = buildService();
    rows.set('leftover-1', {
      id: 'leftover-1',
      type: 'cv-processing',
      targetId: 'cand-9',
      status: 'PROCESSING',
      attempts: 1,
      error: null,
      createdAt: new Date(0),
      updatedAt: new Date(),
    });
    const handler = jest.fn().mockResolvedValue(undefined);
    service.registerHandler('cv-processing', handler);

    await service.onApplicationBootstrap();
    await flushMicrotasks();

    expect(prisma.backgroundJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: { in: ['QUEUED', 'PROCESSING'] } },
        data: { status: 'QUEUED' },
      }),
    );
    expect(handler).toHaveBeenCalledWith('cand-9');
    expect(rows.get('leftover-1')!.status).toBe('COMPLETED');
  });
});

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
