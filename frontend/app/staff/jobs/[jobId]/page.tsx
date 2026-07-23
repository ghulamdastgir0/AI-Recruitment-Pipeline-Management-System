"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PermissionDeniedState,
} from "@/components/AsyncState";
import { RoleGuard } from "@/components/RoleGuard";
import { StaffNav } from "@/components/StaffNav";
import { InternalStatusBadge } from "@/components/StatusBadge";
import {
  apiFetch,
  ApiError,
  deleteRequest,
  downloadFile,
  isForbidden,
  postJson,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";

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
  missingRequiredSkills: string[];
}

interface HiringManagerOption {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

interface AssignedManager {
  hiringManagerUserId: string;
}

function HiringManagerPanel({
  jobId,
  onAssignedCountChange,
}: {
  jobId: string;
  onAssignedCountChange: (count: number) => void;
}) {
  const [options, setOptions] = useState<HiringManagerOption[] | null>(null);
  const [assigned, setAssigned] = useState<Set<string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    apiFetch<HiringManagerOption[]>("/users/hiring-managers")
      .then(setOptions)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Failed to load managers."),
      );
    apiFetch<AssignedManager[]>(`/job-postings/${jobId}/hiring-managers`)
      .then((rows) => {
        setAssigned(new Set(rows.map((r) => r.hiringManagerUserId)));
        onAssignedCountChange(rows.length);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Failed to load assignments."),
      );
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load is stable per render
  }, [jobId]);

  async function toggle(managerId: string, isAssigned: boolean) {
    setBusyId(managerId);
    setError(null);
    try {
      if (isAssigned) {
        await deleteRequest(`/job-postings/${jobId}/hiring-managers/${managerId}`);
      } else {
        await postJson(`/job-postings/${jobId}/hiring-managers`, {
          hiringManagerUserId: managerId,
        });
      }
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Update failed.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="mt-6 rounded-lg border border-gray-200 p-4">
      <h2 className="text-lg font-semibold">Hiring Managers</h2>
      <p className="mt-1 text-sm text-gray-500">
        At least one Hiring Manager must be assigned before this job can be
        published.
      </p>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {options === null || assigned === null ? (
        <LoadingState />
      ) : options.length === 0 ? (
        <EmptyState label="No Hiring Manager accounts exist yet." />
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {options.map((manager) => {
            const isAssigned = assigned.has(manager.id);
            return (
              <li key={manager.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={isAssigned}
                  disabled={busyId === manager.id}
                  onChange={() => toggle(manager.id, isAssigned)}
                />
                <span className="text-sm">
                  {manager.firstName} {manager.lastName} ({manager.email})
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function JobDetail() {
  const { jobId } = useParams<{ jobId: string }>();
  const { user } = useAuth();
  const [job, setJob] = useState<JobPosting | null>(null);
  const [candidates, setCandidates] = useState<RankedCandidate[] | null>(null);
  const [assignedCount, setAssignedCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);

  const canManage = user?.role === "SUPER_ADMIN" || user?.role === "HR_ADMIN";

  function loadJob() {
    apiFetch<JobPosting>(`/job-postings/${jobId}`)
      .then(setJob)
      .catch((err) => {
        if (isForbidden(err)) setForbidden(true);
        else setError(err instanceof ApiError ? err.message : "Failed to load job.");
      });
  }

  useEffect(() => {
    loadJob();
    apiFetch<RankedCandidate[]>(`/job-postings/${jobId}/candidates`)
      .then(setCandidates)
      .catch((err) =>
        setError(
          err instanceof ApiError ? err.message : "Failed to load candidates.",
        ),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadJob is stable per render
  }, [jobId]);

  async function publish() {
    setPublishing(true);
    setPublishError(null);
    try {
      await postJson(`/job-postings/${jobId}/publish`, {});
      loadJob();
    } catch (err) {
      setPublishError(err instanceof ApiError ? err.message : "Publish failed.");
    } finally {
      setPublishing(false);
    }
  }

  if (forbidden) {
    return (
      <main className="mx-auto w-full max-w-3xl p-6">
        <PermissionDeniedState />
      </main>
    );
  }
  if (error) return <ErrorState message={error} />;
  if (!job) return <LoadingState />;

  return (
    <>
      <StaffNav />
      <main className="mx-auto w-full max-w-3xl p-6">
        <Link href="/staff" className="text-sm text-blue-600 underline">
          ← All jobs
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-2xl font-bold">{job.title}</h1>
          <InternalStatusBadge status={job.status} />
        </div>
        <p className="mt-4 whitespace-pre-wrap text-gray-800">{job.description}</p>

        {canManage && (
          <>
            <HiringManagerPanel
              jobId={jobId}
              onAssignedCountChange={setAssignedCount}
            />
            {job.status !== "PUBLISHED" && (
              <div className="mt-4">
                <button
                  onClick={publish}
                  disabled={publishing || assignedCount === 0}
                  className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {publishing ? "Publishing…" : "Publish"}
                </button>
                {assignedCount === 0 && (
                  <p className="mt-1 text-sm text-amber-600">
                    Assign at least one Hiring Manager before publishing this
                    job posting.
                  </p>
                )}
                {publishError && (
                  <p className="mt-1 text-sm text-red-600">{publishError}</p>
                )}
              </div>
            )}
          </>
        )}

        <h2 className="mt-8 text-lg font-semibold">Candidates</h2>
        {candidates?.length === 0 && (
          <EmptyState label="No candidates have applied yet." />
        )}
        <ul className="mt-3 flex flex-col gap-3">
          {candidates?.map((candidate) => (
            <li
              key={candidate.applicationId}
              className="rounded-lg border border-gray-200 p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <Link
                  href={`/staff/jobs/${jobId}/candidates/${candidate.candidateProfileId}`}
                  className="font-medium text-blue-700 hover:underline"
                >
                  {candidate.candidateName ?? candidate.candidateProfileId}
                </Link>
                <div className="flex items-center gap-2">
                  <InternalStatusBadge status={candidate.applicationStatus} />
                  <button
                    onClick={() =>
                      void downloadFile(
                        `/job-postings/${jobId}/candidates/${candidate.candidateProfileId}/cv`,
                        `${candidate.candidateName ?? candidate.candidateProfileId}.pdf`,
                      )
                    }
                    className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
                  >
                    Download CV
                  </button>
                </div>
              </div>
              {candidate.overallScore !== null ? (
                <p className="text-sm text-gray-500">
                  {candidate.overallScore}/100 · {candidate.recommendation} ·{" "}
                  {candidate.confidence} confidence
                </p>
              ) : (
                <p className="text-sm text-amber-600">Not scored yet</p>
              )}
              {candidate.missingRequiredSkills.length > 0 && (
                <p className="mt-1 text-sm text-red-600">
                  Missing: {candidate.missingRequiredSkills.join(", ")}
                </p>
              )}
              <p className="mt-1 text-sm text-gray-600">{candidate.summary}</p>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}

export default function JobDetailPage() {
  return (
    <RoleGuard>
      <JobDetail />
    </RoleGuard>
  );
}
