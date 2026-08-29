"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CandidateStatusBadge } from "@/components/StatusBadge";
import { LoadingState, ErrorState } from "@/components/AsyncState";
import { Timeline } from "@/components/Timeline";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { apiFetch, ApiError } from "@/lib/api";

const BASE_POLL_MS = 3000;
const MAX_POLL_MS = 30000;

// Statuses the application can no longer move on from. Deliberately does
// NOT include "an interview result exists" — the backend keeps moving the
// application through manager review to a final decision after the
// interview itself completes, and stopping polling as soon as `result` is
// present would leave a selected/rejected/next-round candidate stuck on a
// stale "in progress" message until they manually reload.
const TERMINAL_APPLICATION_STATUSES = new Set([
  "SCREENING_REJECTED",
  "INTERVIEW_EXPIRED",
  "SELECTED",
  "REJECTED",
  "NEXT_ROUND",
  "HIRED",
  "WITHDRAWN",
]);

function isTerminal(status: StatusView): boolean {
  return (
    status.terminal === true ||
    TERMINAL_APPLICATION_STATUSES.has(status.applicationStatus)
  );
}

/** Render a backend ISO date in the viewer's own locale/timezone. */
function formatDeadline(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

interface TurnView {
  questionId: string;
  sequenceOrder: number;
  questionText: string;
  questionAudioUrl: string;
}

interface StatusView {
  applicationStatus: string;
  candidateStatus: string;
  message: string;
  interviewDeadline?: string;
  currentQuestion?: TurnView;
  // Presence alone marks "interview complete" — deliberately no score/skills
  // here, candidates only ever see a plain confirmation message.
  result?: { status: "COMPLETED"; message: string };
  terminal?: boolean;
}

export default function StatusPage() {
  const { applicationId } = useParams<{ applicationId: string }>();
  const router = useRouter();
  const [status, setStatus] = useState<StatusView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;
    let delay = BASE_POLL_MS;

    async function tick() {
      try {
        const data = await apiFetch<StatusView>(
          `/interview-sessions/${applicationId}/status`,
        );
        if (cancelled) return;
        setStatus(data);
        setError(null);
        delay = BASE_POLL_MS;
        if (isTerminal(data)) return; // nothing left to change — stop polling
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Failed to load status.");
        // Back off (e.g. after a 429) instead of hammering at a fixed rate.
        delay = Math.min(delay * 2, MAX_POLL_MS);
      }
      timeoutId = setTimeout(() => void tick(), delay);
    }

    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [applicationId]);

  if (error) {
    return (
      <main className="mx-auto w-full max-w-lg p-6">
        <ErrorState message={error} />
      </main>
    );
  }
  if (!status) {
    return (
      <main className="mx-auto w-full max-w-lg p-6">
        <LoadingState />
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg items-center p-6">
      <Card className="w-full">
        <h1 className="font-heading text-xl font-semibold text-text-primary">
          Application Status
        </h1>
        <div className="mt-3">
          <CandidateStatusBadge status={status.candidateStatus} />
        </div>

        <div className="mt-6">
          <Timeline status={status.applicationStatus} />
        </div>

        <p className="mt-6 text-sm text-text-secondary">{status.message}</p>
        {status.interviewDeadline && (
          <p className="mt-2 text-sm font-medium text-text-primary">
            Interview deadline: {formatDeadline(status.interviewDeadline)}
          </p>
        )}
        {status.applicationStatus === "APPLIED" && (
          <p className="mt-2 text-xs text-text-muted">
            This page updates automatically — no need to refresh.
          </p>
        )}

        {(status.applicationStatus === "INTERVIEW_PENDING" || status.currentQuestion) && (
          <Button
            onClick={() => router.push(`/interview/${applicationId}`)}
            className="mt-6"
          >
            {status.currentQuestion ? "Resume Interview" : "Start Interview"}
          </Button>
        )}
      </Card>
    </main>
  );
}
