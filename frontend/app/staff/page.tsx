"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "@/components/AsyncState";
import { RoleGuard } from "@/components/RoleGuard";
import { StaffNav } from "@/components/StaffNav";
import { InternalStatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { apiFetch, ApiError, deleteRequest, postJson } from "@/lib/api";
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
    <Card className="mt-4">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="job-title">Title</Label>
          <Input
            id="job-title"
            required
            placeholder="Senior Backend Engineer"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="job-prompt">Describe the role</Label>
          <Textarea
            id="job-prompt"
            required
            placeholder="Used to draft the posting"
            value={form.rawPrompt}
            onChange={(e) => setForm({ ...form, rawPrompt: e.target.value })}
            rows={3}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="required-skills">Required skills</Label>
            <Input
              id="required-skills"
              placeholder="Comma-separated"
              value={form.requiredSkills}
              onChange={(e) => setForm({ ...form, requiredSkills: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="preferred-skills">Preferred skills</Label>
            <Input
              id="preferred-skills"
              placeholder="Comma-separated"
              value={form.preferredSkills}
              onChange={(e) => setForm({ ...form, preferredSkills: e.target.value })}
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="experience-min">Min experience (years)</Label>
            <Input
              id="experience-min"
              required
              type="number"
              min={0}
              value={form.experienceMin}
              onChange={(e) => setForm({ ...form, experienceMin: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="hiring-target">Hiring target</Label>
            <Input
              id="hiring-target"
              required
              type="number"
              min={1}
              value={form.hiringTarget}
              onChange={(e) => setForm({ ...form, hiringTarget: e.target.value })}
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="deadline">Application deadline</Label>
            <Input
              id="deadline"
              required
              type="date"
              value={form.deadline}
              onChange={(e) => setForm({ ...form, deadline: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="location">Location</Label>
            <Input
              id="location"
              placeholder="Lahore, Pakistan"
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
            />
          </div>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" disabled={submitting} className="self-start">
          {submitting ? "Creating…" : "Create"}
        </Button>
      </form>
    </Card>
  );
}

function StaffDashboard() {
  const { user } = useAuth();
  const router = useRouter();
  const [jobs, setJobs] = useState<JobPosting[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  function loadJobs(query: string) {
    const params = new URLSearchParams();
    if (query.trim()) params.set("search", query.trim());
    const qs = params.toString();
    apiFetch<JobPosting[]>(`/job-postings${qs ? `?${qs}` : ""}`)
      .then(setJobs)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Failed to load jobs."),
      );
  }

  useEffect(() => {
    // Pushed server-side (title search) instead of fetching every job
    // posting and filtering client-side — debounced so each keystroke
    // doesn't fire its own request.
    const timeoutId = setTimeout(() => loadJobs(search), 300);
    return () => clearTimeout(timeoutId);
  }, [search]);

  const canManage = user?.role === "SUPER_ADMIN" || user?.role === "HR_ADMIN";

  async function pauseOrResume(jobId: string, action: "pause" | "resume") {
    setBusyJobId(jobId);
    setError(null);
    try {
      await postJson(`/job-postings/${jobId}/${action}`, {});
      loadJobs(search);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Failed to ${action} job.`);
    } finally {
      setBusyJobId(null);
    }
  }

  async function removeJob(jobId: string, title: string) {
    if (
      !window.confirm(
        `Permanently delete "${title}" and every application, interview, and match record tied to it? This cannot be undone.`,
      )
    ) {
      return;
    }
    setBusyJobId(jobId);
    setError(null);
    try {
      await deleteRequest(`/job-postings/${jobId}`);
      loadJobs(search);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete job.");
    } finally {
      setBusyJobId(null);
    }
  }

  return (
    <>
      <StaffNav />
      <main className="mx-auto w-full max-w-5xl px-6 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-heading text-2xl font-semibold text-text-primary">
            {canManage ? "Job Postings" : "My Assigned Job Postings"}
          </h1>
          {canManage && (
            <Button onClick={() => setShowCreate((v) => !v)}>
              {showCreate ? "Cancel" : "New Job Posting"}
            </Button>
          )}
        </div>

        {error && (
          <div className="mt-4">
            <ErrorState message={error} />
          </div>
        )}

        {canManage && showCreate && (
          <CreateJobForm
            onCreated={(jobId) => {
              setShowCreate(false);
              router.push(`/staff/jobs/${jobId}`);
            }}
          />
        )}

        {jobs !== null && (
          <div className="mt-6">
            <Input
              placeholder="Search by title…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />
          </div>
        )}

        {jobs === null && !error && (
          <div className="mt-6">
            <LoadingState />
          </div>
        )}
        {jobs?.length === 0 && (
          <div className="mt-6">
            <EmptyState
              label={
                search.trim()
                  ? "No job postings match your search."
                  : "No job postings to show yet."
              }
            />
          </div>
        )}

        <div className="mt-6 flex flex-col gap-3">
          {jobs?.map((job) => (
            <Card key={job.id} className="p-4">
              <div className="flex items-center justify-between gap-3">
                <Link
                  href={`/staff/jobs/${job.id}`}
                  className="font-heading text-base font-semibold text-text-primary hover:text-brand-700"
                >
                  {job.title}
                </Link>
                <InternalStatusBadge status={job.status} />
              </div>
              <p className="mt-1 text-sm text-text-muted">
                {[job.location, job.seniority, job.workModel]
                  .filter(Boolean)
                  .join(" · ") || "No location specified"}
              </p>
              {canManage && (
                <div className="mt-3 flex items-center gap-2">
                  {job.status === "PUBLISHED" && (
                    <Button
                      variant="secondary"
                      onClick={() => void pauseOrResume(job.id, "pause")}
                      disabled={busyJobId === job.id}
                      className="px-2.5 py-1 text-xs"
                    >
                      Pause
                    </Button>
                  )}
                  {job.status === "PAUSED" && (
                    <Button
                      variant="secondary"
                      onClick={() => void pauseOrResume(job.id, "resume")}
                      disabled={busyJobId === job.id}
                      className="px-2.5 py-1 text-xs"
                    >
                      Resume
                    </Button>
                  )}
                  <Button
                    variant="destructive"
                    onClick={() => void removeJob(job.id, job.title)}
                    disabled={busyJobId === job.id}
                    className="px-2.5 py-1 text-xs"
                  >
                    Delete
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
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
