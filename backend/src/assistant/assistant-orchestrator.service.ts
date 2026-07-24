import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuditLogService } from '../audit/audit-log.service';
import { UploadedCv } from '../candidates/services/cv-upload.service';
import { JobPostingsService } from '../job-postings/job-postings.service';
import { PrismaService } from '../prisma/prisma.service';
import { LlmClientService } from '../shared/llm/llm-client.service';
import { ChatMessage } from '../shared/llm/llm-client.types';
import { ASSISTANT_SYSTEM_PROMPT } from './system-prompt';
import { AssistantToolDefinition, selectAssistantTools } from './tool-definitions';
import { ToolRegistryService } from './tool-registry.service';

export interface AssistantMessageInput {
  role: 'user' | 'assistant';
  content: string;
}

export interface PendingActionPreview {
  actionId: string;
  tool: string;
  args: Record<string, unknown>;
  expiresAt: Date;
}

export interface AssistantReply {
  reply: string;
  pendingAction?: PendingActionPreview;
}

const MAX_TOOL_ITERATIONS = 5;
const PENDING_ACTION_TTL_MINUTES = 30;
const RETRY_DELAY_MS = 1500;
// gpt-oss-20b sticks to well-formed JSON tool calls far more reliably than
// the previous default (llama-3.3-70b-versatile), which would intermittently
// emit a non-JSON pseudo-XML function-call token under this tool-calling
// workload and get the whole completion rejected by Groq.
const ASSISTANT_MODEL = 'openai/gpt-oss-20b';

/**
 * The tool-calling loop. The LLM never touches the DB/filesystem — it only
 * ever sees the JSON schemas selectAssistantTools() picked for this message
 * and gets back whatever ToolRegistryService.execute() returns. Gated tools
 * (publishJobPosting,
 * status-changing updateJobPosting) are intercepted here and never actually
 * executed in this loop — see confirmAction().
 */
@Injectable()
export class AssistantOrchestratorService {
  private readonly logger = new Logger(AssistantOrchestratorService.name);

  constructor(
    private readonly llm: LlmClientService,
    private readonly toolRegistry: ToolRegistryService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly jobPostings: JobPostingsService,
  ) {}

  async handleMessage(
    history: AssistantMessageInput[],
    userMessage: string,
    actorUserId: string,
    attachedFile?: UploadedCv,
  ): Promise<AssistantReply> {
    const messages: ChatMessage[] = [
      { role: 'system', content: ASSISTANT_SYSTEM_PROMPT },
      ...history.map((h): ChatMessage => ({
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
    );

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      let message: ChatMessage;
      try {
        message = await this.chatWithRetry(messages, tools);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.warn(`LLM call failed: ${reason}`);
        return { reply: describeLlmFailure(reason) };
      }

      if (!message.tool_calls || message.tool_calls.length === 0) {
        return { reply: message.content ?? '' };
      }

      messages.push(message);

      for (const toolCall of message.tool_calls) {
        const args = this.toolRegistry.parseArgs(toolCall.function.arguments);

        if (this.toolRegistry.isGated(toolCall.function.name, args)) {
          const pending = await this.createPendingAction(
            toolCall.function.name,
            args,
            actorUserId,
          );
          const description = await this.describeAction(
            toolCall.function.name,
            args,
          );
          return {
            reply: `This needs your explicit confirmation before I do it: ${description}. Confirm via the "Confirm" action (id: ${pending.id}), or cancel it.`,
            pendingAction: {
              actionId: pending.id,
              tool: toolCall.function.name,
              args,
              expiresAt: pending.expiresAt,
            },
          };
        }

        const outcome = await this.toolRegistry.execute(
          toolCall.function.name,
          args,
          {
            actorUserId,
            attachedFile:
              toolCall.function.name === 'uploadCandidateCv'
                ? attachedFile
                : undefined,
          },
        );

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(outcome.result),
        });
      }
    }

    return {
      reply:
        "I wasn't able to finish this within the allowed number of steps — try rephrasing or splitting the request into smaller parts.",
    };
  }

  /**
   * Deliberately does not restrict confirmation to `requestedByUserId` —
   * any HR_ADMIN/SUPER_ADMIN (the only roles with assistant access at all,
   * per AssistantController's @Roles guard) can confirm or cancel a
   * pending action a teammate proposed. Treated as intentional (a small
   * HR team picking up and finishing each other's in-progress work) rather
   * than a gap; `requestedByUserId` is still recorded so the audit trail
   * shows who proposed vs. who confirmed. Revisit if/when this needs to be
   * restricted to the original requester.
   */
  async confirmAction(
    actionId: string,
    confirmedByUserId: string,
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
    return outcome.ok
      ? { reply: `Done — ${description} completed.` }
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

  /**
   * One quiet retry for transient failures (network blip, a momentary 5xx)
   * so a single hiccup doesn't surface as an error to HR. Skips the retry
   * for rate limits — Groq's own backoff hint is on the order of several
   * seconds, far longer than we should block a chat reply for, so retrying
   * immediately would just fail again for no benefit.
   */
  private async chatWithRetry(
    messages: ChatMessage[],
    tools: AssistantToolDefinition[],
  ): Promise<ChatMessage> {
    const options = { tools, model: ASSISTANT_MODEL };
    try {
      return (await this.llm.chat(messages, options)).message;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (/rate_limit_exceeded|429/i.test(reason)) {
        throw error;
      }
      this.logger.warn(`LLM call failed, retrying once: ${reason}`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      return (await this.llm.chat(messages, options)).message;
    }
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
   * Resolves the job posting (and its current title/status) server-side
   * before describing a gated action back to HR — the model's raw arguments
   * are just a UUID, which gives HR no way to visually confirm they're
   * about to publish/delete/change the job they actually think they are.
   * Falls back to the bare id if the job can't be resolved (e.g. it's since
   * been deleted) rather than failing the description outright.
   */
  private async describeAction(
    tool: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const jobPostingId =
      typeof args.jobPostingId === 'string' ? args.jobPostingId : undefined;
    const jobLabel = jobPostingId
      ? await this.describeJobPosting(jobPostingId)
      : undefined;

    if (tool === 'publishJobPosting') return `publish job posting ${jobLabel}`;
    if (tool === 'deleteJobPosting')
      return `permanently delete job posting ${jobLabel} and all of its applications/interviews/emails`;
    if (tool === 'updateJobPosting') {
      const changes = args.changes as Record<string, unknown> | undefined;
      return `change job posting ${jobLabel} status to ${String(changes?.status)}`;
    }
    return `${tool}(${JSON.stringify(args)})`;
  }

  private async describeJobPosting(jobPostingId: string): Promise<string> {
    try {
      const job = await this.jobPostings.getById(jobPostingId);
      return `"${job.title}" (currently ${job.status}, id ${jobPostingId})`;
    } catch {
      return jobPostingId;
    }
  }
}

function describeLlmFailure(reason: string): string {
  if (/rate_limit_exceeded|429/i.test(reason)) {
    return 'The assistant is temporarily rate-limited — please wait a few seconds and try again.';
  }
  return 'The assistant is temporarily unavailable — please try again in a moment.';
}
