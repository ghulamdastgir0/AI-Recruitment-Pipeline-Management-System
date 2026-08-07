import { GeminiClientService } from '../shared/llm/gemini-client.service';
import { AssistantAgentGraph } from './assistant-agent.graph';
import { ToolRegistryService } from './tool-registry.service';

function buildGraph() {
  const gemini = { chat: jest.fn() } as unknown as jest.Mocked<GeminiClientService>;
  const toolRegistry = {
    isGated: jest.fn().mockReturnValue(false),
    execute: jest.fn(),
    parseArgs: jest.fn(
      (raw: string) => JSON.parse(raw) as Record<string, unknown>,
    ),
  } as unknown as jest.Mocked<ToolRegistryService>;

  const graph = new AssistantAgentGraph(gemini, toolRegistry);
  return { graph, gemini, toolRegistry };
}

const baseInput = {
  messages: [{ role: 'user' as const, content: 'hi' }],
  tools: [],
  actorUserId: 'user-1',
  actorRole: 'HR_ADMIN' as const,
};

describe('AssistantAgentGraph', () => {
  it('returns the plain reply when the model makes no tool calls', async () => {
    const { graph, gemini } = buildGraph();
    gemini.chat.mockResolvedValue({
      message: { role: 'assistant', content: 'Hello there.' },
      finishReason: 'stop',
    });

    const result = await graph.run(baseInput);

    expect(result.finalReply).toBe('Hello there.');
    expect(result.gatedAction).toBeUndefined();
  });

  it('returns a friendly reply instead of throwing when the LLM call fails', async () => {
    const { graph, gemini } = buildGraph();
    gemini.chat.mockRejectedValue(
      new Error('Gemini API error (429): rate_limit_exceeded'),
    );

    const result = await graph.run(baseInput);

    expect(result.finalReply).toMatch(/rate-limited/i);
    // Rate limits don't get the quiet retry.
    expect(gemini.chat).toHaveBeenCalledTimes(1);
  });

  it('quietly retries once and succeeds after a transient (non-rate-limit) failure', async () => {
    const { graph, gemini } = buildGraph();
    gemini.chat
      .mockRejectedValueOnce(new Error('fetch failed: network down'))
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: 'All set.' },
        finishReason: 'stop',
      });

    const result = await graph.run(baseInput);

    expect(result.finalReply).toBe('All set.');
    expect(gemini.chat).toHaveBeenCalledTimes(2);
  });

  it('executes an ungated tool call and feeds the result back for a final answer', async () => {
    const { graph, gemini, toolRegistry } = buildGraph();
    gemini.chat
      .mockResolvedValueOnce({
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call-1',
              type: 'function',
              function: {
                name: 'searchCompanyPolicies',
                arguments: '{"query":"parental leave"}',
              },
            },
          ],
        },
        finishReason: 'tool_calls',
      })
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: 'Parental leave is 16 weeks.' },
        finishReason: 'stop',
      });
    toolRegistry.execute.mockResolvedValue({ ok: true, result: { results: [] } });

    const result = await graph.run(baseInput);

    expect(toolRegistry.execute).toHaveBeenCalledWith(
      'searchCompanyPolicies',
      { query: 'parental leave' },
      { actorUserId: 'user-1', actorRole: 'HR_ADMIN', attachedFile: undefined },
    );
    expect(result.finalReply).toBe('Parental leave is 16 weeks.');
    expect(gemini.chat).toHaveBeenCalledTimes(2);
  });

  it('tracks the created/updated job posting result across the loop', async () => {
    const { graph, gemini, toolRegistry } = buildGraph();
    const createdJob = { id: 'job-1', title: 'Frontend Web Developer', status: 'DRAFT' };
    gemini.chat
      .mockResolvedValueOnce({
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call-1',
              type: 'function',
              function: {
                name: 'createJobPosting',
                arguments: '{"title":"Frontend Web Developer"}',
              },
            },
          ],
        },
        finishReason: 'tool_calls',
      })
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: "I've created a draft." },
        finishReason: 'stop',
      });
    toolRegistry.execute.mockResolvedValue({ ok: true, result: createdJob });

    const result = await graph.run(baseInput);

    expect(result.lastJobPosting).toEqual(createdJob);
  });

  it('short-circuits a gated tool call into gatedAction instead of executing it', async () => {
    const { graph, gemini, toolRegistry } = buildGraph();
    toolRegistry.isGated.mockReturnValue(true);
    gemini.chat.mockResolvedValue({
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: {
              name: 'publishJobPosting',
              arguments: '{"jobPostingId":"job-1"}',
            },
          },
        ],
      },
      finishReason: 'tool_calls',
    });

    const result = await graph.run(baseInput);

    expect(toolRegistry.execute).not.toHaveBeenCalled();
    expect(result.gatedAction).toEqual({
      tool: 'publishJobPosting',
      args: { jobPostingId: 'job-1' },
    });
    expect(result.finalReply).toBeUndefined();
  });

  it('binds an attached CV file only to the uploadCandidateCv tool call', async () => {
    const { graph, gemini, toolRegistry } = buildGraph();
    const attachedFile = {
      buffer: Buffer.from('%PDF-1.4'),
      originalname: 'resume.pdf',
    } as never;
    gemini.chat
      .mockResolvedValueOnce({
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call-1',
              type: 'function',
              function: {
                name: 'uploadCandidateCv',
                arguments: '{"jobPostingId":"job-1"}',
              },
            },
          ],
        },
        finishReason: 'tool_calls',
      })
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: 'Uploaded.' },
        finishReason: 'stop',
      });
    toolRegistry.execute.mockResolvedValue({
      ok: true,
      result: { candidateProfileId: 'cand-1' },
    });

    await graph.run({ ...baseInput, attachedFile });

    expect(toolRegistry.execute).toHaveBeenCalledWith(
      'uploadCandidateCv',
      { jobPostingId: 'job-1' },
      { actorUserId: 'user-1', actorRole: 'HR_ADMIN', attachedFile },
    );
  });

  it('gives up gracefully after the max number of tool-calling iterations', async () => {
    const { graph, gemini, toolRegistry } = buildGraph();
    const toolCallMessage = {
      role: 'assistant' as const,
      content: null,
      tool_calls: [
        {
          id: 'call-1',
          type: 'function' as const,
          function: { name: 'searchCompanyPolicies', arguments: '{"query":"x"}' },
        },
      ],
    };
    gemini.chat.mockResolvedValue({ message: toolCallMessage, finishReason: 'tool_calls' });
    toolRegistry.execute.mockResolvedValue({ ok: true, result: { results: [] } });

    const result = await graph.run(baseInput);

    expect(result.finalReply).toMatch(/wasn't able to finish/i);
    expect(gemini.chat).toHaveBeenCalledTimes(5);
  });
});
