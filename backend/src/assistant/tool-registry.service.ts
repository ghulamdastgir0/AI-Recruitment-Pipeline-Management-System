import { Injectable, Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuditLogService } from '../audit/audit-log.service';
import { CandidateCommentsService } from '../candidate-comments/candidate-comments.service';
import {
  CvUploadService,
  UploadedCv,
} from '../candidates/services/cv-upload.service';
import { DocumentRetrievalService } from '../documents/services/document-retrieval.service';
import type { Role } from '../generated/prisma/enums';
import { HiringDecisionsService } from '../hiring-decisions/hiring-decisions.service';
import { InterviewSessionService } from '../interviews/services/interview-session.service';
import { CreateJobPostingDto } from '../job-postings/dto/create-job-posting.dto';
import { UpdateJobPostingDto } from '../job-postings/dto/update-job-posting.dto';
import { JobPostingAssignmentsService } from '../job-postings/job-posting-assignments.service';
import { JobPostingsService } from '../job-postings/job-postings.service';
import { MatchingService } from '../matching/matching.service';
import { RankFilters, RankingService } from '../matching/ranking.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import {
  AddCandidateCommentArgsDto,
  AssignHiringManagerArgsDto,
  CandidateIdArgsDto,
  CandidateJobArgsDto,
  DecideApplicationArgsDto,
  FindJobPostingArgsDto,
  JobPostingIdArgsDto,
  MarkManagerReviewedArgsDto,
  RankCandidatesArgsDto,
  SearchPoliciesArgsDto,
  SendOfferLetterArgsDto,
} from './dto/tool-args.dto';
import { findToolDefinition } from './tool-definitions';

export interface ToolExecutionContext {
  actorUserId: string;
  actorRole: Role;
  attachedFile?: UploadedCv;
}

export interface ToolExecutionOutcome {
  ok: boolean;
  result: unknown;
}

@Injectable()
export class ToolRegistryService {
  private readonly logger = new Logger(ToolRegistryService.name);

  constructor(
    private readonly documentRetrieval: DocumentRetrievalService,
    private readonly jobPostings: JobPostingsService,
    private readonly jobAssignments: JobPostingAssignmentsService,
    private readonly cvUpload: CvUploadService,
    private readonly matching: MatchingService,
    private readonly ranking: RankingService,
    private readonly users: UsersService,
    private readonly comments: CandidateCommentsService,
    private readonly decisions: HiringDecisionsService,
    private readonly interviewSessions: InterviewSessionService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  isGated(toolName: string, args: Record<string, unknown>): boolean {
    return findToolDefinition(toolName)?.isGated(args) ?? false;
  }

  parseArgs(rawArgsJson: string): Record<string, unknown> {
    try {
      const parsed: unknown = rawArgsJson ? JSON.parse(rawArgsJson) : {};
      return parsed && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  /** Executes a tool, always returning a JSON-serializable outcome (never throws) so the LLM always gets a tool result to react to. */
  async execute(
    toolName: string,
    args: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ): Promise<ToolExecutionOutcome> {
    const definition = findToolDefinition(toolName);
    if (!definition) {
      return { ok: false, result: { error: `Unknown tool "${toolName}".` } };
    }
    // Defense in depth: selectAssistantTools() already keeps this out of
    // what the LLM is offered, but the assistant otherwise bypasses every
    // per-route HTTP guard, so this is the only RBAC check a stray tool call
    // (e.g. one echoed back from earlier conversation history) still gets.
    if (!definition.requiredRoles.includes(ctx.actorRole)) {
      return {
        ok: false,
        result: { error: 'This action is not available for your role.' },
      };
    }

    try {
      const result = await this.dispatch(toolName, args, ctx);
      await this.audit.record({
        actorUserId: ctx.actorUserId,
        action: `tool:${toolName}`,
        resourceType: 'AssistantTool',
        resourceId: toolName,
        details: { args: redactArgs(args) },
      });
      return { ok: true, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Tool "${toolName}" failed: ${message}`);
      return { ok: false, result: { error: message } };
    }
  }

  /**
   * Same rule JobAssignmentGuard enforces over HTTP (SUPER_ADMIN/HR_ADMIN
   * pass unconditionally; a HIRING_MANAGER must have an explicit
   * JobPostingHiringManager row) — reimplemented here because the assistant
   * calls services directly and never goes through that guard.
   */
  private async assertJobAccess(
    ctx: ToolExecutionContext,
    jobPostingId: string,
  ): Promise<void> {
    if (ctx.actorRole !== 'HIRING_MANAGER') return;
    const assignment = await this.prisma.jobPostingHiringManager.findUnique({
      where: {
        jobId_hiringManagerUserId: {
          jobId: jobPostingId,
          hiringManagerUserId: ctx.actorUserId,
        },
      },
    });
    if (!assignment) {
      throw new Error('You are not assigned to this job posting.');
    }
  }

  private async dispatch(
    toolName: string,
    args: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ): Promise<unknown> {
    switch (toolName) {
      case 'searchCompanyPolicies': {
        const dto = await parseAndValidate(SearchPoliciesArgsDto, args);
        const chunks = await this.documentRetrieval.retrieve(dto.query);
        return {
          results: chunks.map((c) => ({
            documentName: c.documentName,
            version: c.version,
            pageNumber: c.pageNumber,
            content: c.content,
            similarity: c.similarity,
          })),
        };
      }

      case 'createJobPosting': {
        const dto = await parseAndValidate(CreateJobPostingDto, args);
        return this.jobPostings.create(dto, ctx.actorUserId);
      }

      case 'updateJobPosting': {
        const { jobPostingId, changes } = args as {
          jobPostingId?: string;
          changes?: Record<string, unknown>;
        };
        if (!jobPostingId) throw new Error('jobPostingId is required.');
        const dto = await parseAndValidate(UpdateJobPostingDto, changes ?? {});
        return this.jobPostings.update(jobPostingId, dto, ctx.actorUserId);
      }

      case 'publishJobPosting': {
        const dto = await parseAndValidate(JobPostingIdArgsDto, args);
        return this.jobPostings.publish(dto.jobPostingId, ctx.actorUserId);
      }

      case 'pauseJobPosting': {
        const dto = await parseAndValidate(JobPostingIdArgsDto, args);
        return this.jobPostings.pause(dto.jobPostingId, ctx.actorUserId);
      }

      case 'resumeJobPosting': {
        const dto = await parseAndValidate(JobPostingIdArgsDto, args);
        return this.jobPostings.resume(dto.jobPostingId, ctx.actorUserId);
      }

      case 'deleteJobPosting': {
        const dto = await parseAndValidate(JobPostingIdArgsDto, args);
        await this.jobPostings.delete(dto.jobPostingId, ctx.actorUserId);
        return { deleted: true, jobPostingId: dto.jobPostingId };
      }

      case 'findJobPosting': {
        const dto = await parseAndValidate(FindJobPostingArgsDto, args);
        const results = await this.jobPostings.search(dto.query);
        return {
          results: results.map((j) => ({
            jobPostingId: j.id,
            title: j.title,
            status: j.status,
          })),
        };
      }

      case 'listMyJobPostings': {
        const jobs = await this.jobPostings.list({
          assignedToUserId:
            ctx.actorRole === 'HIRING_MANAGER' ? ctx.actorUserId : undefined,
        });
        return {
          results: jobs.map((j) => ({
            jobPostingId: j.id,
            title: j.title,
            status: j.status,
          })),
        };
      }

      case 'assignHiringManager': {
        const dto = await parseAndValidate(AssignHiringManagerArgsDto, args);
        const hiringManager = await this.users.findHiringManagerByEmail(
          dto.hiringManagerEmail,
        );
        return this.jobAssignments.assign(
          dto.jobPostingId,
          hiringManager.id,
          ctx.actorUserId,
        );
      }

      case 'uploadCandidateCv': {
        const dto = await parseAndValidate(JobPostingIdArgsDto, args);
        if (!ctx.attachedFile) {
          return {
            error:
              'No CV file was attached to this message. Ask HR to attach the PDF and resend.',
          };
        }
        return this.cvUpload.uploadCv(
          dto.jobPostingId,
          ctx.attachedFile,
          'HR_SOURCED',
          ctx.actorUserId,
        );
      }

      case 'getCandidateProcessingStatus': {
        const dto = await parseAndValidate(CandidateIdArgsDto, args);
        return this.cvUpload.getStatus(dto.candidateId);
      }

      case 'matchCandidateToJob': {
        const dto = await parseAndValidate(CandidateJobArgsDto, args);
        return this.matching.match(
          dto.candidateId,
          dto.jobPostingId,
          ctx.actorUserId,
        );
      }

      case 'rankCandidatesForJob': {
        const dto = await parseAndValidate(RankCandidatesArgsDto, args);
        await this.assertJobAccess(ctx, dto.jobPostingId);
        const filters: RankFilters = {
          minScore: dto.minScore,
          recommendation: dto.recommendation,
          limit: dto.limit,
          rerank: dto.rerank,
        };
        return this.ranking.rank(dto.jobPostingId, filters);
      }

      case 'getCandidateMatchExplanation': {
        const dto = await parseAndValidate(CandidateJobArgsDto, args);
        await this.assertJobAccess(ctx, dto.jobPostingId);
        return this.matching.getLatestExplanation(
          dto.candidateId,
          dto.jobPostingId,
        );
      }

      case 'getInterviewTranscript': {
        const dto = await parseAndValidate(CandidateJobArgsDto, args);
        await this.assertJobAccess(ctx, dto.jobPostingId);
        return this.interviewSessions.getTranscript(
          dto.candidateId,
          dto.jobPostingId,
        );
      }

      case 'listCandidateComments': {
        const dto = await parseAndValidate(CandidateJobArgsDto, args);
        await this.assertJobAccess(ctx, dto.jobPostingId);
        return this.comments.list(dto.candidateId, dto.jobPostingId);
      }

      case 'addCandidateComment': {
        const dto = await parseAndValidate(AddCandidateCommentArgsDto, args);
        await this.assertJobAccess(ctx, dto.jobPostingId);
        return this.comments.add(
          dto.candidateId,
          dto.jobPostingId,
          ctx.actorUserId,
          dto.content,
        );
      }

      case 'markManagerReviewed': {
        const dto = await parseAndValidate(MarkManagerReviewedArgsDto, args);
        await this.assertJobAccess(ctx, dto.jobPostingId);
        return this.decisions.markManagerReviewed(
          dto.candidateId,
          dto.jobPostingId,
          ctx.actorUserId,
          dto.comment,
        );
      }

      case 'moveToManagerReview': {
        const dto = await parseAndValidate(CandidateJobArgsDto, args);
        return this.decisions.moveToManagerReview(
          dto.candidateId,
          dto.jobPostingId,
          ctx.actorUserId,
        );
      }

      case 'decideApplication': {
        const dto = await parseAndValidate(DecideApplicationArgsDto, args);
        return this.decisions.decide(dto.candidateId, dto.jobPostingId, ctx.actorUserId, {
          decision: dto.decision,
          nextRoundTime: dto.nextRoundTime,
          nextRoundDeadline: dto.nextRoundDeadline,
        });
      }

      case 'sendOfferLetter': {
        const dto = await parseAndValidate(SendOfferLetterArgsDto, args);
        return this.decisions.sendOfferLetter(
          dto.candidateId,
          dto.jobPostingId,
          ctx.actorUserId,
          dto.offerDetails,
        );
      }

      default:
        throw new Error(`Unknown tool "${toolName}".`);
    }
  }
}

async function parseAndValidate<T extends object>(
  cls: new () => T,
  plain: Record<string, unknown>,
): Promise<T> {
  const instance = plainToInstance(cls, plain);
  const errors = await validate(instance, {
    whitelist: true,
    forbidNonWhitelisted: false,
  });
  if (errors.length > 0) {
    const message = errors
      .map((e) => Object.values(e.constraints ?? {}).join('; '))
      .join('; ');
    throw new Error(`Invalid arguments: ${message}`);
  }
  return instance;
}

function redactArgs(args: Record<string, unknown>): Record<string, unknown> {
  // Nothing sensitive currently flows through tool args (no passwords/secrets), but keep this
  // as the single choke point to redact from if that ever changes.
  return args;
}
