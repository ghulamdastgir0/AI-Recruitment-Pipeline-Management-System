"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "@/components/AsyncState";
import { RoleGuard } from "@/components/RoleGuard";
import { StaffNav } from "@/components/StaffNav";
import { InternalStatusBadge } from "@/components/StatusBadge";
import { apiFetch, ApiError, postJson } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface JobPosting {
  id: string;
  title: string;
  status: string;
  location?: string | null;
  seniority?: string | null;
  workModel?: string | null;
}

interface CreatedJob {
  id: string;
}

function CreateJobForm({ onCreated }: { onCreated: (jobId: string) => void }) {
  const [form, setForm] = useState({
    title: "",
    rawPrompt: "",
    requiredSkills: "",
    preferredSkills: "",
    experienceMin: "0",
    hiringTarget: "1",
    deadline: "",
    location: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const created = await postJson<CreatedJob>("/job-postings", {
        title: form.title,
        rawPrompt: form.rawPrompt,
        requiredSkills: form.requiredSkills
          ? form.requiredSkills.split(",").map((s) => s.trim()).filter(Boolean)
          : undefined,
        preferredSkills: form.preferredSkills
          ? form.preferredSkills.split(",").map((s) => s.trim()).filter(Boolean)
          : undefined,
        experienceMin: Number(form.experienceMin),
        hiringTarget: Number(form.hiringTarget),
        deadline: new Date(form.deadline).toISOString(),
        location: form.location || undefined,
      });
      onCreated(created.id);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to create job posting.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-4 flex flex-col gap-2 rounded-lg border border-gray-200 p-4"
    >
      <input
        required
        placeholder="Title"
        value={form.title}
        onChange={(e) => setForm({ ...form, title: e.target.value })}
        className="rounded border border-gray-300 px-3 py-2"
      />
      <textarea
        required
        placeholder="Describe the role (used to draft the posting)"
        value={form.rawPrompt}
        onChange={(e) => setForm({ ...form, rawPrompt: e.target.value })}
        rows={3}
        className="rounded border border-gray-300 px-3 py-2"
      />
      <input
        placeholder="Required skills (comma-separated)"
        value={form.requiredSkills}
        onChange={(e) => setForm({ ...form, requiredSkills: e.target.value })}
        className="rounded border border-gray-300 px-3 py-2"
      />
      <input
        placeholder="Preferred skills (comma-separated)"
        value={form.preferredSkills}
        onChange={(e) => setForm({ ...form, preferredSkills: e.target.value })}
        className="rounded border border-gray-300 px-3 py-2"
      />
      <div className="flex gap-2">
        <input
          required
          type="number"
          min={0}
          placeholder="Min experience (years)"
          value={form.experienceMin}
          onChange={(e) => setForm({ ...form, experienceMin: e.target.value })}
          className="w-1/2 rounded border border-gray-300 px-3 py-2"
        />
        <input
          required
          type="number"
          min={1}
          placeholder="Hiring target"
          value={form.hiringTarget}
          onChange={(e) => setForm({ ...form, hiringTarget: e.target.value })}
          className="w-1/2 rounded border border-gray-300 px-3 py-2"
        />
      </div>
      <input
        required
        type="date"
        value={form.deadline}
        onChange={(e) => setForm({ ...form, deadline: e.target.value })}
        className="rounded border border-gray-300 px-3 py-2"
      />
      <input
        placeholder="Location"
        value={form.location}
        onChange={(e) => setForm({ ...form, location: e.target.value })}
        className="rounded border border-gray-300 px-3 py-2"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="self-start rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {submitting ? "Creating…" : "Create"}
      </button>
    </form>
  );
}

function StaffDashboard() {
  const { user } = useAuth();
  const router = useRouter();
  const [jobs, setJobs] = useState<JobPosting[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    apiFetch<JobPosting[]>("/job-postings")
      .then(setJobs)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Failed to load jobs."),
      );
  }, []);

  const canManage = user?.role === "SUPER_ADMIN" || user?.role === "HR_ADMIN";

  return (
    <>
      <StaffNav />
      <main className="mx-auto w-full max-w-3xl p-6">
        <h1 className="text-2xl font-bold">
          {canManage ? "Job Postings" : "My Assigned Job Postings"}
        </h1>

        {error && <ErrorState message={error} />}

        {canManage && (
          <div className="my-6">
            <button
              onClick={() => setShowCreate((v) => !v)}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              {showCreate ? "Cancel" : "New Job Posting"}
            </button>
            {showCreate && (
              <CreateJobForm
                onCreated={(jobId) => {
                  setShowCreate(false);
                  router.push(`/staff/jobs/${jobId}`);
                }}
              />
            )}
          </div>
        )}

        {jobs === null && !error && <LoadingState />}
        {jobs?.length === 0 && (
          <EmptyState label="No job postings to show yet." />
        )}

        <ul className="mt-6 flex flex-col gap-3">
          {jobs?.map((job) => (
            <li key={job.id} className="rounded-lg border border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <Link
                  href={`/staff/jobs/${job.id}`}
                  className="text-lg font-semibold text-blue-700 hover:underline"
                >
                  {job.title}
                </Link>
                <InternalStatusBadge status={job.status} />
              </div>
              <p className="mt-1 text-sm text-gray-500">
                {[job.location, job.seniority, job.workModel]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}

export default function StaffPage() {
  return (
    <RoleGuard>
      <StaffDashboard />
    </RoleGuard>
  );
}
