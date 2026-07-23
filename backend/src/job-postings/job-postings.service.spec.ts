import { AuditLogService } from '../audit/audit-log.service';
import { DocumentRetrievalService } from '../documents/services/document-retrieval.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingsService } from '../shared/embeddings/embeddings.service';
import { LlmClientService } from '../shared/llm/llm-client.service';
import { JobPostingsService } from './job-postings.service';

function jobRow(overrides: Partial<{ id: string; status: string }> = {}) {
  return {
    id: overrides.id ?? 'job-1',
    title: 'Software Engineer Intern',
    description: 'desc',
    candidateSummary: null,
    status: overrides.status ?? 'DRAFT',
    experienceMin: 0,
    salaryMax: null,
    hiringTarget: 1,
    location: null,
    seniority: null,
    workModel: null,
    deadline: new Date(),
    portalPublishedAt: null,
    createdByUserId: 'user-1',
    createdAt: new Date(),
    jobSkills: [],
  };
}

function buildService(options: { jobStatus?: string } = {}) {
  const prisma = {
    job: {
      findUnique: jest
        .fn()
        .mockResolvedValue(jobRow({ status: options.jobStatus })),
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue(jobRow({ status: options.jobStatus })),
      create: jest
        .fn()
        .mockResolvedValue(jobRow({ status: options.jobStatus })),
      update: jest.fn().mockResolvedValue({}),
    },
    skill: {
      upsert: jest.fn(({ where }: { where: { name: string } }) =>
        Promise.resolve({ id: `skill-${where.name}`, name: where.name }),
      ),
    },
    jobSkill: {
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    jobPostingHiringManager: {
      count: jest.fn().mockResolvedValue(1),
    },
    $executeRaw: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<PrismaService>;

  const embeddings = {
    embed: jest.fn().mockResolvedValue([0.1, 0.2]),
    toVectorLiteral: jest.fn().mockReturnValue('[0.1,0.2]'),
  } as unknown as jest.Mocked<EmbeddingsService>;
  const llm = {
    chat: jest.fn(),
  } as unknown as jest.Mocked<LlmClientService>;
  const documentRetrieval = {
    retrieve: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<DocumentRetrievalService>;
  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<AuditLogService>;

  return {
    service: new JobPostingsService(
      prisma,
      documentRetrieval,
      llm,
      embeddings,
      audit,
    ),
    prisma,
    llm,
  };
}

describe('JobPostingsService.update — skill sync', () => {
  it('replaces the required-skill set instead of only adding to it', async () => {
    const { service, prisma } = buildService();

    await service.update(
      'job-1',
      { requiredSkills: ['JavaScript', 'Git'] },
      'user-1',
    );

    expect(prisma.jobSkill.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          jobId: 'job-1',
          required: true,
          skillId: { notIn: ['skill-JavaScript', 'skill-Git'] },
        }),
      }),
    );
  });

  it('replaces preferredSkills independently of requiredSkills', async () => {
    const { service, prisma } = buildService();

    await service.update(
      'job-1',
      { preferredSkills: ['Python', 'SQL'] },
      'user-1',
    );

    expect(prisma.jobSkill.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          jobId: 'job-1',
          required: false,
          skillId: { notIn: ['skill-Python', 'skill-SQL'] },
        }),
      }),
    );
    expect(prisma.jobSkill.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('does not touch skills at all when requiredSkills/preferredSkills are omitted from the patch', async () => {
    const { service, prisma } = buildService();

    await service.update('job-1', { title: 'New Title' }, 'user-1');

    expect(prisma.jobSkill.deleteMany).not.toHaveBeenCalled();
    expect(prisma.jobSkill.upsert).not.toHaveBeenCalled();
  });
});

describe('JobPostingsService.publish — mandatory Hiring Manager gate', () => {
  it('blocks publishing with the exact required message when no Hiring Manager is assigned', async () => {
    const { service, prisma } = buildService({ jobStatus: 'DRAFT' });
    (prisma.jobPostingHiringManager.count as jest.Mock).mockResolvedValue(0);

    await expect(service.publish('job-1', 'user-1')).rejects.toThrow(
      'Assign at least one Hiring Manager before publishing this job posting.',
    );
    expect(prisma.job.update).not.toHaveBeenCalled();
  });

  it('publishes once at least one Hiring Manager is assigned', async () => {
    const { service, prisma } = buildService({ jobStatus: 'DRAFT' });
    (prisma.jobPostingHiringManager.count as jest.Mock).mockResolvedValue(1);

    await service.publish('job-1', 'user-1');

    expect(prisma.job.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-1' },
        data: expect.objectContaining({ status: 'PUBLISHED' }),
      }),
    );
  });

  it('stays idempotent for an already-published job without re-checking assignment', async () => {
    const { service, prisma } = buildService({ jobStatus: 'PUBLISHED' });
    (prisma.jobPostingHiringManager.count as jest.Mock).mockResolvedValue(0);

    await service.publish('job-1', 'user-1');

    expect(prisma.jobPostingHiringManager.count).not.toHaveBeenCalled();
    expect(prisma.job.update).not.toHaveBeenCalled();
  });
});

describe('JobPostingsService.create — candidate-safe summary drafting', () => {
  it('drafts description + candidateSummary in one JSON-mode call when HR supplies no description', async () => {
    const { service, llm } = buildService();
    llm.chat.mockResolvedValue({
      message: {
        role: 'assistant',
        content: JSON.stringify({
          description: 'Full internal description with quals.',
          candidateSummary: 'Short candidate-safe blurb.',
        }),
      },
      finishReason: 'stop',
    });

    await service.create(
      {
        title: 'Backend Engineer',
        rawPrompt: 'Hire a backend engineer',
        experienceMin: 2,
        hiringTarget: 1,
        deadline: new Date().toISOString(),
      },
      'user-1',
    );

    expect(llm.chat).toHaveBeenCalledTimes(1);
    const [, options] = llm.chat.mock.calls[0];
    expect(options).toEqual(expect.objectContaining({ jsonResponse: true }));
  });

  it('generates a candidateSummary via a single extra call when HR supplies their own description', async () => {
    const { service, llm } = buildService();
    llm.chat.mockResolvedValue({
      message: {
        role: 'assistant',
        content: JSON.stringify({ candidateSummary: 'Short blurb.' }),
      },
      finishReason: 'stop',
    });

    await service.create(
      {
        title: 'Backend Engineer',
        rawPrompt: 'Hire a backend engineer',
        description: 'HR-written full description with required quals.',
        experienceMin: 2,
        hiringTarget: 1,
        deadline: new Date().toISOString(),
      },
      'user-1',
    );

    expect(llm.chat).toHaveBeenCalledTimes(1);
  });
});

describe('JobPostingsService.update — candidateSummary stays in sync', () => {
  it('regenerates candidateSummary when description changes', async () => {
    const { service, prisma, llm } = buildService();
    llm.chat.mockResolvedValue({
      message: {
        role: 'assistant',
        content: JSON.stringify({ candidateSummary: 'Updated blurb.' }),
      },
      finishReason: 'stop',
    });

    await service.update(
      'job-1',
      { description: 'A rewritten description.' },
      'user-1',
    );

    expect(llm.chat).toHaveBeenCalledTimes(1);
    expect(prisma.job.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          description: 'A rewritten description.',
          candidateSummary: 'Updated blurb.',
        }),
      }),
    );
  });

  it('does not call the LLM when description is not part of the patch', async () => {
    const { service, llm } = buildService();

    await service.update('job-1', { title: 'New Title' }, 'user-1');

    expect(llm.chat).not.toHaveBeenCalled();
  });
});
