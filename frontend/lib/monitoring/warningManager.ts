import { postJson } from "@/lib/api";
import {
  LogViolationResult,
  MAX_INTERVIEW_WARNINGS,
  VIOLATION_MESSAGES,
  ViolationSummary,
  ViolationType,
} from "./violationTypes";

/**
 * Thin reporting layer over POST /interview-sessions/:id/violations — tracks
 * the running total locally (so the UI badge doesn't need a round trip to
 * render) and surfaces a formatted toast message + forced-submission flag
 * per report. Debounce/cooldown logic for *when* to call report() lives in
 * the calling detection loops (useInterviewMonitoring), since each rule's
 * timing semantics differ (continuous absence vs. instant event).
 */
export class WarningManager {
  private summary: ViolationSummary = { counts: {}, total: 0, riskLevel: "LOW" };

  constructor(private readonly applicationId: string) {}

  hydrate(summary: ViolationSummary): void {
    this.summary = summary;
  }

  get total(): number {
    return this.summary.total;
  }

  /** Reports one violation. Returns the toast message + forced flag, or null if the report failed (best-effort — never blocks the interview). */
  async report(
    type: ViolationType,
    metadata?: Record<string, unknown>,
  ): Promise<{ message: string; forced: boolean } | null> {
    let result: LogViolationResult;
    try {
      result = await postJson<LogViolationResult>(
        `/interview-sessions/${this.applicationId}/violations`,
        { type, metadata },
      );
    } catch {
      return null;
    }
    this.summary = result;
    return {
      message: `Warning ${result.total}/${MAX_INTERVIEW_WARNINGS}: ${VIOLATION_MESSAGES[type]}`,
      forced: result.forced,
    };
  }
}
