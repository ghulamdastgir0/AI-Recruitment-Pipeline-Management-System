import { Injectable, Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuditLogService } from '../audit/audit-log.service';
import {
  CvUploadService,
  UploadedCv,
} from '../candidates/services/cv-upload.service';
import { DocumentRetrievalService } from '../documents/services/document-retrieval.service';
import { CreateJobPostingDto } from '../job-postings/dto/create-job-posting.dto';
import { UpdateJobPostingDto } from '../job-postings/dto/update-job-posting.dto';
import { JobPostingsService } from '../job-postings/job-postings.service';
import { MatchingService } from '../matching/matching.service';
import { RankFilters, RankingService } from '../matching/ranking.service';
import {
  CandidateIdArgsDto,
  CandidateJobArgsDto,
  JobPostingIdArgsDto,
  RankCandidatesArgsDto,
  SearchPoliciesArgsDto,
} from './dto/tool-args.dto';
import { findToolDefinition } from './tool-definitions';

export interface ToolExecutionContext {
  actorUserId: string;
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
    private readonly cvUpload: CvUploadService,
    private readonly matching: MatchingService,
    private readonly ranking: RankingService,
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
        return this.matching.getLatestExplanation(
          dto.candidateId,
          dto.jobPostingId,
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
