import { Injectable, Logger } from '@nestjs/common';

type Job = () => Promise<void>;

/**
 * Minimal in-process, sequential FIFO job runner: `enqueue()` returns
 * immediately so the HTTP request that triggered it isn't blocked, while
 * the job itself runs off the request lifecycle. Isolated behind this class
 * so it can be swapped for a real queue (BullMQ/Redis, SQS, etc.) later
 * without touching callers. Shared by document processing and CV processing.
 */
@Injectable()
export class BackgroundJobQueueService {
  private readonly logger = new Logger(BackgroundJobQueueService.name);
  private readonly queue: Job[] = [];
  private draining = false;

  enqueue(job: Job): void {
    this.queue.push(job);
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;

    while (this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job) continue;
      try {
        await job();
      } catch (error) {
        this.logger.error(
          'Background job failed',
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    this.draining = false;
  }
}
