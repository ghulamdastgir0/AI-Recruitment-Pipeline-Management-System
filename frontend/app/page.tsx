"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { apiFetch, ApiError } from "@/lib/api";

interface PublicJob {
  id: string;
  title: string;
  location?: string | null;
  seniority?: string | null;
  workModel?: string | null;
  candidateSummary?: string | null;
}

const WORK_MODEL_LABELS: Record<string, string> = {
  ONSITE: "Onsite",
  HYBRID: "Hybrid",
  REMOTE: "Remote",
};

const STEPS = [
  {
    title: "Apply with your CV",
    body: "Submit your resume in minutes — no account required.",
  },
  {
    title: "AI screens and matches your skills",
    body: "Our matching engine scores your background against the role's requirements.",
  },
  {
    title: "Complete a short AI voice interview",
    body: "A quick, conversational interview you can complete from wherever you are.",
  },
];

function previewOf(candidateSummary: string): string {
  return candidateSummary.split(/\n{2,}/)[0]?.trim() ?? "";
}

export default function HomePage() {
  const [jobs, setJobs] = useState<PublicJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<PublicJob[]>("/jobs")
      .then(setJobs)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Failed to load jobs."),
      );
  }, []);

  return (
    <main className="flex flex-col">
      <header className="flex items-center justify-between px-6 py-5 md:px-12">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
            AI
          </span>
          <span className="font-heading text-lg font-semibold text-text-primary">
            Recruitment Pipeline
          </span>
        </div>
        <Link
          href="/login"
          className="rounded-[var(--radius-control)] border border-border px-4 py-2 text-sm font-medium text-text-secondary hover:bg-black/5"
        >
          For Employers / Staff Login
        </Link>
      </header>

      <section className="px-6 py-16 text-center md:px-12 md:py-24">
        <h1 className="mx-auto max-w-2xl font-heading text-4xl font-semibold text-text-primary text-balance md:text-5xl">
          The future of hiring is intelligent
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-base text-text-muted">
          Fast AI-driven screening, structured voice interviews, and a
          transparent process from application to offer.
        </p>
        <div className="mt-8 flex justify-center">
          <a
            href="#open-roles"
            className="rounded-[var(--radius-control)] bg-brand-600 px-6 py-3 text-sm font-medium text-white hover:bg-brand-700"
          >
            Browse Open Roles
          </a>
        </div>
      </section>

      <section className="bg-surface-card px-6 py-16 md:px-12">
        <h2 className="text-center font-heading text-2xl font-semibold text-text-primary">
          How it works
        </h2>
        <div className="mx-auto mt-10 grid max-w-4xl gap-6 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <div key={step.title} className="flex flex-col gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700">
                {index + 1}
              </span>
              <h3 className="font-heading text-base font-semibold text-text-primary">
                {step.title}
              </h3>
              <p className="text-sm text-text-muted">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="open-roles" className="px-6 py-16 md:px-12">
        <h2 className="font-heading text-2xl font-semibold text-text-primary">
          Current Openings
        </h2>

        {error && (
          <p className="mt-4 text-sm text-danger">{error}</p>
        )}
        {!jobs && !error && (
          <p className="mt-4 text-sm text-text-muted">Loading…</p>
        )}
        {jobs?.length === 0 && (
          <p className="mt-4 text-sm text-text-muted">
            No open positions right now — check back soon.
          </p>
        )}

        <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {jobs?.map((job) => (
            <Link key={job.id} href={`/jobs/${job.id}`}>
              <Card className="h-full transition-shadow hover:shadow-md">
                <h3 className="font-heading text-lg font-semibold text-text-primary">
                  {job.title}
                </h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  {job.workModel && (
                    <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700">
                      {WORK_MODEL_LABELS[job.workModel] ?? job.workModel}
                    </span>
                  )}
                  {job.location && (
                    <span className="rounded-full bg-black/5 px-2.5 py-0.5 text-xs font-medium text-text-secondary">
                      {job.location}
                    </span>
                  )}
                </div>
                {job.candidateSummary && (
                  <p className="mt-3 line-clamp-2 text-sm text-text-muted">
                    {previewOf(job.candidateSummary)}
                  </p>
                )}
                <span className="mt-4 inline-block text-sm font-medium text-brand-700">
                  View &amp; Apply →
                </span>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <footer className="border-t border-border px-6 py-8 text-center text-xs text-text-muted md:px-12">
        © {new Date().getFullYear()} AI Recruitment Pipeline
      </footer>
    </main>
  );
}
