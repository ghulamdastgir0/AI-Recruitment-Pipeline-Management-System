/** Distinct skills probed with a fresh (non-follow-up) question. */
export const BASE_QUESTION_COUNT = 5;
/** Extra targeted follow-ups allowed across the whole session. */
export const MAX_FOLLOWUPS = 2;
export const MAX_TOTAL_QUESTIONS = BASE_QUESTION_COUNT + MAX_FOLLOWUPS;

/** Application.compositeScore = matchWeight*skillMatchPct + interviewWeight*interviewOverallScore. */
export const COMPOSITE_SCORE_WEIGHTS = {
  match: 0.5,
  interview: 0.5,
} as const;
