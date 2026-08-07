// Two separate vocabularies share one pill component: candidates only ever
// see the closed 7-value set, staff see the full internal AppStatus set
// (including MANAGER_REVIEW) plus JobStatus (no name collisions between the
// two). Keeping candidate/internal as separate maps keeps each one legible
// and stops internal stage names from ever accidentally leaking into a
// candidate-facing label.

const CANDIDATE_STATUS_STYLES: Record<string, string> = {
  APPLICATION_RECEIVED: "bg-surface-muted text-text-secondary",
  UNDER_REVIEW: "bg-info-soft text-info-text",
  INTERVIEW_PENDING: "bg-warning-soft text-warning-text",
  INTERVIEW_COMPLETED: "bg-info-soft text-info-text",
  FINAL_REVIEW: "bg-info-soft text-info-text",
  ACCEPTED: "bg-success-soft text-success-text",
  REJECTED: "bg-danger-soft text-danger-text",
  WITHDRAWN: "bg-surface-muted text-text-muted",
};

const INTERNAL_STATUS_STYLES: Record<string, string> = {
  // Application pipeline
  APPLIED: "bg-surface-muted text-text-secondary",
  SCREENING: "bg-info-soft text-info-text",
  SCREENING_REJECTED: "bg-danger-soft text-danger-text",
  INTERVIEW_PENDING: "bg-warning-soft text-warning-text",
  INTERVIEW_EXPIRED: "bg-danger-soft text-danger-text",
  IN_REVIEW: "bg-info-soft text-info-text",
  MANAGER_REVIEW: "bg-info-soft text-info-text",
  MANAGER_REVIEWED: "bg-info-soft text-info-text",
  NEXT_ROUND: "bg-warning-soft text-warning-text",
  SELECTED: "bg-success-soft text-success-text",
  HIRED: "bg-success-soft text-success-text",
  REJECTED: "bg-danger-soft text-danger-text",
  WITHDRAWN: "bg-surface-muted text-text-muted",
  // Job postings
  DRAFT: "bg-surface-muted text-text-secondary",
  PUBLISHED: "bg-success-soft text-success-text",
  PAUSED: "bg-warning-soft text-warning-text",
  CLOSED: "bg-surface-muted text-text-muted",
  ARCHIVED: "bg-surface-muted text-text-muted",
};

const DOCUMENT_STATUS_STYLES: Record<string, string> = {
  PROCESSING: "bg-warning-soft text-warning-text",
  ACTIVE: "bg-success-soft text-success-text",
  INACTIVE: "bg-surface-muted text-text-muted",
  FAILED: "bg-danger-soft text-danger-text",
};

const DEFAULT_STYLE = "bg-surface-muted text-text-secondary";

function Badge({ label, className }: { label: string; className: string }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${className}`}
    >
      {label.replaceAll("_", " ")}
    </span>
  );
}

export function CandidateStatusBadge({ status }: { status: string }) {
  return (
    <Badge
      label={status}
      className={CANDIDATE_STATUS_STYLES[status] ?? DEFAULT_STYLE}
    />
  );
}

export function InternalStatusBadge({ status }: { status: string }) {
  return (
    <Badge
      label={status}
      className={INTERNAL_STATUS_STYLES[status] ?? DEFAULT_STYLE}
    />
  );
}

export function DocumentStatusBadge({ status }: { status: string }) {
  return (
    <Badge
      label={status}
      className={DOCUMENT_STATUS_STYLES[status] ?? DEFAULT_STYLE}
    />
  );
}
