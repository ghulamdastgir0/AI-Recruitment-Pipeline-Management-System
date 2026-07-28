export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export const MAX_INTERVIEW_WARNINGS = 5;

/** 0 → Low, 1-2 → Medium, 3-4 → High, 5+ → Critical. */
export function riskLevelFor(total: number): RiskLevel {
  if (total <= 0) return 'LOW';
  if (total <= 2) return 'MEDIUM';
  if (total <= 4) return 'HIGH';
  return 'CRITICAL';
}
