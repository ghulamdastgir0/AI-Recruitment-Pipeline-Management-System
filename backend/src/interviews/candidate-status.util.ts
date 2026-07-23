export type CandidateStatus =
  | 'APPLICATION_RECEIVED'
  | 'UNDER_REVIEW'
  | 'INTERVIEW_PENDING'
  | 'INTERVIEW_COMPLETED'
  | 'FINAL_REVIEW'
  | 'ACCEPTED'
  | 'REJECTED';

const MAP: Record<string, CandidateStatus> = {
  APPLIED: 'APPLICATION_RECEIVED',
  SCREENING: 'UNDER_REVIEW',
  SCREENING_REJECTED: 'REJECTED',
  INTERVIEW_PENDING: 'INTERVIEW_PENDING',
  INTERVIEW_EXPIRED: 'REJECTED',
  IN_REVIEW: 'INTERVIEW_COMPLETED',
  MANAGER_REVIEW: 'FINAL_REVIEW',
  NEXT_ROUND: 'INTERVIEW_PENDING',
  SELECTED: 'ACCEPTED',
  HIRED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  WITHDRAWN: 'REJECTED',
};

/**
 * Collapses the full internal AppStatus set into the closed 7-value
 * candidate-facing vocabulary. Candidates never see internal stage names
 * (SCREENING, MANAGER_REVIEW, etc.) or a score — just this badge plus the
 * existing situational free-text message.
 */
export function toCandidateStatus(appStatus: string): CandidateStatus {
  return MAP[appStatus] ?? 'UNDER_REVIEW';
}
