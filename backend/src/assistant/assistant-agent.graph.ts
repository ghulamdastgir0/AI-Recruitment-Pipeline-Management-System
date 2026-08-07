import { Injectable } from '@nestjs/common';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { UploadedCv } from '../candidates/services/cv-upload.service';
import type { Role } from '../generated/prisma/enums';
import { JobPostingWithSkills } from '../job-postings/job-postings.service';
import { GeminiClientService } from '../shared/llm/gemini-client.service';
import { ChatMessage } from '../shared/llm/llm-client.types';
import { AssistantToolDefinition } from './tool-definitions';
import { ToolRegistryService } from './tool-registry.service';

export interface GatedAction {
  tool: string;
  args: Record<string, unknown>;
}

export interface AssistantAgentInput {
  messages: ChatMessage[];
  tools: AssistantToolDefinition[];
  actorUserId: string;
  actorRole: Role;
  attachedFile?: UploadedCv;
}

export interface AssistantAgentResult {
  finalReply?: string;
  gatedAction?: GatedAction;
  lastJobPosting?: JobPostingWithSkills;
}

const MAX_TOOL_ITERATIONS = 5;
const RETRY_DELAY_MS = 1500;

// The LLM only ever sees a job posting as JSON in a tool result and
// paraphrases it back in prose — tracked separately here so the frontend can
// render an actual structured job card instead of relying on that paraphrase.
const JOB_POSTING_RESULT_TOOLS = new Set(['createJobPosting', 'updateJobPosting']);

function describeLlmFailure(reason: string): string {
  if (/rate_limit_exceeded|429/i.test(reason)) {
    return 'The assistant is temporarily rate-limited — please wait a few seconds and try again.';
  }
  return 'The assistant is temporarily unavailable — please try again in a moment.';
}

const AgentState = Annotation.Root({
  messages: Annotation<ChatMessage[]>,
  tools: Annotation<AssistantToolDefinition[]>,
  actorUserId: Annotation<string>,
  actorRole: Annotation<Role>,
  attachedFile: Annotation<UploadedCv | undefined>,
  iteration: Annotation<number>,
  lastJobPosting: Annotation<JobPostingWithSkills | undefined>,
  gatedAction: Annotation<GatedAction | undefined>,
  finalReply: Annotation<string | undefined>,
});

/**
 * The assistant's tool-calling loop as an explicit LangGraph StateGraph,
 * built the same way InterviewOrchestratorService builds its graphs
 * (compiled once in the constructor, invoked fresh per call — conversation
 * history is reconstructed by the caller every turn, so there's no
 * checkpointer here). Replaces what used to be a hand-rolled `for` loop in
 * AssistantOrchestratorService: an `agent` node calls Gemini and decides
 * whether it's done, a `tools` node executes whatever it asked for (and
 * short-circuits the moment it hits a gated call — publishing, deleting,
 * a status change, a hiring decision — since those must never execute
 * without a separate explicit confirmation step, see ToolRegistryService.
 * isGated), and the two loop on each other up to MAX_TOOL_ITERATIONS times.
 */
@Injectable()
export class AssistantAgentGraph {
  private readonly graph = this.buildGraph();

  constructor(
    private readonly gemini: GeminiClientService,
    private readonly toolRegistry: ToolRegistryService,
  ) {}

  async run(input: AssistantAgentInput): Promise<AssistantAgentResult> {
    const final = await this.graph.invoke({
      messages: input.messages,
      tools: input.tools,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      attachedFile: input.attachedFile,
      iteration: 0,
    });

    return {
      finalReply: final.finalReply,
      gatedAction: final.gatedAction,
      lastJobPosting: final.lastJobPosting,
    };
  }

  /**
   * One quiet retry for transient failures (network blip, a momentary 5xx)
   * so a single hiccup doesn't surface as an error to HR/the manager. Skips
   * the retry for rate limits — retrying immediately would just fail again.
   */
  private async chatWithRetry(
    messages: ChatMessage[],
    tools: AssistantToolDefinition[],
  ): Promise<ChatMessage> {
    try {
      return (await this.gemini.chat(messages, { tools })).message;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (/rate_limit_exceeded|429/i.test(reason)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      return (await this.gemini.chat(messages, { tools })).message;
    }
  }

  private buildGraph() {
    const agent = async (
      state: typeof AgentState.State,
    ): Promise<typeof AgentState.Update> => {
      let message: ChatMessage;
      try {
        message = await this.chatWithRetry(state.messages, state.tools);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return {
          finalReply: describeLlmFailure(reason),
          iteration: state.iteration + 1,
        };
      }

      const messages = [...state.messages, message];
      if (!message.tool_calls || message.tool_calls.length === 0) {
        return {
          messages,
          finalReply: message.content ?? '',
          iteration: state.iteration + 1,
        };
      }
      return { messages, iteration: state.iteration + 1 };
    };

    const timeout = (): typeof AgentState.Update => ({
      finalReply:
        "I wasn't able to finish this within the allowed number of steps — try rephrasing or splitting the request into smaller parts.",
    });

    const tools = async (
      state: typeof AgentState.State,
    ): Promise<typeof AgentState.Update> => {
      const lastMessage = state.messages[state.messages.length - 1];
      const toolCalls = lastMessage?.tool_calls ?? [];
      const newMessages: ChatMessage[] = [];
      let lastJobPosting = state.lastJobPosting;

      for (const toolCall of toolCalls) {
        const args = this.toolRegistry.parseArgs(toolCall.function.arguments);

        if (this.toolRegistry.isGated(toolCall.function.name, args)) {
          return {
            messages: [...state.messages, ...newMessages],
            gatedAction: { tool: toolCall.function.name, args },
          };
        }

        const outcome = await this.toolRegistry.execute(
          toolCall.function.name,
          args,
          {
            actorUserId: state.actorUserId,
            actorRole: state.actorRole,
            attachedFile:
              toolCall.function.name === 'uploadCandidateCv'
                ? state.attachedFile
                : undefined,
          },
        );

        if (outcome.ok && JOB_POSTING_RESULT_TOOLS.has(toolCall.function.name)) {
          lastJobPosting = outcome.result as JobPostingWithSkills;
        }

        newMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(outcome.result),
        });
      }

      return { messages: [...state.messages, ...newMessages], lastJobPosting };
    };

    return new StateGraph(AgentState)
      .addNode('agent', agent)
      .addNode('timeout', timeout)
      // Named "executeTools" (not "tools") because "tools" is already the
      // state channel holding the tool schemas offered to the LLM — LangGraph
      // doesn't allow a node name to collide with a state attribute name.
      .addNode('executeTools', tools)
      .addEdge(START, 'agent')
      .addConditionalEdges(
        'agent',
        (state) => {
          if (state.finalReply !== undefined) return 'end';
          if (state.iteration >= MAX_TOOL_ITERATIONS) return 'timeout';
          return 'executeTools';
        },
        { end: END, timeout: 'timeout', executeTools: 'executeTools' },
      )
      .addEdge('timeout', END)
      .addConditionalEdges(
        'executeTools',
        (state) => (state.gatedAction ? 'end' : 'agent'),
        { end: END, agent: 'agent' },
      )
      .compile();
  }
}
