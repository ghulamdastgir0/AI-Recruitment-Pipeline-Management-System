const REJECTED_STATUSES = new Set(["SCREENING_REJECTED", "REJECTED"]);

export function isRejectedStatus(status: string): boolean {
  return REJECTED_STATUSES.has(status);
}

export interface RejectionInfo {
  overallScore: number | null;
  summary: string;
  missingRequiredSkills: string[];
  /**
   * Set only if the AI interview was auto-submitted early by the proctoring
   * system (5-warning cap or a browser-close ping) rather than completed
   * naturally. When present, this — not the CV-match summary below — is the
   * actual reason the candidate was rejected: they may well have scored a
   * strong CV match and still been rejected directly for an interview
   * integrity violation (see the "Reject Directly" flow on the candidate
   * page). Showing the match summary alone in that case reads as "rejected
   * for missing skills," which is misleading.
   */
  interviewTerminationReason?: string | null;
}

const TERMINATION_REASON_TEXT: Record<string, string> = {
  AUTO_SUBMITTED_VIOLATIONS:
    "the candidate exceeded the maximum allowed proctoring warnings during the AI interview (face/phone detection, tab-switching, or fullscreen exits).",
  AUTO_SUBMITTED_BROWSER_CLOSED:
    "the candidate's browser or tab was closed before the AI interview finished.",
};

/**
 * HR/Admin-only "why this candidate was rejected" callout — score, plain
 * explanation, and missing required skills. Only ever rendered from pages
 * under /staff/* (RoleGuard-protected); never shown to candidates.
 */
export function RejectionDetails({ info }: { info: RejectionInfo }) {
  const violationReason = info.interviewTerminationReason
    ? TERMINATION_REASON_TEXT[info.interviewTerminationReason]
    : null;

  return (
    <div className="mt-2 rounded-[var(--radius-control)] border border-danger/25 bg-danger-soft p-4">
      <p className="text-sm font-semibold text-danger-text">
        Why this candidate was rejected
      </p>
      {violationReason ? (
        <>
          <p className="mt-1 text-sm text-danger-text">
            Rejected directly due to an interview proctoring violation —{" "}
            {violationReason}
          </p>
          <p className="mt-2 text-xs text-danger-text/80">
            This bypassed manager review; it is not based on CV match. For
            reference, the CV match score was{" "}
            {info.overallScore !== null ? `${info.overallScore}/100` : "not available"}.
          </p>
        </>
      ) : (
        <>
          {info.overallScore !== null && (
            <p className="mt-1 text-sm text-danger-text">
              Match score: {info.overallScore}/100
            </p>
          )}
          <p className="mt-1 text-sm text-danger-text">{info.summary}</p>
          {info.missingRequiredSkills.length > 0 && (
            <p className="mt-1 text-sm text-danger-text">
              Missing required skills: {info.missingRequiredSkills.join(", ")}
            </p>
          )}
        </>
      )}
    </div>
  );
}
