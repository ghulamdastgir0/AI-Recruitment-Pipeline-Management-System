import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { ExtractedCvProfileDto } from '../../candidates/dto/extracted-cv-profile.dto';
import { INTERVIEW_REMINDER_DELAY_MINUTES } from '../../matching/matching.constants';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../shared/email/email.service';
import { CandidateLinksService } from '../../shared/links/candidate-links.service';

/**
 * Nudges candidates who were invited to the AI interview but haven't
 * started it after INTERVIEW_REMINDER_DELAY_MINUTES. Runs on a ticking cron
 * (rather than a per-candidate setTimeout) so it survives process restarts —
 * `reminderSentAt` makes each session eligible exactly once regardless of
 * how many ticks it takes to notice.
 */
@Injectable()
export class InterviewReminderService {
  private readonly logger = new Logger(InterviewReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly links: CandidateLinksService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async sendDueReminders(): Promise<void> {
    const cutoff = new Date(
      Date.now() - INTERVIEW_REMINDER_DELAY_MINUTES * 60 * 1000,
    );

    const due = await this.prisma.aIInterviewSession.findMany({
      where: {
        status: 'PENDING',
        reminderSentAt: null,
        windowExpiresAt: { gt: new Date() },
        application: {
          status: 'INTERVIEW_PENDING',
          interviewWindowOpensAt: { lte: cutoff },
        },
      },
      include: {
        application: { include: { candidateProfile: true, job: true } },
      },
    });

    for (const session of due) {
      const { application } = session;
      const extracted = application.candidateProfile
        .extractedDataJson as ExtractedCvProfileDto | null;

      const sent = await this.email.send({
        to: extracted?.email ?? null,
        type: 'INTERVIEW_REMINDER',
        variables: {
          candidateName: extracted?.name ?? null,
          jobTitle: application.job.title,
          interviewDeadline: session.windowExpiresAt,
          interviewLink: this.links.interviewUrl(application.id),
        },
      });

      // Marked exactly once regardless of outcome — a persistent send
      // failure (e.g. Brevo misconfigured) shouldn't retry every minute.
      await this.prisma.aIInterviewSession.update({
        where: { id: session.id },
        data: { reminderSentAt: new Date() },
      });

      if (sent) {
        await this.prisma.emailLog.create({
          data: { applicationId: application.id, type: 'INTERVIEW_REMINDER' },
        });
      } else {
        this.logger.warn(
          `Interview reminder email not sent for application ${application.id}.`,
        );
      }
    }
  }
}
