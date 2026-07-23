"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";

const BASE_POLL_MS = 3000;
const MAX_POLL_MS = 30000;

function isTerminal(status: StatusView): boolean {
  return (
    status.terminal === true ||
    status.applicationStatus === "SCREENING_REJECTED" ||
    status.applicationStatus === "INTERVIEW_EXPIRED" ||
    Boolean(status.result)
  );
}

interface TurnView {
  questionId: string;
  sequenceOrder: number;
  questionText: string;
  questionAudioUrl: string;
}

interface StatusView {
  applicationStatus: string;
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
      <main className="mx-auto w-full max-w-2xl p-6">
        <p className="text-red-600">{error}</p>
      </main>
    );
  }
  if (!status) {
    return (
      <main className="mx-auto w-full max-w-2xl p-6">
        <p className="text-gray-500">Loading…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl p-6">
      <h1 className="text-2xl font-bold">Application Status</h1>
      <p className="mt-2 text-sm text-gray-500">Status: {status.applicationStatus}</p>
      <p className="mt-4">{status.message}</p>
      {status.applicationStatus === "APPLIED" && (
        <p className="mt-2 text-sm text-gray-400">
          This page updates automatically — no need to refresh.
        </p>
      )}

      {(status.applicationStatus === "INTERVIEW_PENDING" || status.currentQuestion) && (
        <button
          onClick={() => router.push(`/interview/${applicationId}`)}
          className="mt-4 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          {status.currentQuestion ? "Resume Interview" : "Start Interview"}
        </button>
      )}

    </main>
  );
}
