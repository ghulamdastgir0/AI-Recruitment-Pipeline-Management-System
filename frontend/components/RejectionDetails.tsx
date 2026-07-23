const REJECTED_STATUSES = new Set(["SCREENING_REJECTED", "REJECTED"]);

export function isRejectedStatus(status: string): boolean {
  return REJECTED_STATUSES.has(status);
}

export interface RejectionInfo {
  overallScore: number | null;
  summary: string;
  missingRequiredSkills: string[];
}

/**
 * HR/Admin-only "why this candidate was rejected" callout — score, plain
 * explanation, and missing required skills. Only ever rendered from pages
 * under /staff/* (RoleGuard-protected); never shown to candidates.
 */
export function RejectionDetails({ info }: { info: RejectionInfo }) {
  return (
    <div className="mt-2 rounded-[var(--radius-control)] border border-danger/25 bg-danger-soft p-4">
      <p className="text-sm font-semibold text-danger-text">
        Why this candidate was rejected
      </p>
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
    </div>
  );
}
