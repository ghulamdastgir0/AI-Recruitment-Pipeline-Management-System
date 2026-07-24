import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Sweeps abandoned interview sessions past their window and flips them to a
 * terminal state, mirroring InterviewReminderService's ticking-cron pattern.
 * Without this, InterviewSessionService.expireIfNeeded() only ever runs
 * lazily (on a start/answer/status call for that exact application) — a
 * candidate who never returns, with no staff member pulling up the
 * application either, would otherwise sit in PENDING/INTERVIEW_PENDING
 * forever and never surface on any HR queue filtered by status.
 */
@Injectable()
export class InterviewExpiryService {
  private readonly logger = new Logger(InterviewExpiryService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async expireDueSessions(): Promise<void> {
    const due = await this.prisma.aIInterviewSession.findMany({
      where: {
        status: { in: ['PENDING', 'IN_PROGRESS'] },
        windowExpiresAt: { lt: new Date() },
      },
      select: { id: true, applicationId: true },
    });

    for (const session of due) {
      await this.prisma.aIInterviewSession.update({
        where: { id: session.id },
        data: { status: 'EXPIRED' },
      });
      await this.prisma.application.update({
        where: { id: session.applicationId },
        data: { status: 'INTERVIEW_EXPIRED' },
      });
    }

    if (due.length > 0) {
      this.logger.log(`Expired ${due.length} abandoned interview session(s).`);
    }
  }
}
