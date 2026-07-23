"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { RoleGuard } from "@/components/RoleGuard";
import { apiFetch, ApiError } from "@/lib/api";

interface JobPosting {
  id: string;
  title: string;
  description: string;
  status: string;
  requiredSkills: string[];
  preferredSkills: string[];
}

interface RankedCandidate {
  applicationId: string;
  candidateProfileId: string;
  candidateName: string | null;
  applicationStatus: string;
  overallScore: number | null;
  recommendation: string | null;
  confidence: string | null;
  summary: string;
}

function JobDetail() {
  const { jobId } = useParams<{ jobId: string }>();
  const [job, setJob] = useState<JobPosting | null>(null);
  const [candidates, setCandidates] = useState<RankedCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<JobPosting>(`/job-postings/${jobId}`)
      .then(setJob)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Failed to load job."),
      );
    apiFetch<RankedCandidate[]>(`/job-postings/${jobId}/candidates`)
      .then(setCandidates)
      .catch((err) =>
        setError(
          err instanceof ApiError ? err.message : "Failed to load candidates.",
        ),
      );
  }, [jobId]);

  if (error) return <p className="p-6 text-red-600">{error}</p>;
  if (!job) return <p className="p-6 text-gray-500">Loading…</p>;

  return (
    <main className="mx-auto w-full max-w-3xl p-6">
      <Link href="/staff" className="text-sm text-blue-600 underline">
        ← All jobs
      </Link>
      <h1 className="mt-2 text-2xl font-bold">{job.title}</h1>
      <p className="mt-1 text-sm text-gray-500">Status: {job.status}</p>
      <p className="mt-4 whitespace-pre-wrap text-gray-800">{job.description}</p>

      <h2 className="mt-8 text-lg font-semibold">Candidates</h2>
      {candidates?.length === 0 && (
        <p className="mt-2 text-sm text-gray-500">No candidates have applied yet.</p>
      )}
      <ul className="mt-3 flex flex-col gap-3">
        {candidates?.map((candidate) => (
          <li
            key={candidate.applicationId}
            className="rounded-lg border border-gray-200 p-4"
          >
            <div className="flex items-center justify-between">
              <Link
                href={`/staff/jobs/${jobId}/candidates/${candidate.candidateProfileId}`}
                className="font-medium text-blue-700 hover:underline"
              >
                {candidate.candidateName ?? candidate.candidateProfileId}
              </Link>
              <span className="text-sm font-semibold">
                {candidate.overallScore !== null
                  ? `${candidate.overallScore}/100`
                  : candidate.applicationStatus}
              </span>
            </div>
            {candidate.overallScore !== null ? (
              <p className="text-sm text-gray-500">
                {candidate.recommendation} · {candidate.confidence} confidence
              </p>
            ) : (
              <p className="text-sm text-amber-600">Not scored yet</p>
            )}
            <p className="mt-1 text-sm text-gray-600">{candidate.summary}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}

export default function JobDetailPage() {
  return (
    <RoleGuard>
      <JobDetail />
    </RoleGuard>
  );
}
