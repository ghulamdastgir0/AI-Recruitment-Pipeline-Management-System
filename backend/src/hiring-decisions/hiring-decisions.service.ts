import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditLogService } from '../audit/audit-log.service';
import { resolveCandidateIdentity } from '../candidates/candidate-identity.util';
import {
  CandidateCommentsService,
  CandidateCommentView,
} from '../candidate-comments/candidate-comments.service';
import { AppStatus, EmailType } from '../generated/prisma/enums';
import { JobPostingsService } from '../job-postings/job-postings.service';
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

export interface MarkManagerReviewedResult {
  applicationId: string;
  status: AppStatus;
  comment: CandidateCommentView;
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
    private readonly jobPostings: JobPostingsService,
    private readonly comments: CandidateCommentsService,
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
      include: {
        job: true,
        candidateProfile: true,
        interviewSession: { select: { terminationReason: true } },
      },
    });
    if (!application) {
      throw new NotFoundException(
        `No application found for candidate "${candidateId}" and job posting "${jobPostingId}".`,
      );
    }

    // Normally a decision requires the assigned Hiring Manager's review
    // first (MANAGER_REVIEWED). Exception: if the proctoring system
    // auto-submitted this interview (5-warning cap or a browser-close
    // ping — see InterviewSessionService.forceSubmit/terminationReason),
    // HR can reject straight from IN_REVIEW without waiting on a manager
    // review that adds no value over a compromised interview. SELECTED/
    // NEXT_ROUND still require the normal manager-review path even for an
    // auto-submitted session — only a REJECTED bypass is allowed.
    const wasAutoSubmitted =
      application.interviewSession?.terminationReason != null;
    const canRejectDirectly =
      input.decision === 'REJECTED' &&
      wasAutoSubmitted &&
      application.status === 'IN_REVIEW';

    if (application.status !== 'MANAGER_REVIEWED' && !canRejectDirectly) {
      throw new ConflictException(
        `This application is ${application.status.toLowerCase()}, not awaiting a decision — the assigned Hiring Manager may not have completed their review yet, or a decision may already have been recorded.`,
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
   * The fourth HR one-click email action — previously unbuilt entirely (no
   * EmailType, template, or action existed for an offer letter). Only valid
   * on a SELECTED application; moves it to the terminal HIRED status (the
   * only place that status is ever assigned) and increments the job's
   * hiredCount, which may in turn auto-close the posting once its hiring
   * target is met (see JobPostingsService.incrementHiredCountAndMaybeAutoClose).
   */
  async sendOfferLetter(
    candidateId: string,
    jobPostingId: string,
    actorUserId: string,
    offerDetails?: string,
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
    if (application.status !== 'SELECTED') {
      throw new ConflictException(
        `This application is ${application.status.toLowerCase()}, not selected — an offer letter can only be sent once a candidate has been selected.`,
      );
    }

    await this.prisma.application.update({
      where: { id: application.id },
      data: { status: 'HIRED' },
    });

    const { name: candidateName, email: candidateEmail } =
      resolveCandidateIdentity(application.candidateProfile);

    const emailSent = await this.email.send({
      to: candidateEmail,
      type: 'OFFER_LETTER',
      variables: {
        candidateName,
        jobTitle: application.job.title,
        offerDetails,
      },
    });
    if (emailSent) {
      await this.prisma.emailLog.create({
        data: {
          applicationId: application.id,
          type: 'OFFER_LETTER',
          triggeredByUserId: actorUserId,
        },
      });
    }

    await this.jobPostings.incrementHiredCountAndMaybeAutoClose(
      jobPostingId,
      actorUserId,
    );

    await this.audit.record({
      actorUserId,
      action: 'application_offer_letter.sent',
      resourceType: 'Application',
      resourceId: application.id,
      details: { emailSent },
    });

    return { applicationId: application.id, status: 'HIRED', emailSent };
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

  /**
   * The assigned Hiring Manager's counterpart to moveToManagerReview() —
   * closes out the manager-review stage with their required comment and
   * advances the application to MANAGER_REVIEWED so HR's decide() (gated on
   * that exact status) always has manager feedback attached before a final
   * call. JobAssignmentGuard on the controller already confirms the caller
   * is assigned to this job posting; not re-checked here.
   */
  async markManagerReviewed(
    candidateId: string,
    jobPostingId: string,
    actorUserId: string,
    comment: string,
  ): Promise<MarkManagerReviewedResult> {
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
    if (application.status !== 'MANAGER_REVIEW') {
      throw new ConflictException(
        `This application is ${application.status.toLowerCase()}, not awaiting manager review.`,
      );
    }

    const createdComment = await this.comments.add(
      candidateId,
      jobPostingId,
      actorUserId,
      comment,
    );

    await this.prisma.application.update({
      where: { id: application.id },
      data: { status: 'MANAGER_REVIEWED' },
    });

    await this.audit.record({
      actorUserId,
      action: 'application.marked_manager_reviewed',
      resourceType: 'Application',
      resourceId: application.id,
    });

    return {
      applicationId: application.id,
      status: 'MANAGER_REVIEWED',
      comment: createdComment,
    };
  }

  /**
   * Undoes markManagerReviewed — lets the assigned Hiring Manager pull a
   * candidate back into MANAGER_REVIEW to add/amend feedback before HR has
   * acted on it. Only valid while still MANAGER_REVIEWED: decide() (gated on
   * that exact status) moves the application to SELECTED/NEXT_ROUND/REJECTED
   * the moment HR decides, so once a final decision exists this naturally
   * refuses — there's nothing left to "not finally decided" about revert.
   */
  async revertManagerReview(
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
    if (application.status !== 'MANAGER_REVIEWED') {
      throw new ConflictException(
        `This application is ${application.status.toLowerCase()} — it can only be reverted while awaiting HR's decision, before a final call has been made.`,
      );
    }

    await this.prisma.application.update({
      where: { id: application.id },
      data: { status: 'MANAGER_REVIEW' },
    });

    await this.audit.record({
      actorUserId,
      action: 'application.manager_review_reverted',
      resourceType: 'Application',
      resourceId: application.id,
    });

    return { applicationId: application.id, status: 'MANAGER_REVIEW' };
  }
}
