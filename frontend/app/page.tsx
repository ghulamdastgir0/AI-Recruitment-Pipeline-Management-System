"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { apiFetch, ApiError } from "@/lib/api";
import { LoadingState, EmptyState, ErrorState } from "@/components/AsyncState";

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

const WORK_MODEL_STYLES: Record<string, { bar: string; badge: string }> = {
  ONSITE: {
    bar: "bg-accent-amber",
    badge: "bg-accent-amber-soft text-accent-amber-text",
  },
  HYBRID: {
    bar: "bg-accent-violet",
    badge: "bg-accent-violet-soft text-accent-violet-text",
  },
  REMOTE: {
    bar: "bg-accent-teal",
    badge: "bg-accent-teal-soft text-accent-teal-text",
  },
};

const DEFAULT_WORK_MODEL_STYLE = {
  bar: "bg-brand-500",
  badge: "bg-brand-50 text-brand-700",
};

const STEPS = [
  {
    title: "Apply with your CV",
    body: "Submit your resume in minutes — no account required.",
    accent: "from-brand-500 to-brand-700",
  },
  {
    title: "AI screens and matches your skills",
    body: "Our matching engine scores your background against the role's requirements.",
    accent: "from-accent-violet to-brand-700",
  },
  {
    title: "Complete a short AI voice interview",
    body: "A quick, conversational interview you can complete from wherever you are.",
    accent: "from-accent-teal to-brand-700",
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
      <div className="relative overflow-hidden bg-gradient-to-br from-brand-900 via-brand-700 to-accent-violet">
        <div
          aria-hidden
          className="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-accent-teal/40 blur-[100px]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 top-10 h-96 w-96 rounded-full bg-accent-violet/40 blur-[110px]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-[-6rem] left-1/3 h-72 w-72 rounded-full bg-brand-400/30 blur-[100px]"
        />

        <header className="relative flex items-center justify-between px-6 py-5 md:px-12">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-sm font-bold text-brand-700">
              AI
            </span>
            <span className="font-heading text-lg font-semibold text-white">
              Recruitment Pipeline
            </span>
          </div>
          <Link
            href="/login"
            className="rounded-[var(--radius-control)] border border-white/30 px-4 py-2 text-sm font-medium text-white hover:bg-white/10"
          >
            For Employers / Staff Login
          </Link>
        </header>

        <section className="relative px-6 py-16 text-center md:px-12 md:py-24">
          <span className="mx-auto inline-flex items-center rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-brand-100 ring-1 ring-inset ring-white/20">
            AI-powered hiring, end to end
          </span>
          <h1 className="mx-auto mt-5 max-w-2xl font-heading text-4xl font-semibold text-white text-balance md:text-5xl">
            The future of hiring is intelligent
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base text-brand-100">
            Fast AI-driven screening, structured voice interviews, and a
            transparent process from application to offer.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a
              href="#open-roles"
              className="rounded-[var(--radius-control)] bg-white px-6 py-3 text-sm font-medium text-brand-700 shadow-lg shadow-brand-900/30 hover:bg-brand-50"
            >
              Browse Open Roles
            </a>
            <a
              href="#how-it-works"
              className="rounded-[var(--radius-control)] border border-white/30 px-6 py-3 text-sm font-medium text-white hover:bg-white/10"
            >
              See how it works
            </a>
          </div>
        </section>
      </div>

      <section id="how-it-works" className="bg-surface-card px-6 py-16 md:px-12">
        <h2 className="text-center font-heading text-2xl font-semibold text-text-primary">
          How it works
        </h2>
        <div className="mx-auto mt-10 grid max-w-4xl gap-6 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <div
              key={step.title}
              className="relative flex flex-col gap-2 rounded-[var(--radius-card)] border border-border p-5 shadow-sm"
            >
              <span
                className={`flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br ${step.accent} text-sm font-semibold text-white`}
              >
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

      <section id="open-roles" className="bg-surface px-6 py-16 md:px-12">
        <h2 className="font-heading text-2xl font-semibold text-text-primary">
          Current Openings
        </h2>

        {error && (
          <div className="mt-4">
            <ErrorState message={error} />
          </div>
        )}
        {!jobs && !error && (
          <div className="mt-4">
            <LoadingState label="Loading open roles…" />
          </div>
        )}
        {jobs?.length === 0 && (
          <div className="mt-4">
            <EmptyState label="No open positions right now — check back soon." />
          </div>
        )}

        <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {jobs?.map((job) => {
            const workModelStyle = job.workModel
              ? (WORK_MODEL_STYLES[job.workModel] ?? DEFAULT_WORK_MODEL_STYLE)
              : DEFAULT_WORK_MODEL_STYLE;

            return (
              <Link key={job.id} href={`/jobs/${job.id}`}>
                <Card className="relative h-full overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-md">
                  <span
                    className={`absolute inset-y-0 left-0 w-1 ${workModelStyle.bar}`}
                    aria-hidden
                  />
                  <h3 className="font-heading text-lg font-semibold text-text-primary">
                    {job.title}
                  </h3>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {job.workModel && (
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${workModelStyle.badge}`}
                      >
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
            );
          })}
        </div>
      </section>

      <footer className="border-t border-border px-6 py-8 text-center text-xs text-text-muted md:px-12">
        © {new Date().getFullYear()} AI Recruitment Pipeline
      </footer>
    </main>
  );
}
