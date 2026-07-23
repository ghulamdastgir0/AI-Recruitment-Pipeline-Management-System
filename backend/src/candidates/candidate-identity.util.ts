import type { ExtractedCvProfileDto } from './dto/extracted-cv-profile.dto';

export interface CandidateIdentity {
  name: string | null;
  email: string | null;
  phone: string | null;
}

interface CandidateIdentitySource {
  candidateName: string | null;
  candidateEmail: string | null;
  candidatePhone: string | null;
  extractedDataJson: unknown;
}

/**
 * Candidate-supplied contact fields (typed directly on the apply form) are
 * the source of truth. Falls back to the LLM-extracted CV data only for
 * legacy rows and HR-sourced uploads that never collected them directly —
 * that extraction has previously hallucinated wrong values in this codebase,
 * so it's a fallback, never the primary source.
 */
export function resolveCandidateIdentity(
  profile: CandidateIdentitySource,
): CandidateIdentity {
  const extracted = profile.extractedDataJson as ExtractedCvProfileDto | null;
  return {
    name: profile.candidateName ?? extracted?.name ?? null,
    email: profile.candidateEmail ?? extracted?.email ?? null,
    phone: profile.candidatePhone ?? extracted?.phone ?? null,
  };
}
