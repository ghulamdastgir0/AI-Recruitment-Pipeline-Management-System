import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

type JobHandler = (targetId: string) => Promise<void>;

// Past this, a job still sitting in PROCESSING is assumed to have died with
// its handler (crash, OOM, kill -9) rather than genuinely still running —
// nothing in this codebase's CV/document processing legitimately takes this
// long, so it's swept and requeued rather than left stuck forever.
const STUCK_PROCESSING_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_ATTEMPTS = 3;

/**
 * Durable, sequential FIFO job runner backed by the BackgroundJob table —
 * replaces the old bare in-memory closure queue, which lost any job still
 * queued or mid-flight the moment the process restarted or crashed (a
 * deploy, an OOM), leaving e.g. a candidate's cvStatus stuck at PROCESSING
 * forever with no error ever recorded.
 *
 * Callers enqueue a `(type, targetId)` pair instead of a closure; handlers
 * for each `type` are registered once at startup (see CvProcessorService/
 * DocumentProcessorService's onModuleInit) so the job itself is a plain,
 * serializable DB row that survives a restart. On boot, onApplicationBootstrap
 * requeues anything left QUEUED/PROCESSING from a previous run.
 */
@Injectable()
export class BackgroundJobQueueService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BackgroundJobQueueService.name);
  private readonly handlers = new Map<string, JobHandler>();
  private draining = false;

  constructor(private readonly prisma: PrismaService) {}

  registerHandler(type: string, handler: JobHandler): void {
    this.handlers.set(type, handler);
  }

  async enqueue(type: string, targetId: string): Promise<void> {
    await this.prisma.backgroundJob.create({ data: { type, targetId } });
    void this.drain();
  }

  /** Recovers any job left QUEUED/PROCESSING by a process that died before finishing it. */
  async onApplicationBootstrap(): Promise<void> {
    const stuck = await this.prisma.backgroundJob.updateMany({
      where: { status: { in: ['QUEUED', 'PROCESSING'] } },
      data: { status: 'QUEUED' },
    });
    if (stuck.count > 0) {
      this.logger.warn(
        `Requeuing ${stuck.count} background job(s) left over from a previous run.`,
      );
    }
    void this.drain();
  }

  /** Bounds handler hangs that never resolve/reject — flags them FAILED past a generous timeout instead of leaving the row (and whatever it's processing) stuck forever. */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async sweepStuckJobs(): Promise<void> {
    const cutoff = new Date(Date.now() - STUCK_PROCESSING_TIMEOUT_MS);
    const stuck = await this.prisma.backgroundJob.findMany({
      where: { status: 'PROCESSING', updatedAt: { lt: cutoff } },
    });
    for (const job of stuck) {
      await this.prisma.backgroundJob.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          error: 'Timed out — no result after 30 minutes.',
        },
      });
      this.logger.error(
        `Background job ${job.id} (${job.type}/${job.targetId}) timed out and was marked FAILED.`,
      );
    }
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;

    try {
      for (;;) {
        const job = await this.claimNext();
        if (!job) break;

        const handler = this.handlers.get(job.type);
        if (!handler) {
          this.logger.error(
            `No handler registered for background job type "${job.type}" — leaving job ${job.id} FAILED.`,
          );
          await this.prisma.backgroundJob.update({
            where: { id: job.id },
            data: { status: 'FAILED', error: `No handler for type "${job.type}".` },
          });
          continue;
        }

        try {
          await handler(job.targetId);
          await this.prisma.backgroundJob.update({
            where: { id: job.id },
            data: { status: 'COMPLETED', error: null },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.error(`Background job ${job.id} (${job.type}) failed`, message);
          await this.prisma.backgroundJob.update({
            where: { id: job.id },
            data: { status: 'FAILED', error: message },
          });
        }
      }
    } finally {
      this.draining = false;
    }
  }

  /** Atomically claims the oldest QUEUED job under its retry cap so two overlapping drain() calls never double-process the same row. */
  private async claimNext(): Promise<{
    id: string;
    type: string;
    targetId: string;
  } | null> {
    const next = await this.prisma.backgroundJob.findFirst({
      where: { status: 'QUEUED', attempts: { lt: MAX_ATTEMPTS } },
      orderBy: { createdAt: 'asc' },
    });
    if (!next) return null;

    const claimed = await this.prisma.backgroundJob.updateMany({
      where: { id: next.id, status: 'QUEUED' },
      data: { status: 'PROCESSING', attempts: { increment: 1 } },
    });
    if (claimed.count === 0) return null; // lost the race to another drain() — move on

    return { id: next.id, type: next.type, targetId: next.targetId };
  }
}
