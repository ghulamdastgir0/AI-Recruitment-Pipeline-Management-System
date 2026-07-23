"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";

interface PublicJob {
  id: string;
  title: string;
  location?: string | null;
  seniority?: string | null;
  workModel?: string | null;
  requiredSkills: string[];
}

export default function HomePage() {
  const [jobs, setJobs] = useState<PublicJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<PublicJob[]>("/jobs")
      .then(setJobs)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Failed to load jobs."),
      );
  }, []);

  return (
    <main className="mx-auto w-full max-w-3xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Open Positions</h1>
        <Link href="/login" className="text-sm text-blue-600 underline">
          Staff login
        </Link>
      </div>

      {error && <p className="text-red-600">{error}</p>}
      {!jobs && !error && <p className="text-gray-500">Loading…</p>}
      {jobs?.length === 0 && (
        <p className="text-gray-500">No open positions right now.</p>
      )}

      <ul className="flex flex-col gap-4">
        {jobs?.map((job) => (
          <li key={job.id} className="rounded-lg border border-gray-200 p-4">
            <Link
              href={`/jobs/${job.id}`}
              className="text-lg font-semibold text-blue-700 hover:underline"
            >
              {job.title}
            </Link>
            <p className="text-sm text-gray-600">
              {[job.location, job.seniority, job.workModel]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {job.requiredSkills.length > 0 && (
              <p className="mt-1 text-sm text-gray-500">
                Skills: {job.requiredSkills.join(", ")}
              </p>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
