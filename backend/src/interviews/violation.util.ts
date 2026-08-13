export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

// Loosened from 5 — real usage showed candidates hitting the cap from
// ordinary behavior (a couple of tab/window blurs, a stretch of looking
// away) well before anything resembling actual cheating. Still a real cap,
// just one with enough headroom to absorb normal interview jitter.
export const MAX_INTERVIEW_WARNINGS = 8;

/** 0 → Low, 1-2 → Medium, 3-4 → High, 5+ → Critical. */
export function riskLevelFor(total: number): RiskLevel {
  if (total <= 0) return 'LOW';
  if (total <= 2) return 'MEDIUM';
  if (total <= 4) return 'HIGH';
  return 'CRITICAL';
}
