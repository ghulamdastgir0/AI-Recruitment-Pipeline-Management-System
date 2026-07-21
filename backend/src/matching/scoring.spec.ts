import { computeMatch, JobMatchInput, CandidateMatchInput } from './scoring';

function job(overrides: Partial<JobMatchInput> = {}): JobMatchInput {
  return {
    title: 'Senior Backend Engineer',
    description:
      'Build backend services with NestJS and PostgreSQL. A degree in Computer Science is preferred.',
    embedding: null,
    requiredSkills: ['NestJS', 'PostgreSQL', 'Redis'],
    preferredSkills: ['Docker'],
    experienceMin: 4,
    ...overrides,
  };
}

function candidate(
  overrides: Partial<CandidateMatchInput> = {},
): CandidateMatchInput {
  return {
    skills: ['NestJS', 'TypeScript', 'PostgreSQL', 'Prisma'],
    experienceYears: 5,
    embedding: null,
    projects: [
      {
        name: 'Internal API gateway',
        description: 'Built with NestJS and Docker',
      },
    ],
    education: [
      {
        institution: 'FAST NUCES',
        degree: 'Bachelor of Science',
        field: 'Computer Science',
      },
    ],
    certifications: [],
    resumePages: [
      {
        pageNumber: 2,
        text: 'Experience with NestJS and PostgreSQL at Acme Corp.',
      },
    ],
    ...overrides,
  };
}

describe('computeMatch', () => {
  it('scores required skills as the matched fraction and lists the missing ones', () => {
    const result = computeMatch(job(), candidate());

    expect(result.breakdown.requiredSkills).toBeCloseTo((2 / 3) * 100, 1); // NestJS + PostgreSQL matched, Redis missing
    expect(result.matchedSkills).toEqual(
      expect.arrayContaining(['NestJS', 'PostgreSQL']),
    );
    expect(result.missingRequiredSkills).toEqual(['Redis']);
  });

  it('gives full required-skill credit when the posting has no required skills', () => {
    const result = computeMatch(job({ requiredSkills: [] }), candidate());
    expect(result.breakdown.requiredSkills).toBe(100);
    expect(result.missingRequiredSkills).toEqual([]);
  });

  it('cites a resume page for a matched skill when the term appears in resumePages', () => {
    const result = computeMatch(job(), candidate());
    const nestjsEvidence = result.evidence.find(
      (e) => e.criterion === 'NestJS',
    );
    expect(nestjsEvidence?.result).toBe('MATCHED');
    expect(nestjsEvidence?.source).toBe('CV page 2');
  });

  it('falls back to a generic "CV" source when the term is not found in any resume page', () => {
    const result = computeMatch(job(), candidate({ resumePages: [] }));
    const nestjsEvidence = result.evidence.find(
      (e) => e.criterion === 'NestJS',
    );
    expect(nestjsEvidence?.source).toBe('CV');
  });

  it('rewards experience proportionally when below the required minimum', () => {
    const result = computeMatch(
      job({ experienceMin: 10 }),
      candidate({ experienceYears: 5, embedding: null }),
    );
    expect(result.breakdown.relevantExperience).toBeCloseTo(50, 1);
  });

  it('does not penalize education/certifications when the posting states no such requirement', () => {
    const result = computeMatch(
      job({ description: 'Build backend services with NestJS.' }),
      candidate({ education: [], certifications: [] }),
    );
    expect(result.breakdown.education).toBe(100);
  });

  it('penalizes missing education/certifications when the posting does state a requirement', () => {
    const result = computeMatch(
      job(),
      candidate({ education: [], certifications: [] }),
    );
    expect(result.breakdown.education).toBeLessThan(100);
  });

  it('bands the overall score into the correct recommendation', () => {
    const strong = computeMatch(
      job({
        requiredSkills: ['NestJS'],
        preferredSkills: [],
        experienceMin: 1,
      }),
      candidate({ skills: ['NestJS'], experienceYears: 5 }),
    );
    expect(strong.overallScore).toBeGreaterThanOrEqual(85);
    expect(strong.recommendation).toBe('STRONG_MATCH');

    const insufficient = computeMatch(
      job({
        requiredSkills: ['Go', 'Kubernetes', 'gRPC'],
        preferredSkills: [],
        experienceMin: 10,
      }),
      candidate({
        skills: [],
        experienceYears: 0,
        projects: [],
        education: [],
        certifications: [],
      }),
    );
    expect(insufficient.recommendation).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('reports LOW confidence when the candidate profile has no substantive extracted data', () => {
    const result = computeMatch(
      job(),
      candidate({
        skills: [],
        projects: [],
        education: [],
        certifications: [],
      }),
    );
    expect(result.confidence).toBe('LOW');
  });

  it('is deterministic for identical inputs', () => {
    const a = computeMatch(job(), candidate());
    const b = computeMatch(job(), candidate());
    expect(a).toEqual(b);
  });
});
