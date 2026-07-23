"use client";

import { useParams, useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { API_BASE_URL, apiFetch, ApiError } from "@/lib/api";

interface PublicJob {
  id: string;
  title: string;
  description: string;
  requiredSkills: string[];
  preferredSkills: string[];
  location?: string | null;
  seniority?: string | null;
  workModel?: string | null;
}

interface UploadCvResult {
  candidateProfileId: string;
  applicationId: string;
  cvStatus: string;
}

export default function JobDetailPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const router = useRouter();
  const [job, setJob] = useState<PublicJob | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiFetch<PublicJob>(`/jobs/${jobId}`)
      .then(setJob)
      .catch((err) =>
        setLoadError(err instanceof ApiError ? err.message : "Failed to load job."),
      );
  }, [jobId]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const form = new FormData();
      form.append("jobPostingId", jobId);
      form.append("file", file);
      const response = await fetch(`${API_BASE_URL}/candidates/upload`, {
        method: "POST",
        body: form,
      });
      const body: unknown = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message =
          body && typeof body === "object" && "message" in body
            ? String((body as { message: unknown }).message)
            : "Upload failed.";
        throw new Error(message);
      }
      const uploaded = body as UploadCvResult;
      // Scoring runs immediately in the background the moment the CV
      // finishes processing — jump straight to the status page so the
      // candidate sees the interview invite/rejection outcome as soon as
      // it's ready, instead of an extra manual "check status" click.
      router.push(`/status/${uploaded.applicationId}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <main className="mx-auto w-full max-w-2xl p-6">
        <p className="text-red-600">{loadError}</p>
      </main>
    );
  }
  if (!job) {
    return (
      <main className="mx-auto w-full max-w-2xl p-6">
        <p className="text-gray-500">Loading…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl p-6">
      <h1 className="text-2xl font-bold">{job.title}</h1>
      <p className="mt-1 text-sm text-gray-600">
        {[job.location, job.seniority, job.workModel].filter(Boolean).join(" · ")}
      </p>
      <p className="mt-4 whitespace-pre-wrap text-gray-800">{job.description}</p>
      {job.requiredSkills.length > 0 && (
        <p className="mt-4 text-sm">
          <strong>Required:</strong> {job.requiredSkills.join(", ")}
        </p>
      )}
      {job.preferredSkills.length > 0 && (
        <p className="text-sm">
          <strong>Preferred:</strong> {job.preferredSkills.join(", ")}
        </p>
      )}

      <hr className="my-6 border-gray-200" />

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Apply with your CV</h2>
        <input
          type="file"
          accept="application/pdf"
          required
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
        {submitError && <p className="text-sm text-red-600">{submitError}</p>}
        <button
          type="submit"
          disabled={!file || submitting}
          className="self-start rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? "Submitting — scoring your CV…" : "Apply"}
        </button>
      </form>
    </main>
  );
}
