import { Global, Module } from '@nestjs/common';
import { BackgroundJobQueueService } from './background-job-queue.service';

@Global()
@Module({
  providers: [BackgroundJobQueueService],
  exports: [BackgroundJobQueueService],
})
export class BackgroundJobsModule {}
