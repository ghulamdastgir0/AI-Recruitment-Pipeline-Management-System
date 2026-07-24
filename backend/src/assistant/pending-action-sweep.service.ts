import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Sweeps PendingAssistantAction rows past their expiresAt that are still
 * PENDING — mirroring InterviewReminderService's ticking-cron pattern.
 * Without this, an unconfirmed action just sits at PENDING forever unless
 * someone happens to try confirming it (confirmAction() only expires one
 * lazily, on that exact attempt).
 */
@Injectable()
export class PendingActionSweepService {
  private readonly logger = new Logger(PendingActionSweepService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async expireDuePendingActions(): Promise<void> {
    const result = await this.prisma.pendingAssistantAction.updateMany({
      where: { status: 'PENDING', expiresAt: { lt: new Date() } },
      data: { status: 'EXPIRED' },
    });
    if (result.count > 0) {
      this.logger.log(`Expired ${result.count} stale pending assistant action(s).`);
    }
  }
}
