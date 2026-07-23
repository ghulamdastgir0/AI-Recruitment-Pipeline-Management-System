"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import { LoadingState, ErrorState } from "@/components/AsyncState";
import { API_BASE_URL, apiFetch, ApiError } from "@/lib/api";

const COMPANY_NAME =
  process.env.NEXT_PUBLIC_COMPANY_NAME ?? "AI Recruitment Pipeline";

interface PublicJob {
  id: string;
  title: string;
  candidateSummary?: string | null;
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
  const [job, setJob] = useState<PublicJob | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [candidateName, setCandidateName] = useState("");
  const [candidateEmail, setCandidateEmail] = useState("");
  const [candidatePhone, setCandidatePhone] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<UploadCvResult | null>(null);

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
      form.append("candidateName", candidateName);
      form.append("candidateEmail", candidateEmail);
      form.append("candidatePhone", candidatePhone);
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
      setResult(body as UploadCvResult);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) return <ErrorState message={loadError} />;
  if (!job) return <LoadingState />;

  const summaryParagraphs =
    job.candidateSummary
      ?.split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean) ?? [];

  return (
    <main className="mx-auto w-full max-w-2xl p-6">
      <p className="text-sm font-medium text-gray-500">{COMPANY_NAME}</p>
      <h1 className="mt-1 text-2xl font-bold">{job.title}</h1>
      <p className="mt-1 text-sm text-gray-600">
        {[job.location, job.seniority, job.workModel].filter(Boolean).join(" · ")}
      </p>
      {summaryParagraphs.length > 0 && (
        <div className="mt-4 flex flex-col gap-3">
          {summaryParagraphs.map((paragraph, index) => (
            <p key={index} className="text-gray-800">
              {paragraph}
            </p>
          ))}
        </div>
      )}

      <hr className="my-6 border-gray-200" />

      {result ? (
        <div className="rounded-lg border border-green-300 bg-green-50 p-4">
          <p className="font-medium text-green-800">
            Your application has been received successfully.
          </p>
          <Link
            href={`/status/${result.applicationId}`}
            className="mt-3 inline-block rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Track your application
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Apply</h2>
          <input
            required
            placeholder="Full name"
            value={candidateName}
            onChange={(event) => setCandidateName(event.target.value)}
            className="rounded border border-gray-300 px-3 py-2"
          />
          <input
            required
            type="email"
            placeholder="Email address"
            value={candidateEmail}
            onChange={(event) => setCandidateEmail(event.target.value)}
            className="rounded border border-gray-300 px-3 py-2"
          />
          <input
            required
            type="tel"
            placeholder="Phone number"
            value={candidatePhone}
            onChange={(event) => setCandidatePhone(event.target.value)}
            className="rounded border border-gray-300 px-3 py-2"
          />
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
            {submitting ? "Submitting…" : "Submit Application"}
          </button>
        </form>
      )}
    </main>
  );
}
