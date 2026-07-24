import { AuditLogService } from '../audit/audit-log.service';
import { DocumentRetrievalService } from '../documents/services/document-retrieval.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../shared/email/email.service';
import { EmbeddingsService } from '../shared/embeddings/embeddings.service';
import { LlmClientService } from '../shared/llm/llm-client.service';
import { JobPostingsService } from './job-postings.service';

function jobRow(
  overrides: Partial<{
    id: string;
    status: string;
    hiredCount: number;
    hiringTarget: number;
  }> = {},
) {
  return {
    id: overrides.id ?? 'job-1',
    title: 'Software Engineer Intern',
    description: 'desc',
    candidateSummary: null,
    status: overrides.status ?? 'DRAFT',
    experienceMin: 0,
    salaryMax: null,
    hiringTarget: overrides.hiringTarget ?? 1,
    hiredCount: overrides.hiredCount ?? 0,
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

function buildService(
  options: { jobStatus?: string; hiredCount?: number; hiringTarget?: number } = {},
) {
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
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue(
        jobRow({
          status: options.jobStatus,
          hiredCount: options.hiredCount,
          hiringTarget: options.hiringTarget,
        }),
      ),
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
    application: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
    emailLog: { create: jest.fn().mockResolvedValue({}) },
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
  const email = {
    send: jest.fn().mockResolvedValue(true),
  } as unknown as jest.Mocked<EmailService>;

  return {
    service: new JobPostingsService(
      prisma,
      documentRetrieval,
      llm,
      embeddings,
      audit,
      email,
    ),
    prisma,
    llm,
    email,
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

describe('JobPostingsService.update — publish-guard bypass (finding #4)', () => {
  it('blocks a generic PATCH that sets status: PUBLISHED when no Hiring Manager is assigned', async () => {
    const { service, prisma } = buildService({ jobStatus: 'DRAFT' });
    (prisma.jobPostingHiringManager.count as jest.Mock).mockResolvedValue(0);

    await expect(
      service.update('job-1', { status: 'PUBLISHED' }, 'user-1'),
    ).rejects.toThrow(
      'Assign at least one Hiring Manager before publishing this job posting.',
    );
    expect(prisma.job.update).not.toHaveBeenCalled();
  });

  it('allows the generic PATCH to publish once a Hiring Manager is assigned, and stamps portalPublishedAt', async () => {
    const { service, prisma } = buildService({ jobStatus: 'DRAFT' });
    (prisma.jobPostingHiringManager.count as jest.Mock).mockResolvedValue(1);

    await service.update('job-1', { status: 'PUBLISHED' }, 'user-1');

    expect(prisma.job.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-1' },
        data: expect.objectContaining({
          status: 'PUBLISHED',
          portalPublishedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('does not re-check assignment when the job is already PUBLISHED', async () => {
    const { service, prisma } = buildService({ jobStatus: 'PUBLISHED' });
    (prisma.jobPostingHiringManager.count as jest.Mock).mockResolvedValue(0);

    await service.update('job-1', { status: 'PUBLISHED' }, 'user-1');

    expect(prisma.jobPostingHiringManager.count).not.toHaveBeenCalled();
    expect(prisma.job.update).toHaveBeenCalled();
  });

  it('does not require a Hiring Manager for non-publish status changes (e.g. PAUSED)', async () => {
    const { service, prisma } = buildService({ jobStatus: 'PUBLISHED' });
    (prisma.jobPostingHiringManager.count as jest.Mock).mockResolvedValue(0);

    await service.update('job-1', { status: 'PAUSED' }, 'user-1');

    expect(prisma.jobPostingHiringManager.count).not.toHaveBeenCalled();
    expect(prisma.job.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PAUSED',
          portalUnpublishedAt: expect.any(Date),
        }),
      }),
    );
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

describe('JobPostingsService.close/archive — auto-close-at-target (finding #17)', () => {
  it('close() stamps portalUnpublishedAt and bulk-rejects in-flight applications with BULK_REJECTION', async () => {
    const { service, prisma, email } = buildService({ jobStatus: 'PUBLISHED' });
    (prisma.application.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'app-1',
        status: 'IN_REVIEW',
        candidateProfile: {
          candidateName: 'Jane',
          candidateEmail: 'jane@example.com',
          candidatePhone: null,
          extractedDataJson: null,
        },
      },
    ]);

    await service.close('job-1', 'user-1');

    expect(prisma.job.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-1' },
        data: expect.objectContaining({
          status: 'CLOSED',
          portalUnpublishedAt: expect.any(Date),
        }),
      }),
    );
    expect(prisma.application.update).toHaveBeenCalledWith({
      where: { id: 'app-1' },
      data: { status: 'REJECTED' },
    });
    expect(email.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'jane@example.com', type: 'BULK_REJECTION' }),
    );
    expect(prisma.emailLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ applicationId: 'app-1', type: 'BULK_REJECTION' }),
      }),
    );
  });

  it('close() leaves already-decided applications alone', async () => {
    const { service, prisma } = buildService({ jobStatus: 'PUBLISHED' });

    await service.close('job-1', 'user-1');

    expect(prisma.application.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: {
            in: [
              'APPLIED',
              'SCREENING',
              'INTERVIEW_PENDING',
              'IN_REVIEW',
              'MANAGER_REVIEW',
              'MANAGER_REVIEWED',
            ],
          },
        }),
      }),
    );
  });

  it('close() is idempotent for an already-closed job', async () => {
    const { service, prisma } = buildService({ jobStatus: 'CLOSED' });

    await service.close('job-1', 'user-1');

    expect(prisma.job.update).not.toHaveBeenCalled();
  });

  it('close() refuses to close an archived job', async () => {
    const { service } = buildService({ jobStatus: 'ARCHIVED' });

    await expect(service.close('job-1', 'user-1')).rejects.toThrow(
      'Cannot close an archived job posting',
    );
  });

  it('archive() only allows archiving a closed job', async () => {
    const { service, prisma } = buildService({ jobStatus: 'PUBLISHED' });

    await expect(service.archive('job-1', 'user-1')).rejects.toThrow(
      'Only a closed job posting can be archived',
    );
    expect(prisma.job.update).not.toHaveBeenCalled();
  });

  it('archive() archives a closed job', async () => {
    const { service, prisma } = buildService({ jobStatus: 'CLOSED' });

    await service.archive('job-1', 'user-1');

    expect(prisma.job.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { status: 'ARCHIVED' },
    });
  });

  it('incrementHiredCountAndMaybeAutoClose increments hiredCount without closing when the target is not yet met', async () => {
    const { service, prisma } = buildService({
      jobStatus: 'PUBLISHED',
      hiredCount: 1,
      hiringTarget: 3,
    });

    await service.incrementHiredCountAndMaybeAutoClose('job-1', 'user-1');

    expect(prisma.job.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { hiredCount: { increment: 1 } },
    });
    // Only the one increment call — close() would add a second job.update call.
    expect(prisma.job.update).toHaveBeenCalledTimes(1);
  });

  it('incrementHiredCountAndMaybeAutoClose auto-closes once hiredCount reaches hiringTarget', async () => {
    const { service, prisma } = buildService({
      jobStatus: 'PUBLISHED',
      hiredCount: 3,
      hiringTarget: 3,
    });

    await service.incrementHiredCountAndMaybeAutoClose('job-1', 'user-1');

    expect(prisma.job.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-1' },
        data: expect.objectContaining({ status: 'CLOSED' }),
      }),
    );
  });
});

describe('JobPostingsService.list — server-side search & pagination (finding #18)', () => {
  it('pushes a title search into the Prisma query instead of returning everything for client-side filtering', async () => {
    const { service, prisma } = buildService();
    (prisma.job.findMany as jest.Mock).mockResolvedValue([]);

    await service.list({ search: 'Backend' });

    expect(prisma.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          title: { contains: 'Backend', mode: 'insensitive' },
        }),
      }),
    );
  });

  it('applies skip/take once page and pageSize are both given', async () => {
    const { service, prisma } = buildService();
    (prisma.job.findMany as jest.Mock).mockResolvedValue([]);

    await service.list({ page: 3, pageSize: 20 });

    expect(prisma.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 40, take: 20 }),
    );
  });

  it('does not paginate at all when pageSize is omitted', async () => {
    const { service, prisma } = buildService();
    (prisma.job.findMany as jest.Mock).mockResolvedValue([]);

    await service.list({});

    const call = (prisma.job.findMany as jest.Mock).mock.calls[0][0];
    expect(call.skip).toBeUndefined();
    expect(call.take).toBeUndefined();
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
