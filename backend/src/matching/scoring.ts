// Pure, deterministic scoring logic — no DB/LLM access, so it's directly
// unit-testable against fixture data. matching.service.ts is the thin
// wrapper that loads a Job + CandidateProfile and calls computeMatch().

export const SCORE_WEIGHTS = {
  requiredSkills: 40,
  preferredSkills: 15,
  relevantExperience: 25,
  projects: 10,
  education: 10,
} as const;

export const RECOMMENDATION_THRESHOLDS = {
  STRONG_MATCH: 85,
  POTENTIAL_MATCH: 65,
  NEEDS_REVIEW: 45,
} as const;

export type EvidenceResult = 'MATCHED' | 'PARTIAL' | 'MISSING';
export type Recommendation =
  'STRONG_MATCH' | 'POTENTIAL_MATCH' | 'NEEDS_REVIEW' | 'INSUFFICIENT_EVIDENCE';
export type Confidence = 'LOW' | 'MEDIUM' | 'HIGH';

export interface EvidenceEntry {
  criterion: string;
  result: EvidenceResult;
  source: string;
}

export interface ResumePage {
  pageNumber: number;
  text: string;
}

export interface JobMatchInput {
  title: string;
  description: string;
  embedding: number[] | null;
  requiredSkills: string[];
  preferredSkills: string[];
  experienceMin: number;
}

export interface CandidateMatchInput {
  skills: string[];
  experienceYears: number;
  embedding: number[] | null;
  projects: { name: string; description?: string | null }[];
  education: {
    institution: string;
    degree?: string | null;
    field?: string | null;
  }[];
  certifications: string[];
  resumePages: ResumePage[];
}

export interface MatchComputation {
  overallScore: number;
  breakdown: Record<keyof typeof SCORE_WEIGHTS, number>;
  matchedSkills: string[];
  missingRequiredSkills: string[];
  evidence: EvidenceEntry[];
  recommendation: Recommendation;
  confidence: Confidence;
  summary: string;
}

function normalize(term: string): string {
  return term.trim().toLowerCase();
}

function skillMatches(skill: string, candidateSkills: string[]): boolean {
  const normalizedSkill = normalize(skill);
  return candidateSkills.some((candidateSkill) => {
    const normalizedCandidate = normalize(candidateSkill);
    return (
      normalizedCandidate === normalizedSkill ||
      normalizedCandidate.includes(normalizedSkill) ||
      normalizedSkill.includes(normalizedCandidate)
    );
  });
}

function findPageSource(term: string, pages: ResumePage[]): string {
  const normalizedTerm = normalize(term);
  const page = pages.find((p) => p.text.toLowerCase().includes(normalizedTerm));
  return page ? `CV page ${page.pageNumber}` : 'CV';
}

function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function scoreSkillBucket(
  jobSkills: string[],
  candidateSkills: string[],
): { score: number; matched: string[]; missing: string[] } {
  if (jobSkills.length === 0) {
    return { score: 100, matched: [], missing: [] };
  }
  const matched = jobSkills.filter((skill) =>
    skillMatches(skill, candidateSkills),
  );
  const missing = jobSkills.filter((skill) => !matched.includes(skill));
  return { score: (matched.length / jobSkills.length) * 100, matched, missing };
}

function scoreExperience(
  job: JobMatchInput,
  candidate: CandidateMatchInput,
): number {
  const yearsScore =
    job.experienceMin <= 0
      ? 100
      : Math.min(100, (candidate.experienceYears / job.experienceMin) * 100);

  if (!job.embedding || !candidate.embedding) {
    return yearsScore;
  }

  const semanticScore =
    Math.max(0, cosineSimilarity(job.embedding, candidate.embedding)) * 100;
  return 0.6 * semanticScore + 0.4 * yearsScore;
}

function scoreProjects(
  job: JobMatchInput,
  candidate: CandidateMatchInput,
): { score: number; matchedTerms: string[] } {
  const keywordPool = Array.from(
    new Set([...job.requiredSkills, ...job.preferredSkills].map(normalize)),
  );
  const projectText = normalize(
    [
      ...candidate.projects.map((p) => `${p.name} ${p.description ?? ''}`),
      ...candidate.certifications,
    ].join(' '),
  );

  if (keywordPool.length === 0) {
    const hasEvidence =
      candidate.projects.length > 0 || candidate.certifications.length > 0;
    return { score: hasEvidence ? 70 : 40, matchedTerms: [] };
  }

  const matchedTerms = keywordPool.filter((term) => projectText.includes(term));
  return {
    score: (matchedTerms.length / keywordPool.length) * 100,
    matchedTerms,
  };
}

function jobStatesEducationRequirement(job: JobMatchInput): boolean {
  const text = normalize(job.description);
  return [
    'degree',
    'bachelor',
    'master',
    'phd',
    'certification',
    'certified',
  ].some((kw) => text.includes(kw));
}

function scoreEducation(
  job: JobMatchInput,
  candidate: CandidateMatchInput,
): number {
  if (!jobStatesEducationRequirement(job)) return 100;

  const hasEducation = candidate.education.length > 0;
  const hasCertification = candidate.certifications.length > 0;
  if (!hasEducation && !hasCertification) return 30;

  const educationText = normalize(
    [
      ...candidate.education.map((e) => `${e.degree ?? ''} ${e.field ?? ''}`),
      ...candidate.certifications,
    ].join(' '),
  );
  const jobText = normalize(job.description);
  const specificMatch = ['bachelor', 'master', 'phd', 'certified'].some(
    (kw) => jobText.includes(kw) && educationText.includes(kw),
  );

  return specificMatch ? 100 : 70;
}

function bandRecommendation(score: number): Recommendation {
  if (score >= RECOMMENDATION_THRESHOLDS.STRONG_MATCH) return 'STRONG_MATCH';
  if (score >= RECOMMENDATION_THRESHOLDS.POTENTIAL_MATCH)
    return 'POTENTIAL_MATCH';
  if (score >= RECOMMENDATION_THRESHOLDS.NEEDS_REVIEW) return 'NEEDS_REVIEW';
  return 'INSUFFICIENT_EVIDENCE';
}

function buildSummary(
  job: JobMatchInput,
  matchedRequired: string[],
  missingRequired: string[],
  matchedPreferred: string[],
): string {
  const strengths = [...matchedRequired, ...matchedPreferred].slice(0, 4);
  const strengthsText =
    strengths.length > 0
      ? `strong ${strengths.join(', ')} experience`
      : 'limited documented overlap with the role';
  const gapText =
    missingRequired.length > 0
      ? `, but ${missingRequired.join(', ')} experience is not documented.`
      : '.';
  return `The candidate has ${strengthsText} for the ${job.title} role${gapText}`;
}

export function computeMatch(
  job: JobMatchInput,
  candidate: CandidateMatchInput,
): MatchComputation {
  const required = scoreSkillBucket(job.requiredSkills, candidate.skills);
  const preferred = scoreSkillBucket(job.preferredSkills, candidate.skills);
  const experienceScore = scoreExperience(job, candidate);
  const { score: projectsScore } = scoreProjects(job, candidate);
  const educationScore = scoreEducation(job, candidate);

  const breakdown = {
    requiredSkills: round(required.score),
    preferredSkills: round(preferred.score),
    relevantExperience: round(experienceScore),
    projects: round(projectsScore),
    education: round(educationScore),
  };

  const overallScore = round(
    (breakdown.requiredSkills * SCORE_WEIGHTS.requiredSkills +
      breakdown.preferredSkills * SCORE_WEIGHTS.preferredSkills +
      breakdown.relevantExperience * SCORE_WEIGHTS.relevantExperience +
      breakdown.projects * SCORE_WEIGHTS.projects +
      breakdown.education * SCORE_WEIGHTS.education) /
      100,
  );

  const evidence: EvidenceEntry[] = [
    ...required.matched.map((skill) => ({
      criterion: skill,
      result: 'MATCHED' as const,
      source: findPageSource(skill, candidate.resumePages),
    })),
    ...required.missing.map((skill) => ({
      criterion: skill,
      result: 'MISSING' as const,
      source: 'CV',
    })),
    ...preferred.matched.map((skill) => ({
      criterion: skill,
      result: 'MATCHED' as const,
      source: findPageSource(skill, candidate.resumePages),
    })),
    {
      criterion: 'Relevant experience',
      result:
        experienceScore >= 60
          ? 'MATCHED'
          : experienceScore >= 30
            ? 'PARTIAL'
            : 'MISSING',
      source:
        candidate.experienceYears > 0
          ? `CV (${candidate.experienceYears} yrs)`
          : 'CV',
    },
    {
      criterion: 'Education / certifications',
      result:
        educationScore >= 90
          ? 'MATCHED'
          : educationScore >= 60
            ? 'PARTIAL'
            : 'MISSING',
      source: 'CV',
    },
  ];

  const definitiveCount = evidence.filter((e) => e.result !== 'PARTIAL').length;
  const hasSubstantiveProfile =
    candidate.skills.length > 0 ||
    candidate.projects.length > 0 ||
    candidate.education.length > 0;
  const confidence: Confidence = !hasSubstantiveProfile
    ? 'LOW'
    : definitiveCount / evidence.length >= 0.75 && candidate.skills.length >= 3
      ? 'HIGH'
      : 'MEDIUM';

  return {
    overallScore,
    breakdown,
    matchedSkills: [...required.matched, ...preferred.matched],
    missingRequiredSkills: required.missing,
    evidence,
    recommendation: bandRecommendation(overallScore),
    confidence,
    summary: buildSummary(
      job,
      required.matched,
      required.missing,
      preferred.matched,
    ),
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
