import { AuditLogService } from '../audit/audit-log.service';
import { DocumentRetrievalService } from '../documents/services/document-retrieval.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingsService } from '../shared/embeddings/embeddings.service';
import { LlmClientService } from '../shared/llm/llm-client.service';
import { JobPostingsService } from './job-postings.service';

function jobRow(overrides: Partial<{ id: string }> = {}) {
  return {
    id: overrides.id ?? 'job-1',
    title: 'Software Engineer Intern',
    description: 'desc',
    status: 'DRAFT',
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

function buildService() {
  const prisma = {
    job: {
      findUnique: jest.fn().mockResolvedValue(jobRow()),
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
  } as unknown as jest.Mocked<PrismaService>;

  const embeddings = {} as unknown as jest.Mocked<EmbeddingsService>;
  const llm = {} as unknown as jest.Mocked<LlmClientService>;
  const documentRetrieval =
    {} as unknown as jest.Mocked<DocumentRetrievalService>;
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
