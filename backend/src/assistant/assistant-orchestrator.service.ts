import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditLogService } from '../audit/audit-log.service';
import { resolveCandidateIdentity } from '../candidates/candidate-identity.util';
import { UploadedCv } from '../candidates/services/cv-upload.service';
import type { Role } from '../generated/prisma/enums';
import {
  JobPostingsService,
  JobPostingWithSkills,
} from '../job-postings/job-postings.service';
import { PrismaService } from '../prisma/prisma.service';
import { ChatMessage } from '../shared/llm/llm-client.types';
import { AssistantAgentGraph, ToolProgressEvent } from './assistant-agent.graph';
import { buildAssistantSystemPrompt } from './system-prompt';
import { selectAssistantTools } from './tool-definitions';
import { ToolRegistryService } from './tool-registry.service';

export interface AssistantMessageInput {
  role: 'user' | 'assistant';
  content: string;
}

export interface PendingActionPreview {
  actionId: string;
  /** Plain-English description of what confirming will do — no tool name, id, or raw args; those are internal plumbing a human doesn't need to see. */
  description: string;
  expiresAt: Date;
}

export interface AssistantReply {
  reply: string;
  pendingAction?: PendingActionPreview;
  /** Set whenever this turn created/updated a job posting, so the UI can render a structured card instead of relying on the LLM's free-text paraphrase. */
  jobPosting?: JobPostingWithSkills;
}

const JOB_POSTING_RESULT_TOOLS = new Set(['createJobPosting', 'updateJobPosting']);
const PENDING_ACTION_TTL_MINUTES = 30;
// The frontend resends the whole conversation on every message (stateless
// history, per AssistantController's docs), and it's never trimmed on that
// end — left unbounded, a long-running chat would resend an ever-growing
// transcript (plus the system prompt and every tool result) on every single
// LLM call, including every iteration inside one turn's tool loop. Only the
// most recent turns actually matter for resolving "it"/"the same role"
// follow-ups, so older ones are dropped here rather than trusting the
// caller to cap it.
const MAX_HISTORY_MESSAGES = 10;

/**
 * Thin wrapper around AssistantAgentGraph (the LangGraph tool-calling loop):
 * builds the role-aware initial prompt/tool set, invokes the graph, then
 * handles the two things only this service can do — turn a gated tool call
 * into a PendingAssistantAction row for HR/the manager to confirm, and
 * write the audit trail on confirm/cancel. The LLM never touches the DB/
 * filesystem itself — it only ever sees the JSON schemas selectAssistantTools()
 * picked for this actor's role and gets back whatever ToolRegistryService
 * returns.
 */
@Injectable()
export class AssistantOrchestratorService {
  constructor(
    private readonly agentGraph: AssistantAgentGraph,
    private readonly toolRegistry: ToolRegistryService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly jobPostings: JobPostingsService,
  ) {}

  async handleMessage(
    history: AssistantMessageInput[],
    userMessage: string,
    actorUserId: string,
    actorRole: Role,
    attachedFile?: UploadedCv,
    onToolEvent?: (event: ToolProgressEvent) => void,
  ): Promise<AssistantReply> {
    const recentHistory = history.slice(-MAX_HISTORY_MESSAGES);
    const messages: ChatMessage[] = [
      { role: 'system', content: buildAssistantSystemPrompt(actorRole) },
      ...recentHistory.map((h): ChatMessage => ({
        role: h.role,
        content: h.content,
      })),
      { role: 'user', content: userMessage },
    ];

    // Picked once per incoming message (not per tool-loop iteration) so a
    // multi-step chain like findJobPosting -> resumeJobPosting keeps access
    // to the same group throughout.
    const tools = selectAssistantTools(
      messages
        .filter((m) => m.role !== 'system')
        .map((m) => m.content ?? '')
        .join('\n'),
      actorRole,
    );

    const result = await this.agentGraph.run({
      messages,
      tools,
      actorUserId,
      actorRole,
      attachedFile,
      onToolEvent,
    });

    if (result.gatedAction) {
      const pending = await this.createPendingAction(
        result.gatedAction.tool,
        result.gatedAction.args,
        actorUserId,
      );
      const description = await this.describeAction(
        result.gatedAction.tool,
        result.gatedAction.args,
      );
      return {
        // No pending-action id, tool name, or raw args in the prose — those
        // are internal plumbing (the frontend already carries actionId
        // structurally via pendingAction.actionId for the Confirm/Cancel
        // buttons) and have no business being read by a human.
        reply: `This needs your explicit confirmation before I do it: ${description}.`,
        pendingAction: {
          actionId: pending.id,
          description,
          expiresAt: pending.expiresAt,
        },
        jobPosting: result.lastJobPosting,
      };
    }

    return { reply: result.finalReply ?? '', jobPosting: result.lastJobPosting };
  }

  /**
   * Deliberately does not restrict confirmation to `requestedByUserId` —
   * any staff account with assistant access can confirm or cancel a pending
   * action a teammate proposed. Treated as intentional (a small team picking
   * up and finishing each other's in-progress work) rather than a gap;
   * `requestedByUserId` is still recorded so the audit trail shows who
   * proposed vs. who confirmed. Revisit if/when this needs to be restricted
   * to the original requester.
   */
  async confirmAction(
    actionId: string,
    confirmedByUserId: string,
    confirmedByRole: Role,
  ): Promise<AssistantReply> {
    const action = await this.prisma.pendingAssistantAction.findUnique({
      where: { id: actionId },
    });
    if (!action) {
      throw new NotFoundException('No such pending action.');
    }
    if (action.status !== 'PENDING') {
      throw new ConflictException(
        `This action is already ${action.status.toLowerCase()}.`,
      );
    }
    if (action.expiresAt < new Date()) {
      await this.prisma.pendingAssistantAction.update({
        where: { id: actionId },
        data: { status: 'EXPIRED' },
      });
      throw new ConflictException(
        'This action has expired — ask the assistant to propose it again.',
      );
    }

    const args = action.argsJson as Record<string, unknown>;
    const outcome = await this.toolRegistry.execute(action.tool, args, {
      actorUserId: confirmedByUserId,
      actorRole: confirmedByRole,
    });

    // Only a genuinely successful tool call is recorded as CONFIRMED — a
    // confirm that hits e.g. the missing-Hiring-Manager check must be
    // distinguishable (here and in the audit trail) from one that actually
    // executed, not just differ in the chat reply text.
    await this.prisma.pendingAssistantAction.update({
      where: { id: actionId },
      data: {
        status: outcome.ok ? 'CONFIRMED' : 'FAILED',
        confirmedAt: new Date(),
        confirmedByUserId,
      },
    });
    await this.audit.record({
      actorUserId: confirmedByUserId,
      action: `confirm:${action.tool}`,
      resourceType: 'PendingAssistantAction',
      resourceId: actionId,
      details: { args, ok: outcome.ok },
    });

    const description = await this.describeAction(action.tool, args);
    const jobPosting =
      outcome.ok && JOB_POSTING_RESULT_TOOLS.has(action.tool)
        ? (outcome.result as JobPostingWithSkills)
        : undefined;
    return outcome.ok
      ? { reply: `Done — ${description} completed.`, jobPosting }
      : {
          reply: `That failed: ${(outcome.result as { error?: string }).error ?? 'unknown error'}`,
        };
  }

  async cancelAction(
    actionId: string,
    cancelledByUserId: string,
  ): Promise<void> {
    const action = await this.prisma.pendingAssistantAction.findUnique({
      where: { id: actionId },
    });
    if (!action) {
      throw new NotFoundException('No such pending action.');
    }
    if (action.status !== 'PENDING') {
      return;
    }

    await this.prisma.pendingAssistantAction.update({
      where: { id: actionId },
      data: { status: 'CANCELLED' },
    });
    await this.audit.record({
      actorUserId: cancelledByUserId,
      action: `cancel:${action.tool}`,
      resourceType: 'PendingAssistantAction',
      resourceId: actionId,
    });
  }

  private async createPendingAction(
    tool: string,
    args: Record<string, unknown>,
    requestedByUserId: string,
  ) {
    const expiresAt = new Date(
      Date.now() + PENDING_ACTION_TTL_MINUTES * 60_000,
    );
    return this.prisma.pendingAssistantAction.create({
      data: {
        tool,
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- see cv-processor.service.ts
        argsJson: args as unknown as object,
        requestedByUserId,
        expiresAt,
      },
    });
  }

  /**
   * Resolves the job posting/candidate (title/status/name only) server-side
   * before describing a gated action back to the actor — the model's raw
   * arguments are just UUIDs, which give no way to visually confirm they're
   * about to publish/delete/decide on the job/candidate they actually think
   * they are. Deliberately never surfaces a raw id, tool name, or JSON blob
   * in the returned string — this is read by HR/a Hiring Manager, not a
   * developer. Falls back to a generic noun ("the job posting"/"the
   * candidate") if a lookup fails (e.g. since deleted) rather than falling
   * back to the id.
   */
  private async describeAction(
    tool: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const jobPostingId =
      typeof args.jobPostingId === 'string' ? args.jobPostingId : undefined;
    const candidateId =
      typeof args.candidateId === 'string' ? args.candidateId : undefined;
    const jobLabel = jobPostingId
      ? await this.describeJobPosting(jobPostingId)
      : 'the job posting';
    const candidateLabel = candidateId
      ? await this.describeCandidate(candidateId)
      : 'the candidate';

    if (tool === 'publishJobPosting') return `publish job posting ${jobLabel}`;
    if (tool === 'deleteJobPosting')
      return `permanently delete job posting ${jobLabel} and all of its applications/interviews/emails`;
    if (tool === 'updateJobPosting') {
      const changes = args.changes as Record<string, unknown> | undefined;
      return `change job posting ${jobLabel} status to ${String(changes?.status)}`;
    }
    if (tool === 'decideApplication') {
      const decisionLabel = DECISION_LABELS[String(args.decision)] ?? String(args.decision);
      return `${decisionLabel} ${candidateLabel} for job posting ${jobLabel}`;
    }
    if (tool === 'sendOfferLetter') {
      return `send the offer letter to ${candidateLabel} for job posting ${jobLabel}`;
    }
    // Generic fallback for any future gated tool that doesn't have a
    // dedicated phrasing above yet — humanized from the tool name, never a
    // raw dump of args (which could contain other internal ids).
    return humanizeToolName(tool);
  }

  private async describeJobPosting(jobPostingId: string): Promise<string> {
    try {
      const job = await this.jobPostings.getById(jobPostingId);
      return `"${job.title}" (currently ${job.status.toLowerCase()})`;
    } catch {
      return 'the job posting';
    }
  }

  private async describeCandidate(candidateId: string): Promise<string> {
    try {
      const profile = await this.prisma.candidateProfile.findUnique({
        where: { id: candidateId },
      });
      if (!profile) return 'the candidate';
      const { name } = resolveCandidateIdentity(profile);
      return name ?? 'the candidate';
    } catch {
      return 'the candidate';
    }
  }
}

const DECISION_LABELS: Record<string, string> = {
  SELECTED: 'select',
  NEXT_ROUND: 'advance to another round',
  REJECTED: 'reject',
};

function humanizeToolName(tool: string): string {
  return tool.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}
