"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import { LoadingState, ErrorState } from "@/components/AsyncState";
import { JobPostingView } from "@/components/JobPostingView";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Input";
import { apiFetch, ApiError, postForm } from "@/lib/api";

const COMPANY_NAME =
  process.env.NEXT_PUBLIC_COMPANY_NAME ?? "AI Recruitment Pipeline";

interface PublicJob {
  id: string;
  title: string;
  candidateSummary?: string | null;
  responsibilities: string[];
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
  const [job, setJob] = useState<PublicJob | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [candidateName, setCandidateName] = useState("");
  const [candidateEmail, setCandidateEmail] = useState("");
  const [candidatePhone, setCandidatePhone] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [existingApplicationId, setExistingApplicationId] = useState<
    string | null
  >(null);
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
    setExistingApplicationId(null);
    try {
      const form = new FormData();
      form.append("jobPostingId", jobId);
      form.append("candidateName", candidateName);
      form.append("candidateEmail", candidateEmail);
      form.append("candidatePhone", candidatePhone);
      form.append("file", file);
      const uploaded = await postForm<UploadCvResult>("/candidates/upload", form);
      setResult(uploaded);
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.status === 409 &&
        err.body &&
        typeof err.body === "object" &&
        "applicationId" in err.body &&
        typeof (err.body as { applicationId: unknown }).applicationId === "string"
      ) {
        setExistingApplicationId((err.body as { applicationId: string }).applicationId);
      }
      setSubmitError(err instanceof ApiError ? err.message : "Upload failed.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <main className="mx-auto w-full max-w-2xl p-6">
        <ErrorState message={loadError} />
      </main>
    );
  }
  if (!job) {
    return (
      <main className="mx-auto w-full max-w-2xl p-6">
        <LoadingState />
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-10">
      <Link href="/" className="text-sm font-medium text-brand-700 hover:underline">
        ← {COMPANY_NAME}
      </Link>

      <div className="mt-6">
        <JobPostingView
          job={{
            title: job.title,
            description: job.candidateSummary ?? "",
            responsibilities: job.responsibilities,
            requiredSkills: job.requiredSkills,
            preferredSkills: job.preferredSkills,
            location: job.location,
            workModel: job.workModel,
          }}
        />
      </div>

      <div className="mt-10">
        {result ? (
          <Card className="border-success/30 bg-success-soft text-center">
            <p className="font-medium text-success-text">
              Your application has been received successfully.
            </p>
            <p className="mt-1 text-sm text-success-text">
              We&apos;ve emailed you a confirmation with a link to track your
              status.
            </p>
            <Link
              href={`/status/${result.applicationId}`}
              className="mt-4 inline-block rounded-[var(--radius-control)] bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              Track your application
            </Link>
          </Card>
        ) : (
          <Card>
            <h2 className="font-heading text-lg font-semibold text-text-primary">
              Apply for this role
            </h2>
            <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="candidateName">Full name</Label>
                <Input
                  id="candidateName"
                  required
                  maxLength={80}
                  placeholder="Jane Doe"
                  value={candidateName}
                  onChange={(event) => setCandidateName(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="candidateEmail">Email address</Label>
                <Input
                  id="candidateEmail"
                  required
                  type="email"
                  maxLength={254}
                  placeholder="jane@example.com"
                  value={candidateEmail}
                  onChange={(event) => setCandidateEmail(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="candidatePhone">Phone number</Label>
                <Input
                  id="candidatePhone"
                  required
                  type="tel"
                  maxLength={30}
                  placeholder="+1 555 010 0100"
                  value={candidatePhone}
                  onChange={(event) => setCandidatePhone(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cv">Résumé (PDF)</Label>
                <div className="rounded-[var(--radius-control)] border border-dashed border-border bg-surface px-3 py-4 text-center text-sm text-text-muted">
                  <input
                    id="cv"
                    type="file"
                    accept="application/pdf"
                    required
                    onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                    className="text-sm"
                  />
                  {file && (
                    <p className="mt-2 text-xs font-medium text-text-secondary">
                      Selected: {file.name}
                    </p>
                  )}
                </div>
              </div>
              {submitError && existingApplicationId && (
                <p className="rounded-[var(--radius-control)] border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-700">
                  {submitError}{" "}
                  <Link
                    href={`/status/${existingApplicationId}`}
                    className="font-medium underline hover:no-underline"
                  >
                    View your application status
                  </Link>
                  .
                </p>
              )}
              {submitError && !existingApplicationId && (
                <p className="text-sm text-danger">{submitError}</p>
              )}
              <Button type="submit" disabled={!file || submitting} className="self-start">
                {submitting ? "Submitting…" : "Submit Application"}
              </Button>
            </form>
          </Card>
        )}
      </div>
    </main>
  );
}
