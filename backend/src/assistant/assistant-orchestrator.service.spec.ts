import { ConflictException, NotFoundException } from '@nestjs/common';
import { AuditLogService } from '../audit/audit-log.service';
import { JobPostingsService } from '../job-postings/job-postings.service';
import { PrismaService } from '../prisma/prisma.service';
import { AssistantAgentGraph } from './assistant-agent.graph';
import { AssistantOrchestratorService } from './assistant-orchestrator.service';
import { ToolRegistryService } from './tool-registry.service';

function buildOrchestrator() {
  const agentGraph = {
    run: jest.fn(),
  } as unknown as jest.Mocked<AssistantAgentGraph>;
  const toolRegistry = {
    execute: jest.fn(),
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
    agentGraph,
    toolRegistry,
    prisma,
    audit,
    jobPostings,
  );
  return { orchestrator, agentGraph, toolRegistry, prisma, audit, jobPostings };
}

describe('AssistantOrchestratorService', () => {
  describe('handleMessage', () => {
    it('returns the graph result reply as-is when there is no gated action', async () => {
      const { orchestrator, agentGraph } = buildOrchestrator();
      agentGraph.run.mockResolvedValue({
        finalReply:
          'I can only help with job postings, CV matching, candidate ranking, and company policies.',
      });

      const result = await orchestrator.handleMessage(
        [],
        'what is the capital of France?',
        'user-1',
        'HR_ADMIN',
      );

      expect(result.reply).toContain('I can only help with job postings');
      expect(result.pendingAction).toBeUndefined();
    });

    it('passes the actor role through to tool selection and the graph', async () => {
      const { orchestrator, agentGraph } = buildOrchestrator();
      agentGraph.run.mockResolvedValue({ finalReply: 'ok' });

      await orchestrator.handleMessage([], 'list my jobs', 'user-1', 'HIRING_MANAGER');

      expect(agentGraph.run).toHaveBeenCalledWith(
        expect.objectContaining({ actorUserId: 'user-1', actorRole: 'HIRING_MANAGER' }),
      );
    });

    it('surfaces the created job posting the graph tracked, alongside the reply', async () => {
      const { orchestrator, agentGraph } = buildOrchestrator();
      const createdJob = {
        id: 'job-1',
        title: 'Frontend Web Developer',
        status: 'DRAFT',
        location: 'Lahore, Pakistan',
      };
      agentGraph.run.mockResolvedValue({
        finalReply: "I've created a draft for Frontend Web Developer.",
        lastJobPosting: createdJob as never,
      });

      const result = await orchestrator.handleMessage(
        [],
        'create a frontend web dev job',
        'user-1',
        'HR_ADMIN',
      );

      expect(result.jobPosting).toEqual(createdJob);
    });

    it('turns a gatedAction from the graph into a pendingAction instead of executing it', async () => {
      const { orchestrator, agentGraph, toolRegistry, prisma } = buildOrchestrator();
      agentGraph.run.mockResolvedValue({
        gatedAction: { tool: 'publishJobPosting', args: { jobPostingId: 'job-1' } },
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
        'HR_ADMIN',
      );

      expect(toolRegistry.execute).not.toHaveBeenCalled();
      expect(result.pendingAction).toMatchObject({ actionId: 'action-1' });
      // No tool name, id, or raw args leaked into the human-facing description.
      expect(result.pendingAction?.description).not.toContain('publishJobPosting');
      expect(result.pendingAction?.description).not.toContain('job-1');
      expect(result.reply).toContain('confirmation');
    });

    it('resolves the job posting title into the pendingAction preview before confirmation', async () => {
      const { orchestrator, agentGraph, prisma, jobPostings } = buildOrchestrator();
      agentGraph.run.mockResolvedValue({
        gatedAction: { tool: 'publishJobPosting', args: { jobPostingId: 'job-1' } },
      });
      (prisma.pendingAssistantAction.create as jest.Mock).mockResolvedValue({
        id: 'action-1',
        expiresAt: new Date(Date.now() + 1_800_000),
      });

      const result = await orchestrator.handleMessage(
        [],
        'publish the backend engineer posting',
        'user-1',
        'HR_ADMIN',
      );

      expect(jobPostings.getById).toHaveBeenCalledWith('job-1');
      expect(result.reply).toContain('Backend Engineer');
    });
  });

  describe('confirmAction', () => {
    it('executes the tool directly (no graph run) and marks the action CONFIRMED', async () => {
      const { orchestrator, agentGraph, toolRegistry, prisma, audit } =
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

      const result = await orchestrator.confirmAction('action-1', 'user-2', 'HR_ADMIN');

      expect(agentGraph.run).not.toHaveBeenCalled();
      expect(toolRegistry.execute).toHaveBeenCalledWith(
        'publishJobPosting',
        { jobPostingId: 'job-1' },
        { actorUserId: 'user-2', actorRole: 'HR_ADMIN' },
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

      const result = await orchestrator.confirmAction('action-1', 'user-2', 'HR_ADMIN');

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

      const result = await orchestrator.confirmAction('action-1', 'user-2', 'HR_ADMIN');

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
        orchestrator.confirmAction('missing', 'user-1', 'HR_ADMIN'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ConflictException if the action was already confirmed', async () => {
      const { orchestrator, prisma } = buildOrchestrator();
      (prisma.pendingAssistantAction.findUnique as jest.Mock).mockResolvedValue(
        { id: 'action-1', status: 'CONFIRMED', expiresAt: new Date() },
      );

      await expect(
        orchestrator.confirmAction('action-1', 'user-1', 'HR_ADMIN'),
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
        orchestrator.confirmAction('action-1', 'user-1', 'HR_ADMIN'),
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
