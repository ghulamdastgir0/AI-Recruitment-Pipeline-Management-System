import { ConflictException, NotFoundException } from '@nestjs/common';
import { AuditLogService } from '../audit/audit-log.service';
import { JobPostingsService } from '../job-postings/job-postings.service';
import { PrismaService } from '../prisma/prisma.service';
import { LlmClientService } from '../shared/llm/llm-client.service';
import { AssistantOrchestratorService } from './assistant-orchestrator.service';
import { ToolRegistryService } from './tool-registry.service';

function buildOrchestrator() {
  const llm = { chat: jest.fn() } as unknown as jest.Mocked<LlmClientService>;
  const toolRegistry = {
    isGated: jest.fn().mockReturnValue(false),
    execute: jest.fn(),
    parseArgs: jest.fn(
      (raw: string) => JSON.parse(raw) as Record<string, unknown>,
    ),
  } as unknown as jest.Mocked<ToolRegistryService>;
  const prisma = {
    pendingAssistantAction: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  } as unknown as jest.Mocked<PrismaService>;
  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<AuditLogService>;
  const jobPostings = {
    getById: jest.fn().mockResolvedValue({
      id: 'job-1',
      title: 'Backend Engineer',
      status: 'DRAFT',
    }),
  } as unknown as jest.Mocked<JobPostingsService>;

  const orchestrator = new AssistantOrchestratorService(
    llm,
    toolRegistry,
    prisma,
    audit,
    jobPostings,
  );
  return { orchestrator, llm, toolRegistry, prisma, audit, jobPostings };
}

describe('AssistantOrchestratorService', () => {
  describe('handleMessage', () => {
    it('returns the plain reply when the model makes no tool calls', async () => {
      const { orchestrator, llm } = buildOrchestrator();
      llm.chat.mockResolvedValue({
        message: {
          role: 'assistant',
          content:
            'I can only help with job postings, CV matching, candidate ranking, and company policies.',
        },
        finishReason: 'stop',
      });

      const result = await orchestrator.handleMessage(
        [],
        'what is the capital of France?',
        'user-1',
      );

      expect(result.reply).toContain('I can only help with job postings');
      expect(result.pendingAction).toBeUndefined();
    });

    it('returns a friendly reply instead of throwing when the LLM call fails', async () => {
      const { orchestrator, llm } = buildOrchestrator();
      llm.chat.mockRejectedValue(
        new Error(
          'Groq API error (429): {"error":{"type":"rate_limit_exceeded"}}',
        ),
      );

      const result = await orchestrator.handleMessage(
        [],
        'create a job posting for a QA engineer',
        'user-1',
      );

      expect(result.reply).toMatch(/rate-limited/i);
      expect(result.pendingAction).toBeUndefined();
      // Rate limits don't get the quiet retry — Groq's own backoff hint is
      // several seconds, so retrying immediately would just fail again.
      expect(llm.chat).toHaveBeenCalledTimes(1);
    });

    it('quietly retries once and succeeds after a transient (non-rate-limit) failure', async () => {
      const { orchestrator, llm } = buildOrchestrator();
      llm.chat
        .mockRejectedValueOnce(new Error('fetch failed: network down'))
        .mockResolvedValueOnce({
          message: { role: 'assistant', content: 'All set.' },
          finishReason: 'stop',
        });

      const result = await orchestrator.handleMessage([], 'hello', 'user-1');

      expect(result.reply).toBe('All set.');
      expect(llm.chat).toHaveBeenCalledTimes(2);
    });

    it('returns a generic unavailable reply for non-rate-limit LLM failures', async () => {
      const { orchestrator, llm } = buildOrchestrator();
      llm.chat.mockRejectedValue(new Error('fetch failed: network down'));

      const result = await orchestrator.handleMessage([], 'hello', 'user-1');

      expect(result.reply).toMatch(/temporarily unavailable/i);
      expect(llm.chat).toHaveBeenCalledTimes(2);
    });

    it('executes an ungated tool call and feeds the result back for a final answer', async () => {
      const { orchestrator, llm, toolRegistry } = buildOrchestrator();
      llm.chat
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
          message: {
            role: 'assistant',
            content: 'Parental leave is 16 weeks.',
          },
          finishReason: 'stop',
        });
      toolRegistry.execute.mockResolvedValue({
        ok: true,
        result: { results: [] },
      });

      const result = await orchestrator.handleMessage(
        [],
        'what is parental leave?',
        'user-1',
      );

      expect(toolRegistry.execute).toHaveBeenCalledWith(
        'searchCompanyPolicies',
        { query: 'parental leave' },
        { actorUserId: 'user-1', attachedFile: undefined },
      );
      expect(result.reply).toBe('Parental leave is 16 weeks.');
      expect(llm.chat).toHaveBeenCalledTimes(2);
    });

    it('surfaces the created job posting as structured data alongside the reply', async () => {
      const { orchestrator, llm, toolRegistry } = buildOrchestrator();
      const createdJob = {
        id: 'job-1',
        title: 'Frontend Web Developer',
        status: 'DRAFT',
        location: 'Lahore, Pakistan',
      };
      llm.chat
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
          message: {
            role: 'assistant',
            content: "I've created a draft for Frontend Web Developer.",
          },
          finishReason: 'stop',
        });
      toolRegistry.execute.mockResolvedValue({ ok: true, result: createdJob });

      const result = await orchestrator.handleMessage(
        [],
        'create a frontend web dev job',
        'user-1',
      );

      expect(result.jobPosting).toEqual(createdJob);
    });

    it('short-circuits a gated tool call into a pendingAction instead of executing it', async () => {
      const { orchestrator, llm, toolRegistry, prisma } = buildOrchestrator();
      toolRegistry.isGated.mockReturnValue(true);
      llm.chat.mockResolvedValue({
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
      (prisma.pendingAssistantAction.create as jest.Mock).mockResolvedValue({
        id: 'action-1',
        tool: 'publishJobPosting',
        argsJson: { jobPostingId: 'job-1' },
        expiresAt: new Date(Date.now() + 1_800_000),
      });

      const result = await orchestrator.handleMessage(
        [],
        'publish the backend engineer posting',
        'user-1',
      );

      expect(toolRegistry.execute).not.toHaveBeenCalled();
      expect(result.pendingAction).toMatchObject({
        actionId: 'action-1',
        tool: 'publishJobPosting',
      });
      expect(result.reply).toContain('confirmation');
    });

    it('binds an attached CV file only to the uploadCandidateCv tool call', async () => {
      const { orchestrator, llm, toolRegistry } = buildOrchestrator();
      const attachedFile = {
        buffer: Buffer.from('%PDF-1.4'),
        originalname: 'resume.pdf',
      };
      llm.chat
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

      await orchestrator.handleMessage(
        [],
        'upload this CV for the job',
        'user-1',
        attachedFile,
      );

      expect(toolRegistry.execute).toHaveBeenCalledWith(
        'uploadCandidateCv',
        { jobPostingId: 'job-1' },
        { actorUserId: 'user-1', attachedFile },
      );
    });
  });

  describe('confirmAction', () => {
    it('executes the tool directly (no LLM call) and marks the action CONFIRMED', async () => {
      const { orchestrator, llm, toolRegistry, prisma, audit } =
        buildOrchestrator();
      (prisma.pendingAssistantAction.findUnique as jest.Mock).mockResolvedValue(
        {
          id: 'action-1',
          tool: 'publishJobPosting',
          argsJson: { jobPostingId: 'job-1' },
          status: 'PENDING',
          expiresAt: new Date(Date.now() + 1_800_000),
        },
      );
      toolRegistry.execute.mockResolvedValue({
        ok: true,
        result: { id: 'job-1', status: 'PUBLISHED' },
      });

      const result = await orchestrator.confirmAction('action-1', 'user-2');

      expect(llm.chat).not.toHaveBeenCalled();
      expect(toolRegistry.execute).toHaveBeenCalledWith(
        'publishJobPosting',
        { jobPostingId: 'job-1' },
        { actorUserId: 'user-2' },
      );
      expect(prisma.pendingAssistantAction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'action-1' },
          data: expect.objectContaining({ status: 'CONFIRMED' }),
        }),
      );
      expect(audit.record).toHaveBeenCalled();
      expect(result.reply).toContain('Done');
    });

    it('resolves the job posting title/status server-side into the confirmation reply, not just the raw id', async () => {
      const { orchestrator, prisma, toolRegistry, jobPostings } =
        buildOrchestrator();
      (prisma.pendingAssistantAction.findUnique as jest.Mock).mockResolvedValue(
        {
          id: 'action-1',
          tool: 'publishJobPosting',
          argsJson: { jobPostingId: 'job-1' },
          status: 'PENDING',
          expiresAt: new Date(Date.now() + 1_800_000),
        },
      );
      toolRegistry.execute.mockResolvedValue({
        ok: true,
        result: { id: 'job-1', status: 'PUBLISHED' },
      });

      const result = await orchestrator.confirmAction('action-1', 'user-2');

      expect(jobPostings.getById).toHaveBeenCalledWith('job-1');
      expect(result.reply).toContain('Backend Engineer');
    });

    it('resolves the job posting title into the pendingAction preview shown before HR confirms', async () => {
      const { orchestrator, llm, toolRegistry, prisma, jobPostings } =
        buildOrchestrator();
      toolRegistry.isGated.mockReturnValue(true);
      llm.chat.mockResolvedValue({
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
      (prisma.pendingAssistantAction.create as jest.Mock).mockResolvedValue({
        id: 'action-1',
        expiresAt: new Date(Date.now() + 1_800_000),
      });

      const result = await orchestrator.handleMessage(
        [],
        'publish the backend engineer posting',
        'user-1',
      );

      expect(jobPostings.getById).toHaveBeenCalledWith('job-1');
      expect(result.reply).toContain('Backend Engineer');
    });

    it('marks the action FAILED (not CONFIRMED) when the underlying tool call fails', async () => {
      const { orchestrator, prisma, toolRegistry, audit } = buildOrchestrator();
      (prisma.pendingAssistantAction.findUnique as jest.Mock).mockResolvedValue(
        {
          id: 'action-1',
          tool: 'publishJobPosting',
          argsJson: { jobPostingId: 'job-1' },
          status: 'PENDING',
          expiresAt: new Date(Date.now() + 1_800_000),
        },
      );
      toolRegistry.execute.mockResolvedValue({
        ok: false,
        result: { error: 'Assign at least one Hiring Manager before publishing this job posting.' },
      });

      const result = await orchestrator.confirmAction('action-1', 'user-2');

      expect(prisma.pendingAssistantAction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'action-1' },
          data: expect.objectContaining({ status: 'FAILED' }),
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ details: expect.objectContaining({ ok: false }) }),
      );
      expect(result.reply).toContain('That failed');
    });

    it('throws NotFoundException for an unknown action id', async () => {
      const { orchestrator, prisma } = buildOrchestrator();
      (prisma.pendingAssistantAction.findUnique as jest.Mock).mockResolvedValue(
        null,
      );

      await expect(
        orchestrator.confirmAction('missing', 'user-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ConflictException if the action was already confirmed', async () => {
      const { orchestrator, prisma } = buildOrchestrator();
      (prisma.pendingAssistantAction.findUnique as jest.Mock).mockResolvedValue(
        { id: 'action-1', status: 'CONFIRMED', expiresAt: new Date() },
      );

      await expect(
        orchestrator.confirmAction('action-1', 'user-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('marks an expired action EXPIRED and throws instead of executing it', async () => {
      const { orchestrator, prisma, toolRegistry } = buildOrchestrator();
      (prisma.pendingAssistantAction.findUnique as jest.Mock).mockResolvedValue(
        {
          id: 'action-1',
          status: 'PENDING',
          expiresAt: new Date(Date.now() - 1000),
        },
      );

      await expect(
        orchestrator.confirmAction('action-1', 'user-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.pendingAssistantAction.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'EXPIRED' } }),
      );
      expect(toolRegistry.execute).not.toHaveBeenCalled();
    });
  });

  describe('cancelAction', () => {
    it('marks a pending action CANCELLED', async () => {
      const { orchestrator, prisma, audit } = buildOrchestrator();
      (prisma.pendingAssistantAction.findUnique as jest.Mock).mockResolvedValue(
        { id: 'action-1', status: 'PENDING' },
      );

      await orchestrator.cancelAction('action-1', 'user-1');

      expect(prisma.pendingAssistantAction.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'CANCELLED' } }),
      );
      expect(audit.record).toHaveBeenCalled();
    });

    it('is a no-op for an action that is no longer pending', async () => {
      const { orchestrator, prisma } = buildOrchestrator();
      (prisma.pendingAssistantAction.findUnique as jest.Mock).mockResolvedValue(
        { id: 'action-1', status: 'CONFIRMED' },
      );

      await orchestrator.cancelAction('action-1', 'user-1');

      expect(prisma.pendingAssistantAction.update).not.toHaveBeenCalled();
    });
  });
});
