"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PermissionDeniedState,
} from "@/components/AsyncState";
import { JobPostingView } from "@/components/JobPostingView";
import { isRejectedStatus, RejectionDetails } from "@/components/RejectionDetails";
import { RoleGuard } from "@/components/RoleGuard";
import { StaffNav } from "@/components/StaffNav";
import { InternalStatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input, Label, Textarea } from "@/components/ui/Input";
import {
  apiFetch,
  ApiError,
  deleteRequest,
  downloadFile,
  isForbidden,
  patchJson,
  postJson,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface JobPosting {
  id: string;
  title: string;
  description: string;
  responsibilities: string[];
  status: string;
  requiredSkills: string[];
  preferredSkills: string[];
  experienceMin: number;
  salaryMax?: number | null;
  deadline: string;
  hiringTarget: number;
  location?: string | null;
  seniority?: string | null;
  workModel?: string | null;
}

function EditJobForm({
  job,
  jobId,
  onSaved,
  onCancel,
}: {
  job: JobPosting;
  jobId: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    title: job.title,
    description: job.description,
    responsibilities: job.responsibilities.join("\n"),
    requiredSkills: job.requiredSkills.join(", "),
    preferredSkills: job.preferredSkills.join(", "),
    location: job.location ?? "",
    seniority: job.seniority ?? "",
    workModel: job.workModel ?? "",
    salaryMax: job.salaryMax != null ? String(job.salaryMax) : "",
    hiringTarget: String(job.hiringTarget),
    deadline: job.deadline ? job.deadline.slice(0, 10) : "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await patchJson(`/job-postings/${jobId}`, {
        title: form.title,
        description: form.description,
        responsibilities: form.responsibilities
          .split("\n")
          .map((r) => r.trim())
          .filter(Boolean),
        requiredSkills: form.requiredSkills
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        preferredSkills: form.preferredSkills
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        location: form.location || undefined,
        seniority: form.seniority || undefined,
        workModel: form.workModel || undefined,
        salaryMax: form.salaryMax ? Number(form.salaryMax) : undefined,
        hiringTarget: form.hiringTarget ? Number(form.hiringTarget) : undefined,
        deadline: form.deadline
          ? new Date(form.deadline).toISOString()
          : undefined,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save changes.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mt-4">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-title">Title</Label>
          <Input
            id="edit-title"
            required
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-description">Job description</Label>
          <Textarea
            id="edit-description"
            required
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={5}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-responsibilities">Responsibilities (one per line)</Label>
          <Textarea
            id="edit-responsibilities"
            value={form.responsibilities}
            onChange={(e) => setForm({ ...form, responsibilities: e.target.value })}
            rows={4}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-required">Required skills</Label>
            <Input
              id="edit-required"
              placeholder="Comma-separated"
              value={form.requiredSkills}
              onChange={(e) => setForm({ ...form, requiredSkills: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-preferred">Preferred skills</Label>
            <Input
              id="edit-preferred"
              placeholder="Comma-separated"
              value={form.preferredSkills}
              onChange={(e) => setForm({ ...form, preferredSkills: e.target.value })}
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-location">Location</Label>
            <Input
              id="edit-location"
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-seniority">Seniority</Label>
            <Input
              id="edit-seniority"
              placeholder="e.g. Senior"
              value={form.seniority}
              onChange={(e) => setForm({ ...form, seniority: e.target.value })}
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-work-model">Work model</Label>
            <select
              id="edit-work-model"
              value={form.workModel}
              onChange={(e) => setForm({ ...form, workModel: e.target.value })}
              className="rounded-[var(--radius-control)] border border-border bg-white px-3 py-2 text-sm text-text-primary focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100"
            >
              <option value="">Unspecified</option>
              <option value="REMOTE">Remote</option>
              <option value="HYBRID">Hybrid</option>
              <option value="ONSITE">Onsite</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-salary-max">Salary cap</Label>
            <Input
              id="edit-salary-max"
              type="number"
              min={0}
              value={form.salaryMax}
              onChange={(e) => setForm({ ...form, salaryMax: e.target.value })}
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-hiring-target">Hiring target</Label>
            <Input
              id="edit-hiring-target"
              type="number"
              min={1}
              required
              value={form.hiringTarget}
              onChange={(e) => setForm({ ...form, hiringTarget: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-deadline">Application deadline</Label>
            <Input
              id="edit-deadline"
              type="date"
              required
              value={form.deadline}
              onChange={(e) => setForm({ ...form, deadline: e.target.value })}
            />
          </div>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
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
    <Card className="mt-6">
      <h2 className="font-heading text-base font-semibold text-text-primary">
        Hiring Managers
      </h2>
      <p className="mt-1 text-sm text-text-muted">
        At least one Hiring Manager must be assigned before this job can be
        published.
      </p>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
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
                  className="h-4 w-4 rounded border-border text-brand-600 focus:ring-brand-600"
                />
                <span className="text-sm text-text-secondary">
                  {manager.firstName} {manager.lastName} ({manager.email})
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function JobDetail() {
  const { jobId } = useParams<{ jobId: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [job, setJob] = useState<JobPosting | null>(null);
  const [candidates, setCandidates] = useState<RankedCandidate[] | null>(null);
  const [minScore, setMinScore] = useState("");
  const [recommendation, setRecommendation] = useState("");
  const [assignedCount, setAssignedCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  const canManage = user?.role === "SUPER_ADMIN" || user?.role === "HR_ADMIN";

  function loadJob() {
    apiFetch<JobPosting>(`/job-postings/${jobId}`)
      .then(setJob)
      .catch((err) => {
        if (isForbidden(err)) setForbidden(true);
        else setError(err instanceof ApiError ? err.message : "Failed to load job.");
      });
  }

  function loadCandidates() {
    const params = new URLSearchParams();
    if (minScore) params.set("minScore", minScore);
    if (recommendation) params.set("recommendation", recommendation);
    const query = params.toString();
    apiFetch<RankedCandidate[]>(
      `/job-postings/${jobId}/candidates${query ? `?${query}` : ""}`,
    )
      .then(setCandidates)
      .catch((err) =>
        setError(
          err instanceof ApiError ? err.message : "Failed to load candidates.",
        ),
      );
  }

  useEffect(() => {
    loadJob();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadJob is stable per render
  }, [jobId]);

  useEffect(() => {
    loadCandidates();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadCandidates is stable per render
  }, [jobId, minScore, recommendation]);

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

  async function pauseOrResume(action: "pause" | "resume") {
    setLifecycleBusy(true);
    setLifecycleError(null);
    try {
      await postJson(`/job-postings/${jobId}/${action}`, {});
      loadJob();
    } catch (err) {
      setLifecycleError(
        err instanceof ApiError ? err.message : `Failed to ${action} job.`,
      );
    } finally {
      setLifecycleBusy(false);
    }
  }

  async function removeJob() {
    if (
      !window.confirm(
        "Permanently delete this job posting and every application, interview, and match record tied to it? This cannot be undone.",
      )
    ) {
      return;
    }
    setLifecycleBusy(true);
    setLifecycleError(null);
    try {
      await deleteRequest(`/job-postings/${jobId}`);
      router.push("/staff");
    } catch (err) {
      setLifecycleError(
        err instanceof ApiError ? err.message : "Failed to delete job.",
      );
      setLifecycleBusy(false);
    }
  }

  if (forbidden) {
    return (
      <>
        <StaffNav />
        <main className="mx-auto w-full max-w-3xl p-6">
          <PermissionDeniedState />
        </main>
      </>
    );
  }
  if (error) {
    return (
      <>
        <StaffNav />
        <main className="mx-auto w-full max-w-3xl p-6">
          <ErrorState message={error} />
        </main>
      </>
    );
  }
  if (!job) {
    return (
      <>
        <StaffNav />
        <main className="mx-auto w-full max-w-3xl p-6">
          <LoadingState />
        </main>
      </>
    );
  }

  return (
    <>
      <StaffNav />
      <main className="mx-auto w-full max-w-3xl px-6 py-8">
        <Link href="/staff" className="text-sm font-medium text-brand-700 hover:underline">
          ← All jobs
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="font-heading text-2xl font-semibold text-text-primary">
            {job.title}
          </h1>
          <InternalStatusBadge status={job.status} />
        </div>

        {editing ? (
          <EditJobForm
            job={job}
            jobId={jobId}
            onSaved={() => {
              setEditing(false);
              loadJob();
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <Card className="mt-4">
            <JobPostingView
              job={{
                title: job.title,
                description: job.description,
                responsibilities: job.responsibilities,
                requiredSkills: job.requiredSkills,
                preferredSkills: job.preferredSkills,
                location: job.location,
                workModel: job.workModel,
              }}
            />
          </Card>
        )}

        {canManage && !editing && (
          <>
            <HiringManagerPanel
              jobId={jobId}
              onAssignedCountChange={setAssignedCount}
            />
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {job.status !== "PUBLISHED" && job.status !== "PAUSED" && (
                <Button
                  onClick={publish}
                  disabled={publishing || assignedCount === 0}
                >
                  {publishing ? "Publishing…" : "Publish"}
                </Button>
              )}
              {job.status === "PUBLISHED" && (
                <Button
                  variant="secondary"
                  onClick={() => void pauseOrResume("pause")}
                  disabled={lifecycleBusy}
                >
                  {lifecycleBusy ? "Pausing…" : "Pause"}
                </Button>
              )}
              {job.status === "PAUSED" && (
                <Button
                  onClick={() => void pauseOrResume("resume")}
                  disabled={lifecycleBusy}
                >
                  {lifecycleBusy ? "Resuming…" : "Resume"}
                </Button>
              )}
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button
                variant="destructive"
                onClick={() => void removeJob()}
                disabled={lifecycleBusy}
              >
                Delete
              </Button>
            </div>
            {job.status !== "PUBLISHED" && job.status !== "PAUSED" && assignedCount === 0 && (
              <p className="mt-2 text-sm text-warning-text">
                Assign at least one Hiring Manager before publishing this job
                posting.
              </p>
            )}
            {publishError && (
              <p className="mt-2 text-sm text-danger">{publishError}</p>
            )}
            {lifecycleError && (
              <p className="mt-2 text-sm text-danger">{lifecycleError}</p>
            )}
          </>
        )}

        <h2 className="mt-10 font-heading text-lg font-semibold text-text-primary">
          Candidates
        </h2>
        <div className="mt-3 flex flex-wrap gap-3">
          <select
            value={minScore}
            onChange={(event) => setMinScore(event.target.value)}
            className="rounded-[var(--radius-control)] border border-border bg-white px-3 py-1.5 text-sm text-text-primary focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100"
          >
            <option value="">Any score</option>
            <option value="90">90+</option>
            <option value="80">80+</option>
            <option value="70">70+</option>
            <option value="50">50+</option>
          </select>
          <select
            value={recommendation}
            onChange={(event) => setRecommendation(event.target.value)}
            className="rounded-[var(--radius-control)] border border-border bg-white px-3 py-1.5 text-sm text-text-primary focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100"
          >
            <option value="">Any recommendation</option>
            <option value="STRONG_MATCH">Strong match</option>
            <option value="POTENTIAL_MATCH">Potential match</option>
            <option value="NEEDS_REVIEW">Needs review</option>
            <option value="INSUFFICIENT_EVIDENCE">Insufficient evidence</option>
          </select>
        </div>
        {candidates?.length === 0 && (
          <div className="mt-3">
            <EmptyState
              label={
                minScore || recommendation
                  ? "No candidates match these filters."
                  : "No candidates have applied yet."
              }
            />
          </div>
        )}
        <div className="mt-3 flex flex-col gap-3">
          {candidates?.map((candidate) => (
            <Card key={candidate.applicationId} className="p-4">
              <div className="flex items-center justify-between gap-3">
                <Link
                  href={`/staff/jobs/${jobId}/candidates/${candidate.candidateProfileId}`}
                  className="font-medium text-text-primary hover:text-brand-700"
                >
                  {candidate.candidateName ?? candidate.candidateProfileId}
                </Link>
                <div className="flex items-center gap-2">
                  <InternalStatusBadge status={candidate.applicationStatus} />
                  <Button
                    variant="secondary"
                    onClick={() =>
                      void downloadFile(
                        `/job-postings/${jobId}/candidates/${candidate.candidateProfileId}/cv`,
                        `${candidate.candidateName ?? candidate.candidateProfileId}.pdf`,
                      )
                    }
                    className="px-2.5 py-1 text-xs"
                  >
                    Download CV
                  </Button>
                </div>
              </div>
              {candidate.overallScore !== null ? (
                <p className="mt-1 text-sm text-text-muted">
                  {candidate.overallScore}/100 · {candidate.recommendation} ·{" "}
                  {candidate.confidence} confidence
                </p>
              ) : (
                <p className="mt-1 text-sm text-warning-text">Not scored yet</p>
              )}
              {isRejectedStatus(candidate.applicationStatus) ? (
                <RejectionDetails
                  info={{
                    overallScore: candidate.overallScore,
                    summary: candidate.summary,
                    missingRequiredSkills: candidate.missingRequiredSkills,
                  }}
                />
              ) : (
                <p className="mt-1 text-sm text-text-secondary">{candidate.summary}</p>
              )}
            </Card>
          ))}
        </div>
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
