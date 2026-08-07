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
import {
  BriefcaseIcon,
  ClockIcon,
  GlobeIcon,
  LayersIcon,
  LevelIcon,
  MapPinIcon,
  PauseIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
} from "@/components/ui/icons";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { StatTile } from "@/components/ui/StatTile";
import { apiFetch, ApiError, deleteRequest, postJson } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/lib/toast";

const today = () => new Date().toISOString().slice(0, 10);

interface JobPosting {
  id: string;
  title: string;
  status: string;
  deadline: string;
  location?: string | null;
  seniority?: string | null;
  workModel?: string | null;
}

function formatDeadline(deadline: string): string {
  const date = new Date(deadline);
  if (Number.isNaN(date.getTime())) return "Not set";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
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
  const { showToast } = useToast();

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
      showToast("Job posting created.");
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
    <Card className="mt-6">
      <h2 className="font-heading text-base font-semibold text-text-primary">
        New job posting
      </h2>
      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="job-title">Title</Label>
          <Input
            id="job-title"
            required
            maxLength={120}
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
            maxLength={5000}
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
              maxLength={500}
              placeholder="Comma-separated"
              value={form.requiredSkills}
              onChange={(e) => setForm({ ...form, requiredSkills: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="preferred-skills">Preferred skills</Label>
            <Input
              id="preferred-skills"
              maxLength={500}
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
              min={today()}
              value={form.deadline}
              onChange={(e) => setForm({ ...form, deadline: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="location">Location</Label>
            <Input
              id="location"
              maxLength={100}
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
  const [busyAction, setBusyAction] = useState<"pause" | "resume" | "delete" | null>(
    null,
  );
  const [search, setSearch] = useState("");
  const { showToast } = useToast();

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
    setBusyAction(action);
    try {
      await postJson(`/job-postings/${jobId}/${action}`, {});
      showToast(action === "pause" ? "Job posting paused." : "Job posting resumed.");
      loadJobs(search);
    } catch (err) {
      showToast(
        err instanceof ApiError ? err.message : `Failed to ${action} job.`,
        "danger",
      );
    } finally {
      setBusyJobId(null);
      setBusyAction(null);
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
    setBusyAction("delete");
    try {
      await deleteRequest(`/job-postings/${jobId}`);
      showToast("Job posting deleted.");
      loadJobs(search);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Failed to delete job.", "danger");
    } finally {
      setBusyJobId(null);
      setBusyAction(null);
    }
  }

  const openCount = jobs?.filter((j) => j.status === "PUBLISHED").length ?? 0;
  const pausedCount = jobs?.filter((j) => j.status === "PAUSED").length ?? 0;

  return (
    <StaffNav
      title={canManage ? "Job Postings" : "My Assigned Job Postings"}
      actions={
        canManage && (
          <Button onClick={() => setShowCreate((v) => !v)}>
            <PlusIcon className="h-4 w-4" />
            {showCreate ? "Cancel" : "New Job Posting"}
          </Button>
        )
      }
    >
      {error && (
        <div className="mb-4">
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
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile
              label="Open postings"
              value={openCount}
              hint="Currently published"
              icon={<BriefcaseIcon className="h-full w-full" />}
              accent="success"
            />
            <StatTile
              label="Paused"
              value={pausedCount}
              hint="Not accepting applicants"
              icon={<PauseIcon className="h-full w-full" />}
              accent="warning"
            />
            <StatTile
              label="Total postings"
              value={jobs.length}
              hint={canManage ? "All postings" : "Assigned to you"}
              icon={<LayersIcon className="h-full w-full" />}
              accent="brand"
            />
          </div>

          <div className="relative mt-6 max-w-sm">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <Input
              placeholder="Search by title…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </>
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
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-muted">
              {job.location && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPinIcon className="h-3.5 w-3.5" />
                  {job.location}
                </span>
              )}
              {job.seniority && (
                <span className="inline-flex items-center gap-1.5">
                  <LevelIcon className="h-3.5 w-3.5" />
                  {job.seniority}
                </span>
              )}
              {job.workModel && (
                <span className="inline-flex items-center gap-1.5">
                  <GlobeIcon className="h-3.5 w-3.5" />
                  {job.workModel}
                </span>
              )}
              <span
                className={`inline-flex items-center gap-1.5 ${
                  (job.status === "PUBLISHED" || job.status === "PAUSED") &&
                  new Date(job.deadline).getTime() < new Date().getTime()
                    ? "font-medium text-warning-text"
                    : ""
                }`}
              >
                <ClockIcon className="h-3.5 w-3.5" />
                Deadline: {formatDeadline(job.deadline)}
              </span>
            </div>
            {canManage && (
              <div className="mt-3 flex items-center gap-2">
                {job.status === "PUBLISHED" && (
                  <Button
                    variant="secondary"
                    onClick={() => void pauseOrResume(job.id, "pause")}
                    disabled={busyJobId === job.id}
                    className="px-2.5 py-1 text-xs"
                  >
                    {busyJobId === job.id && busyAction === "pause"
                      ? "Pausing…"
                      : "Pause"}
                  </Button>
                )}
                {job.status === "PAUSED" && (
                  <Button
                    variant="secondary"
                    onClick={() => void pauseOrResume(job.id, "resume")}
                    disabled={busyJobId === job.id}
                    className="px-2.5 py-1 text-xs"
                  >
                    {busyJobId === job.id && busyAction === "resume"
                      ? "Resuming…"
                      : "Resume"}
                  </Button>
                )}
                <Button
                  variant="destructive"
                  onClick={() => void removeJob(job.id, job.title)}
                  disabled={busyJobId === job.id}
                  className="px-2.5 py-1 text-xs"
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                  {busyJobId === job.id && busyAction === "delete"
                    ? "Deleting…"
                    : "Delete"}
                </Button>
              </div>
            )}
          </Card>
        ))}
      </div>
    </StaffNav>
  );
}

export default function StaffPage() {
  return (
    <RoleGuard>
      <StaffDashboard />
    </RoleGuard>
  );
}
