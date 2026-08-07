const STAGES = [
  "Applied",
  "Under Review",
  "Interview Pending",
  "Interview Completed",
  "Manager Review",
  "Final Decision",
];

// Maps every internal AppStatus onto one of the 6 timeline stages above.
const STAGE_INDEX: Record<string, number> = {
  APPLIED: 0,
  SCREENING: 1,
  SCREENING_REJECTED: 1,
  INTERVIEW_PENDING: 2,
  INTERVIEW_EXPIRED: 2,
  IN_REVIEW: 3,
  MANAGER_REVIEW: 4,
  // Manager review is done and the process has moved into the Final
  // Decision phase (awaiting HR) — same stage bucket as the terminal
  // decisions below, but not itself in TERMINAL_STATUSES, so it renders as
  // the current in-progress stage rather than a completed/rejected marker.
  MANAGER_REVIEWED: 5,
  SELECTED: 5,
  NEXT_ROUND: 5,
  HIRED: 5,
  REJECTED: 5,
  WITHDRAWN: 0,
};

const TERMINAL_STATUSES = new Set([
  "SCREENING_REJECTED",
  "INTERVIEW_EXPIRED",
  "REJECTED",
  "WITHDRAWN",
]);

export function Timeline({ status }: { status: string }) {
  const currentIndex = STAGE_INDEX[status] ?? 0;
  const isTerminal = TERMINAL_STATUSES.has(status);

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-0">
      {STAGES.map((label, index) => {
        const isPast = index < currentIndex;
        const isCurrent = index === currentIndex;
        const isSkipped = isTerminal && index > currentIndex;
        const isTerminalMarker = isTerminal && isCurrent;

        const dotClass = isTerminalMarker
          ? "bg-danger"
          : isCurrent
            ? "bg-brand-600"
            : isPast
              ? "bg-success"
              : "bg-black/15";

        const textClass = isSkipped
          ? "text-text-muted/60"
          : isCurrent
            ? "font-medium text-text-primary"
            : isPast
              ? "text-text-secondary"
              : "text-text-muted";

        return (
          <div
            key={label}
            className="flex items-center gap-2 sm:flex-1 sm:flex-col sm:items-stretch sm:gap-1"
          >
            {/* Dot and connector line share one row (at the dot's vertical
                center) — the label goes below, as its own block, so it never
                pushes the connector out of line with the dots. */}
            <div className="flex items-center sm:w-full">
              <span
                className={`h-3 w-3 shrink-0 rounded-full ${dotClass}`}
                aria-hidden
              />
              {index < STAGES.length - 1 && (
                <span
                  className={`hidden h-px flex-1 sm:block ${
                    isPast ? "bg-success" : "bg-border"
                  }`}
                  aria-hidden
                />
              )}
            </div>
            <span className={`text-xs ${textClass}`}>{label}</span>
          </div>
        );
      })}
    </div>
  );
}
