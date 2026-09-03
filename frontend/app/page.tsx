"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
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

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0 },
};

const staggerContainer = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.1 },
  },
};

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
      <div className="hero-surface flex min-h-[100svh] flex-col">
        <motion.div
          data-orb
          aria-hidden
          className="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full blur-[100px]"
          style={{ background: "var(--color-hero-orb-teal)", animation: "drift 16s ease-in-out infinite" }}
        />
        <motion.div
          data-orb
          aria-hidden
          className="pointer-events-none absolute -right-16 top-10 h-96 w-96 rounded-full blur-[110px]"
          style={{
            background: "var(--color-hero-orb-violet)",
            animation: "drift 20s ease-in-out infinite reverse",
          }}
        />
        <motion.div
          data-orb
          aria-hidden
          className="pointer-events-none absolute bottom-[-6rem] left-1/3 h-72 w-72 rounded-full blur-[100px]"
          style={{
            background: "var(--color-hero-orb-blue)",
            animation: "drift 18s ease-in-out infinite",
            animationDelay: "-4s",
          }}
        />

        <header className="relative flex items-center justify-between px-6 py-5 md:px-12">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-sm font-bold text-white ring-1 ring-inset ring-white/25">
              AI
            </span>
            <span className="font-heading text-lg font-semibold text-white">
              Recruitment Pipeline
            </span>
          </div>
          <Link
            href="/login"
            className="rounded-[var(--radius-control)] border border-white/30 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/10"
          >
            For Employers / Staff Login
          </Link>
        </header>

        <motion.section
          className="relative flex flex-1 flex-col justify-center px-6 py-16 text-center md:px-12 md:py-24"
          initial="hidden"
          animate="show"
          variants={staggerContainer}
        >
          <motion.span
            variants={fadeUp}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="mx-auto inline-flex items-center rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/85 ring-1 ring-inset ring-white/20"
          >
            AI-powered hiring, end to end
          </motion.span>
          <motion.h1
            variants={fadeUp}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="mx-auto mt-5 max-w-2xl font-heading text-4xl font-semibold text-white text-balance md:text-5xl"
          >
            The future of hiring is intelligent
          </motion.h1>
          <motion.p
            variants={fadeUp}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="mx-auto mt-4 max-w-xl text-base text-white/75"
          >
            Fast AI-driven screening, structured voice interviews, and a
            transparent process from application to offer.
          </motion.p>
          <motion.div
            variants={fadeUp}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="mt-8 flex flex-wrap justify-center gap-3"
          >
            <motion.a
              href="#open-roles"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.98 }}
              className="rounded-[var(--radius-control)] bg-gradient-to-r from-accent-teal via-brand-500 to-accent-violet px-6 py-3 text-sm font-medium text-white shadow-lg shadow-brand-900/50 hover:brightness-110"
            >
              Browse Open Roles
            </motion.a>
            <motion.a
              href="#how-it-works"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.98 }}
              className="rounded-[var(--radius-control)] border border-white/30 px-6 py-3 text-sm font-medium text-white hover:bg-white/10"
            >
              See how it works
            </motion.a>
          </motion.div>
        </motion.section>
      </div>

      <section id="how-it-works" className="bg-surface-card px-6 py-16 md:px-12">
        <h2 className="text-center font-heading text-2xl font-semibold text-text-primary">
          How it works
        </h2>
        <motion.div
          className="mx-auto mt-10 grid max-w-4xl gap-6 md:grid-cols-3"
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.3 }}
          variants={staggerContainer}
        >
          {STEPS.map((step, index) => (
            <motion.div
              key={step.title}
              variants={fadeUp}
              transition={{ duration: 0.45, ease: "easeOut" }}
              whileHover={{ y: -3 }}
              className="relative flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-white/[0.03] p-5 shadow-sm backdrop-blur-sm transition-shadow hover:shadow-md"
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
            </motion.div>
          ))}
        </motion.div>
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

        <motion.div
          className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3"
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.2 }}
          variants={staggerContainer}
        >
          {jobs?.map((job) => {
            const workModelStyle = job.workModel
              ? (WORK_MODEL_STYLES[job.workModel] ?? DEFAULT_WORK_MODEL_STYLE)
              : DEFAULT_WORK_MODEL_STYLE;

            return (
              <motion.div key={job.id} variants={fadeUp} transition={{ duration: 0.4, ease: "easeOut" }}>
                <Link href={`/jobs/${job.id}`}>
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
                        <span className="rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-medium text-text-secondary">
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
              </motion.div>
            );
          })}
        </motion.div>
      </section>

      <footer className="border-t border-border px-6 py-8 text-center text-xs text-text-muted md:px-12">
        © {new Date().getFullYear()} AI Recruitment Pipeline
      </footer>
    </main>
  );
}
