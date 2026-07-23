"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import { RoleGuard } from "@/components/RoleGuard";
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

function CreateJobForm({ onCreated }: { onCreated: () => void }) {
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
      await postJson("/job-postings", {
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
      onCreated();
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
  const { user, logout } = useAuth();
  const [jobs, setJobs] = useState<JobPosting[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  function load() {
    apiFetch<JobPosting[]>("/job-postings")
      .then(setJobs)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Failed to load jobs."),
      );
  }

  useEffect(() => {
    load();
  }, []);

  async function publish(id: string) {
    try {
      await postJson(`/job-postings/${id}/publish`, {});
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Publish failed.");
    }
  }

  const canManage = user?.role === "SUPER_ADMIN" || user?.role === "HR_ADMIN";

  return (
    <main className="mx-auto w-full max-w-3xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Job Postings</h1>
          <p className="text-sm text-gray-500">
            Signed in as {user?.email} ({user?.role})
          </p>
        </div>
        <button onClick={logout} className="text-sm text-blue-600 underline">
          Sign out
        </button>
      </div>

      {error && <p className="mb-4 text-red-600">{error}</p>}

      {canManage && (
        <div className="mb-6">
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            {showCreate ? "Cancel" : "New Job Posting"}
          </button>
          {showCreate && (
            <CreateJobForm
              onCreated={() => {
                setShowCreate(false);
                load();
              }}
            />
          )}
        </div>
      )}

      <ul className="flex flex-col gap-3">
        {jobs?.map((job) => (
          <li key={job.id} className="rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <Link
                href={`/staff/jobs/${job.id}`}
                className="text-lg font-semibold text-blue-700 hover:underline"
              >
                {job.title}
              </Link>
              <span className="rounded bg-gray-100 px-2 py-1 text-xs">
                {job.status}
              </span>
            </div>
            <p className="mt-1 text-sm text-gray-500">
              {[job.location, job.seniority, job.workModel]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {canManage && job.status === "DRAFT" && (
              <button
                onClick={() => publish(job.id)}
                className="mt-2 rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700"
              >
                Publish
              </button>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}

export default function StaffPage() {
  return (
    <RoleGuard>
      <StaffDashboard />
    </RoleGuard>
  );
}
