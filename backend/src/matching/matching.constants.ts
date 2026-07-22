/**
 * Gate for auto-inviting a candidate to the AI technical interview once a
 * MatchResult is computed. Deliberately a separate constant from
 * RECOMMENDATION_THRESHOLDS.POTENTIAL_MATCH (65, scoring.ts) — that band
 * classifies match quality for HR's benefit; this threshold decides whether
 * the candidate proceeds automatically, a distinct business decision.
 */
export const INTERVIEW_SCORE_THRESHOLD = 60;

/** FR-INT-01: window to complete the automated interview once invited. */
export const INTERVIEW_WINDOW_HOURS = 48;
