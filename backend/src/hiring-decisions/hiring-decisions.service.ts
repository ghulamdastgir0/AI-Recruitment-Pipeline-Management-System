import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditLogService } from '../audit/audit-log.service';
import type { ExtractedCvProfileDto } from '../candidates/dto/extracted-cv-profile.dto';
import { AppStatus, EmailType } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../shared/email/email.service';

export interface DecideApplicationInput {
  decision: 'SELECTED' | 'NEXT_ROUND' | 'REJECTED';
  nextRoundTime?: string;
  nextRoundDeadline?: string;
}

export interface DecideApplicationResult {
  applicationId: string;
  status: AppStatus;
  emailSent: boolean;
}

const STATUS_BY_DECISION: Record<
  DecideApplicationInput['decision'],
  AppStatus
> = {
  SELECTED: 'SELECTED',
  NEXT_ROUND: 'NEXT_ROUND',
  REJECTED: 'REJECTED',
};

const EMAIL_TYPE_BY_DECISION: Record<
  DecideApplicationInput['decision'],
  EmailType
> = {
  SELECTED: 'SELECTION',
  NEXT_ROUND: 'NEXT_ROUND',
  REJECTED: 'REJECTION',
};

@Injectable()
export class HiringDecisionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly audit: AuditLogService,
  ) {}

  async decide(
    candidateId: string,
    jobPostingId: string,
    actorUserId: string,
    input: DecideApplicationInput,
  ): Promise<DecideApplicationResult> {
    const application = await this.prisma.application.findUnique({
      where: {
        candidateProfileId_jobId: {
          candidateProfileId: candidateId,
          jobId: jobPostingId,
        },
      },
      include: { job: true, candidateProfile: true },
    });
    if (!application) {
      throw new NotFoundException(
        `No application found for candidate "${candidateId}" and job posting "${jobPostingId}".`,
      );
    }

    const status = STATUS_BY_DECISION[input.decision];
    await this.prisma.application.update({
      where: { id: application.id },
      data: { status },
    });

    const extracted = application.candidateProfile
      .extractedDataJson as ExtractedCvProfileDto | null;

    const emailSent = await this.email.send({
      to: extracted?.email ?? null,
      type: EMAIL_TYPE_BY_DECISION[input.decision],
      variables: {
        candidateName: extracted?.name ?? null,
        jobTitle: application.job.title,
        nextRoundTime: input.nextRoundTime
          ? new Date(input.nextRoundTime)
          : undefined,
        nextRoundDeadline: input.nextRoundDeadline
          ? new Date(input.nextRoundDeadline)
          : undefined,
      },
    });
    if (emailSent) {
      await this.prisma.emailLog.create({
        data: {
          applicationId: application.id,
          type: EMAIL_TYPE_BY_DECISION[input.decision],
          triggeredByUserId: actorUserId,
        },
      });
    }

    await this.audit.record({
      actorUserId,
      action: 'application_decision.made',
      resourceType: 'Application',
      resourceId: application.id,
      details: { decision: input.decision, emailSent },
    });

    return { applicationId: application.id, status, emailSent };
  }
}
