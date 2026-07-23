import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuditLogService } from '../audit/audit-log.service';
import { UploadedCv } from '../candidates/services/cv-upload.service';
import { PrismaService } from '../prisma/prisma.service';
import { LlmClientService } from '../shared/llm/llm-client.service';
import { ChatMessage } from '../shared/llm/llm-client.types';
import { ASSISTANT_SYSTEM_PROMPT } from './system-prompt';
import { ASSISTANT_TOOLS } from './tool-definitions';
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

/**
 * The tool-calling loop. The LLM never touches the DB/filesystem — it only
 * ever sees ASSISTANT_TOOLS' JSON schemas and gets back whatever
 * ToolRegistryService.execute() returns. Gated tools (publishJobPosting,
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

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      let message: ChatMessage;
      try {
        message = await this.chatWithRetry(messages);
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
          return {
            reply: `This needs your explicit confirmation before I do it: ${describeAction(toolCall.function.name, args)}. Confirm via the "Confirm" action (id: ${pending.id}), or cancel it.`,
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

    await this.prisma.pendingAssistantAction.update({
      where: { id: actionId },
      data: { status: 'CONFIRMED', confirmedAt: new Date(), confirmedByUserId },
    });
    await this.audit.record({
      actorUserId: confirmedByUserId,
      action: `confirm:${action.tool}`,
      resourceType: 'PendingAssistantAction',
      resourceId: actionId,
      details: { args },
    });

    return outcome.ok
      ? { reply: `Done — ${describeAction(action.tool, args)} completed.` }
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
  private async chatWithRetry(messages: ChatMessage[]): Promise<ChatMessage> {
    try {
      return (await this.llm.chat(messages, { tools: ASSISTANT_TOOLS }))
        .message;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (/rate_limit_exceeded|429/i.test(reason)) {
        throw error;
      }
      this.logger.warn(`LLM call failed, retrying once: ${reason}`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      return (await this.llm.chat(messages, { tools: ASSISTANT_TOOLS }))
        .message;
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
}

function describeLlmFailure(reason: string): string {
  if (/rate_limit_exceeded|429/i.test(reason)) {
    return 'The assistant is temporarily rate-limited — please wait a few seconds and try again.';
  }
  return 'The assistant is temporarily unavailable — please try again in a moment.';
}

function describeAction(tool: string, args: Record<string, unknown>): string {
  if (tool === 'publishJobPosting')
    return `publish job posting ${String(args.jobPostingId)}`;
  if (tool === 'updateJobPosting') {
    const changes = args.changes as Record<string, unknown> | undefined;
    return `change job posting ${String(args.jobPostingId)} status to ${String(changes?.status)}`;
  }
  return `${tool}(${JSON.stringify(args)})`;
}
