-- Enable Row Level Security on every table in the public schema.
--
-- Why: this database is hosted on Supabase, which exposes the `public`
-- schema through PostgREST (the Data API) to the `anon` / `authenticated`
-- roles. With RLS off, anyone holding the project's (public) anon key can
-- read and write every row directly, bypassing the entire NestJS auth
-- layer. Supabase's own linter flags each of these as an ERROR
-- (`rls_disabled_in_public`).
--
-- No policies are created: RLS with zero policies denies all access to
-- non-owner roles (i.e. every PostgREST caller), while the Prisma
-- connection — which connects as the table owner — bypasses RLS entirely
-- (Postgres owners are exempt unless FORCE ROW LEVEL SECURITY is set, which
-- it is not). So the application keeps working with no code or policy
-- changes; only the Data API loses its blanket access.
--
-- Belt-and-braces: also disable the Data API for this project in the
-- Supabase dashboard (Project Settings -> Data API) — this app never uses
-- PostgREST.

ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CandidateProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CandidateSkill" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Skill" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Document" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DocumentChunk" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Job" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JobSkill" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LinkedInPost" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JobPostingHiringManager" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CandidateComment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Application" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MatchResult" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PendingAssistantAction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AIInterviewSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InterviewViolation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AIInterviewQuestion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CandidateSkillGrade" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmailLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BackgroundJob" ENABLE ROW LEVEL SECURITY;

-- Prisma's own migration bookkeeping table (created outside the Prisma
-- schema, so it can't carry a model directive) — the linter flags it too.
ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;
