import { AuditLogService } from '../audit/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../shared/email/email.service';
import { EmbeddingsService } from '../shared/embeddings/embeddings.service';
import { MatchingService } from './matching.service';

const JOB_NO_DEGREE_MENTION = 'Build cool things with modern tools.';

function buildService() {
  const prisma = {
    job: { findUnique: jest.fn() },
    candidateProfile: { findUnique: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([]),
    application: {
      upsert: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    matchResult: { create: jest.fn() },
    aIInterviewSession: { create: jest.fn().mockResolvedValue({}) },
    emailLog: { create: jest.fn().mockResolvedValue({}) },
  } as unknown as jest.Mocked<PrismaService>;
  const embeddings = {
    parseVectorLiteral: jest.fn().mockReturnValue(null),
  } as unknown as jest.Mocked<EmbeddingsService>;
  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<AuditLogService>;
  const email = {
    send: jest.fn().mockResolvedValue(true),
  } as unknown as jest.Mocked<EmailService>;

  return {
    service: new MatchingService(prisma, embeddings, audit, email),
    prisma,
    email,
  };
}

function mockJob(
  overrides: {
    title?: string;
    description?: string;
    experienceMin?: number;
    requiredSkills?: string[];
  } = {},
) {
  return {
    id: 'job-1',
    title: overrides.title ?? 'Backend Engineer',
    description: overrides.description ?? JOB_NO_DEGREE_MENTION,
    experienceMin: overrides.experienceMin ?? 0,
    jobSkills: (overrides.requiredSkills ?? ['TypeScript']).map((name) => ({
      required: true,
      skill: { name },
    })),
  };
}

function mockCandidate(
  overrides: {
    skills?: string[];
    experienceYears?: number;
    email?: string | null;
  } = {},
) {
  return {
    id: 'cand-1',
    cvStatus: 'READY',
    experienceYears: overrides.experienceYears ?? 3,
    resumePagesJson: [],
    extractedDataJson: {
      name: 'Jane Candidate',
      email:
        overrides.email === undefined ? 'jane@example.com' : overrides.email,
      skills: overrides.skills ?? ['TypeScript'],
      projects: [],
      education: [],
      certifications: [],
    },
  };
}

describe('MatchingService — screening decision gate', () => {
  it('invites to interview and emails INTERVIEW_ACKNOWLEDGEMENT when the score is >= 60', async () => {
    const { service, prisma, email } = buildService();
    (prisma.job.findUnique as jest.Mock).mockResolvedValue(mockJob());
    (prisma.candidateProfile.findUnique as jest.Mock).mockResolvedValue(
      mockCandidate(),
    );
    (prisma.application.upsert as jest.Mock).mockResolvedValue({
      id: 'app-1',
      status: 'APPLIED',
    });
    (prisma.matchResult.create as jest.Mock).mockResolvedValue({
      id: 'match-1',
      overallScore: 94,
      recommendation: 'STRONG_MATCH',
      confidence: 'HIGH',
      summary: 'x',
      modelVersion: 'matching-v1',
      processedAt: new Date(),
    });

    const outcome = await service.match('cand-1', 'job-1');

    expect(outcome.status).toBe('READY');
    expect(prisma.application.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'app-1' },
        data: expect.objectContaining({ status: 'INTERVIEW_PENDING' }),
      }),
    );
    expect(prisma.aIInterviewSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          applicationId: 'app-1',
          status: 'PENDING',
        }),
      }),
    );
    expect(email.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'jane@example.com',
        type: 'INTERVIEW_ACKNOWLEDGEMENT',
      }),
    );
    expect(prisma.emailLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'INTERVIEW_ACKNOWLEDGEMENT' }),
      }),
    );
  });

  it('screens out and emails SCREENING_REJECTION when the score is < 60', async () => {
    const { service, prisma, email } = buildService();
    (prisma.job.findUnique as jest.Mock).mockResolvedValue(
      mockJob({ requiredSkills: ['Kubernetes'], experienceMin: 5 }),
    );
    (prisma.candidateProfile.findUnique as jest.Mock).mockResolvedValue(
      mockCandidate({ skills: [], experienceYears: 0 }),
    );
    (prisma.application.upsert as jest.Mock).mockResolvedValue({
      id: 'app-1',
      status: 'APPLIED',
    });
    (prisma.matchResult.create as jest.Mock).mockResolvedValue({
      id: 'match-1',
      overallScore: 25,
      recommendation: 'INSUFFICIENT_EVIDENCE',
      confidence: 'LOW',
      summary: 'x',
      modelVersion: 'matching-v1',
      processedAt: new Date(),
    });

    await service.match('cand-1', 'job-1');

    expect(prisma.application.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'app-1' },
        data: { status: 'SCREENING_REJECTED' },
      }),
    );
    expect(prisma.aIInterviewSession.create).not.toHaveBeenCalled();
    expect(email.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'jane@example.com',
        type: 'SCREENING_REJECTION',
      }),
    );
  });

  it('does not re-decide (no duplicate email) when the application has already moved past APPLIED', async () => {
    const { service, prisma, email } = buildService();
    (prisma.job.findUnique as jest.Mock).mockResolvedValue(mockJob());
    (prisma.candidateProfile.findUnique as jest.Mock).mockResolvedValue(
      mockCandidate(),
    );
    (prisma.application.upsert as jest.Mock).mockResolvedValue({
      id: 'app-1',
      status: 'INTERVIEW_PENDING',
    });
    (prisma.matchResult.create as jest.Mock).mockResolvedValue({
      id: 'match-2',
      overallScore: 94,
      recommendation: 'STRONG_MATCH',
      confidence: 'HIGH',
      summary: 'x',
      modelVersion: 'matching-v1',
      processedAt: new Date(),
    });

    await service.match('cand-1', 'job-1');

    expect(email.send).not.toHaveBeenCalled();
    expect(prisma.aIInterviewSession.create).not.toHaveBeenCalled();
  });
});
