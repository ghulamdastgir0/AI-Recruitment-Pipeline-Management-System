import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { JobPostingsService } from './job-postings.service';

@Injectable()
export class DeadlineSweepService {
  private readonly logger = new Logger(DeadlineSweepService.name);

  constructor(private readonly jobPostings: JobPostingsService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async closeExpiredJobs(): Promise<void> {
    const count = await this.jobPostings.closeExpiredPublishedJobs();
    if (count > 0) {
      this.logger.log(
        `Closed ${count} published job posting(s) past their application deadline.`,
      );
    }
  }
}
