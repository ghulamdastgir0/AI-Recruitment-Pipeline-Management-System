// Two separate vocabularies share one pill component: candidates only ever
// see the closed 7-value set, staff see the full internal AppStatus set
// (including MANAGER_REVIEW). Keeping them as separate maps (rather than
// one combined map) keeps each one legible and stops internal stage names
// from ever accidentally leaking into a candidate-facing label.

const CANDIDATE_STATUS_STYLES: Record<string, string> = {
  APPLICATION_RECEIVED: "bg-gray-100 text-gray-700",
  UNDER_REVIEW: "bg-blue-100 text-blue-700",
  INTERVIEW_PENDING: "bg-amber-100 text-amber-700",
  INTERVIEW_COMPLETED: "bg-purple-100 text-purple-700",
  FINAL_REVIEW: "bg-indigo-100 text-indigo-700",
  ACCEPTED: "bg-green-100 text-green-700",
  REJECTED: "bg-red-100 text-red-700",
};

const INTERNAL_STATUS_STYLES: Record<string, string> = {
  APPLIED: "bg-gray-100 text-gray-700",
  SCREENING: "bg-blue-100 text-blue-700",
  SCREENING_REJECTED: "bg-red-100 text-red-700",
  INTERVIEW_PENDING: "bg-amber-100 text-amber-700",
  INTERVIEW_EXPIRED: "bg-red-100 text-red-700",
  IN_REVIEW: "bg-purple-100 text-purple-700",
  MANAGER_REVIEW: "bg-indigo-100 text-indigo-700",
  NEXT_ROUND: "bg-amber-100 text-amber-700",
  SELECTED: "bg-green-100 text-green-700",
  HIRED: "bg-green-100 text-green-700",
  REJECTED: "bg-red-100 text-red-700",
  WITHDRAWN: "bg-gray-100 text-gray-500",
};

const DEFAULT_STYLE = "bg-gray-100 text-gray-700";

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
