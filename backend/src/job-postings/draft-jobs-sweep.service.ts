import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

// A DRAFT job is written to the DB the moment HR starts describing a role
// through the assistant, before any preview or confirmation — an abandoned
// conversation otherwise leaves that draft sitting around forever with no
// cleanup mechanism. Past this many days with zero Hiring Managers assigned
// and zero applications, it's archived (not deleted) rather than left inert.
const ABANDONED_DRAFT_AGE_DAYS = 30;

@Injectable()
export class DraftJobsSweepService {
  private readonly logger = new Logger(DraftJobsSweepService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async archiveAbandonedDrafts(): Promise<void> {
    const cutoff = new Date(
      Date.now() - ABANDONED_DRAFT_AGE_DAYS * 24 * 60 * 60 * 1000,
    );

    const result = await this.prisma.job.updateMany({
      where: {
        status: 'DRAFT',
        createdAt: { lt: cutoff },
        hiringManagers: { none: {} },
        applications: { none: {} },
      },
      data: { status: 'ARCHIVED' },
    });

    if (result.count > 0) {
      this.logger.log(
        `Archived ${result.count} abandoned draft job posting(s) older than ${ABANDONED_DRAFT_AGE_DAYS} days.`,
      );
    }
  }
}
