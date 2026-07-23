import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditLogService } from '../audit/audit-log.service';
import { resolveCandidateIdentity } from '../candidates/candidate-identity.util';
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

    const { name: candidateName, email: candidateEmail } =
      resolveCandidateIdentity(application.candidateProfile);

    const emailSent = await this.email.send({
      to: candidateEmail,
      type: EMAIL_TYPE_BY_DECISION[input.decision],
      variables: {
        candidateName,
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

  /**
   * HR-explicit stage transition after the AI interview completes
   * (Application.status is set to IN_REVIEW automatically at that point) —
   * signals the candidate is ready for the assigned Hiring Manager's
   * feedback before HR makes a final SELECTED/NEXT_ROUND/REJECTED call.
   * Internal-only: no candidate email, matching the spec's "never expose
   * the interview score to the candidate" stance for this stage.
   */
  async moveToManagerReview(
    candidateId: string,
    jobPostingId: string,
    actorUserId: string,
  ): Promise<{ applicationId: string; status: AppStatus }> {
    const application = await this.prisma.application.findUnique({
      where: {
        candidateProfileId_jobId: {
          candidateProfileId: candidateId,
          jobId: jobPostingId,
        },
      },
    });
    if (!application) {
      throw new NotFoundException(
        `No application found for candidate "${candidateId}" and job posting "${jobPostingId}".`,
      );
    }
    if (application.status !== 'IN_REVIEW') {
      throw new ConflictException(
        `This application is ${application.status.toLowerCase()}, not awaiting manager review.`,
      );
    }

    await this.prisma.application.update({
      where: { id: application.id },
      data: { status: 'MANAGER_REVIEW' },
    });

    await this.audit.record({
      actorUserId,
      action: 'application.moved_to_manager_review',
      resourceType: 'Application',
      resourceId: application.id,
    });

    return { applicationId: application.id, status: 'MANAGER_REVIEW' };
  }
}
