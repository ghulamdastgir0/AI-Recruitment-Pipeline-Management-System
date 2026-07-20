import { KnowledgeSourceType } from '../generated/prisma/enums';

export interface KnowledgeChunk {
  title: string;
  sourceType: KnowledgeSourceType;
  content: string;
}

const chunk = (title: string, sourceType: KnowledgeSourceType, content: string): KnowledgeChunk => ({
  title,
  sourceType,
  content: content.trim(),
});

export const KNOWLEDGE_BASE_SEED: KnowledgeChunk[] = [
  // --- Backend_Standards.pdf ---
  chunk(
    'Backend_Standards.pdf - 1. Language & Framework Conventions',
    KnowledgeSourceType.STACK_PREFERENCE,
    `Node.js services use TypeScript with NestJS as the standard framework. Python services (primarily AI/ML and data-processing workloads) use FastAPI with Pydantic v2 models for request/response validation.
NestJS Project Structure:
- One module per bounded context (e.g. candidates, requisitions, interviews).
- Controllers stay thin — validation and orchestration only; business logic lives in services.
- DTOs are defined with class-validator decorators for every incoming payload; no untyped request bodies.
- Prisma is the only approved ORM; raw SQL is allowed only for reporting queries and must be reviewed by a Tech Lead.
FastAPI Project Structure:
- Routers grouped by domain; dependency injection used for DB sessions and auth context.
- All LLM-facing endpoints (resume parsing, match scoring, JD generation) must define a strict Pydantic output schema — free-text LLM output is never returned directly to a client.
- Long-running AI operations (interview grading, embedding generation) run as background tasks or queue jobs, never inline in the request/response cycle.`,
  ),
  chunk(
    'Backend_Standards.pdf - 2. API Design Rules',
    KnowledgeSourceType.STACK_PREFERENCE,
    `Naming: REST resources are plural nouns: /candidates, /requisitions/{id}/interviews
Versioning: URI-based: /v1/... ; breaking changes require a new version, not a flag
Errors: RFC 7807 problem+json shape with a machine-readable code field
Pagination: Cursor-based for large collections (candidate lists, scoreboards)
Auth: JWT bearer tokens; RBAC scopes checked via a shared guard/middleware, never per-handler ad hoc checks
Idempotency: All mutating endpoints triggered by automation (e.g. auto-reject) require an idempotency key`,
  ),
  chunk(
    'Backend_Standards.pdf - 3. Data & Migrations',
    KnowledgeSourceType.STACK_PREFERENCE,
    `- Every schema change ships as a Prisma migration file committed alongside the code that needs it.
- No destructive migrations (dropping columns/tables) without a Tech Lead approval and a documented rollback plan.
- pgvector columns (embeddings) are always paired with a content_hash column so stale embeddings can be detected and regenerated.`,
  ),
  chunk(
    'Backend_Standards.pdf - 4. Testing Requirements',
    KnowledgeSourceType.STACK_PREFERENCE,
    `Unit tests: Jest (Node) / pytest (Python) — All service-layer business logic
Integration tests: Supertest / httpx + test DB — Every new API endpoint
Contract tests: Pact or equivalent — Any service consumed by another service
Load tests: k6 — Endpoints with a stated NFR (e.g. match-scoring <5s, API p95 <200ms)`,
  ),
  chunk(
    'Backend_Standards.pdf - 5. Security Baseline',
    KnowledgeSourceType.OTHER,
    `- Secrets are never committed; loaded via the internal secrets vault at runtime.
- All PII fields (candidate name, email, resume content) are encrypted at rest.
- Unauthorized access attempts to protected routes return 403 and are logged with the requesting principal.
- Deviations require sign-off from a Tech Lead and must be recorded as an ADR (Architecture Decision Record) in the service's wiki page.`,
  ),

  // --- Company_Culture.pdf ---
  chunk(
    'Company_Culture.pdf - 1. Values in Practice',
    KnowledgeSourceType.CULTURE_GUIDELINE,
    `- Automate the boring, escalate the ambiguous. We measure engineering impact partly by how much manual toil a team removes for itself or for customers.
- Ship small, ship often. A feature that isn't safe to ship in a small slice usually isn't well understood yet.
- Write it down. If a decision only exists in a Slack thread, it didn't happen. Decisions get an ADR or wiki page.
- Default to transparency. Salary bands, roadmap status, and OKRs are visible company-wide unless legally restricted.
- Candidates and customers are users too. The hiring pipeline is held to the same UX and reliability bar as our paid product — a rejected candidate should still leave with a good impression of Nexora.`,
  ),
  chunk(
    'Company_Culture.pdf - 2. Communication Norms',
    KnowledgeSourceType.CULTURE_GUIDELINE,
    `- Default to async — write clearly enough that a reader in a different timezone doesn't need a follow-up call.
- Disagree openly and early, in the document or thread, not after a decision has shipped.
- Status updates are written, not verbal-only, so the AI/RAG tools and future teammates can find them.`,
  ),
  chunk(
    'Company_Culture.pdf - 3. Rituals',
    KnowledgeSourceType.CULTURE_GUIDELINE,
    `All-Hands: Monthly — Company metrics, roadmap, Q&A with leadership
Pod Retro: Every 2 weeks — What worked, what didn't, one concrete change
No-Meeting Wednesday: Weekly — Protected deep-work time
Demo Friday: Weekly — Any team can show shipped work, no polish required
Culture Review: Twice yearly — People Ops checks values are actually being lived, not just posted`,
  ),
  chunk(
    'Company_Culture.pdf - 4. Diversity, Equity & Inclusion',
    KnowledgeSourceType.CULTURE_GUIDELINE,
    `- Hiring panels and JD language are reviewed for bias; the automated JD generator is prompted to avoid gendered or exclusionary phrasing.
- Salary bands are published to reduce negotiation-based pay gaps.
- Employee resource groups are supported with a small discretionary budget from People Operations.`,
  ),
  chunk(
    'Company_Culture.pdf - 5. How Nexora Writes Job Descriptions',
    KnowledgeSourceType.CULTURE_GUIDELINE,
    `This section directly informs the RAG-generated JD tone: descriptions are specific about the actual day-to-day stack and problems (not generic buzzwords), state the true seniority bar plainly, and avoid inflated "rockstar/ninja" language. A JD should let a strong candidate self-select in and a mismatched candidate self-select out — that's more respectful of everyone's time than an overly broad posting.`,
  ),
  chunk(
    "Company_Culture.pdf - 6. What We're Not",
    KnowledgeSourceType.CULTURE_GUIDELINE,
    `- Not an "always-on" culture — sustainable pace beats heroics; repeated late-night pushes are treated as a process failure to fix, not a badge of honor.
- Not consensus-by-committee — pods are expected to make and own their own calls within their scope.
- Not opaque about how decisions (including hiring decisions) get made — if a process can't be explained plainly, it needs to change, not just be documented better.`,
  ),

  // --- Employee_Benefits.pdf ---
  chunk(
    'Employee_Benefits.pdf - 1. Health & Wellness',
    KnowledgeSourceType.OTHER,
    `Health Insurance: Employee + immediate family, fully company-paid, from day 1
Mental Health Support: 12 covered therapy sessions/year via partnered provider
Annual Health Checkup: Fully covered, once per year
Gym / Wellness Stipend: PKR 5,000/month (or local equivalent)`,
  ),
  chunk(
    'Employee_Benefits.pdf - 2. Financial Benefits',
    KnowledgeSourceType.OTHER,
    `- Provident fund: company matches employee contribution up to 8% of base salary.
- Annual performance bonus, paid alongside the January review cycle.
- Referral bonus: PKR 100,000 (or local equivalent) after the referred hire completes a 3-month probation.
- Relocation support for employees moving between the Lahore, Dubai, and Austin offices.`,
  ),
  chunk(
    'Employee_Benefits.pdf - 3. Learning & Growth',
    KnowledgeSourceType.OTHER,
    `- Annual learning budget: USD 800 per employee for courses, books, and conference tickets.
- Internal mentorship program pairing L5/L6 engineers with senior ICs.
- Conference attendance: one company-sponsored conference per year, subject to manager approval.`,
  ),
  chunk(
    'Employee_Benefits.pdf - 4. Time Off & Flexibility',
    KnowledgeSourceType.OTHER,
    `- 20 days annual leave, 10 sick days — see HR_Policies.pdf for full leave schedule.
- Hybrid work model: 2 in-office days/week, flexible core hours 11 AM – 4 PM.
- "No-meeting Wednesdays" company-wide, reserved for deep work.`,
  ),
  chunk(
    'Employee_Benefits.pdf - 5. Equipment & Perks',
    KnowledgeSourceType.OTHER,
    `- Company-issued laptop (MacBook Pro or equivalent ThinkPad, engineer's choice) refreshed every 3 years.
- One-time home-office setup allowance: USD 300 for new hires.
- Free lunch on in-office days at Lahore and Dubai locations.`,
  ),
  chunk(
    'Employee_Benefits.pdf - 6. Family & Parental',
    KnowledgeSourceType.OTHER,
    `- 16 weeks fully paid primary parental leave; 4 weeks secondary — see HR_Policies.pdf.
- Childcare stipend: PKR 15,000/month for employees with children under 5.
Note: Benefit values are reviewed annually and may vary slightly by country of employment due to local statutory requirements.`,
  ),

  // --- Engineering_Wiki.pdf ---
  chunk(
    'Engineering_Wiki.pdf - 1. System Architecture',
    KnowledgeSourceType.WIKI,
    `Nexora runs a service-oriented architecture: independently deployable services communicate over REST/JSON, with async work handed off through queues. Each service owns its schema; cross-service reads go through published APIs, never direct database access.
Core Services:
- candidate-portal-api: NestJS + Prisma + PostgreSQL (Platform Eng.) — Candidate applications, auth, status tracking
- jd-generator: FastAPI + LLM + pgvector (AI & Data) — RAG-driven job description generation
- resume-parser: FastAPI + LLM Schema Extractor (AI & Data) — Parses PDF/DOCX resumes into structured entities
- match-engine: FastAPI + pgvector + Redis (AI & Data) — Semantic match scoring, hard-gate decisions
- interview-engine: NestJS + WebSockets + LLM (AI & Data) — Real-time AI-conducted interview sessions
- hr-scoreboard-web: React + Vite + TypeScript (Platform Eng.) — HR admin dashboard, action buttons
- notification-service: NestJS + BullMQ + SES (Platform Eng.) — Transactional email & SMS dispatch
- linkedin-sync: NestJS + LinkedIn Share API (Platform Eng.) — Job post publish/unpublish syndication`,
  ),
  chunk(
    'Engineering_Wiki.pdf - 2. Environments',
    KnowledgeSourceType.WIKI,
    `local: Developer machines — Manual (docker-compose) — Seeded fixtures only
staging: Pre-prod validation, QA — Auto on merge to main — Anonymized snapshot of prod
production: Live traffic — Manual approval + tag release — Real candidate & client data`,
  ),
  chunk(
    'Engineering_Wiki.pdf - 3. Runbooks',
    KnowledgeSourceType.WIKI,
    `- Resume parsing stuck in queue: check BullMQ dashboard for the resume-parser queue; dead-lettered jobs auto-retry 3x, then page AI & Data on-call.
- LinkedIn sync failing: verify the LinkedIn API token hasn't expired (90-day rotation); rotate via the internal secrets vault, not manually in code.
- Match scores look wrong for a requisition: confirm the JD embedding was regenerated after the last manual JD edit — stale embeddings are the most common cause.
- Interview session drops mid-way: candidate progress auto-saves every 30 seconds; instruct the candidate to log back in within the remaining window.`,
  ),
  chunk(
    'Engineering_Wiki.pdf - 4. Local Setup',
    KnowledgeSourceType.WIKI,
    `Clone the monorepo, run docker-compose up to start PostgreSQL (with the pgvector extension enabled), Redis, and a MailHog instance for local email testing. Each service has its own .env.example — copy to .env and fill in local secrets from the team vault. Run pnpm install && pnpm dev at the repo root to start all Node services concurrently; Python services run via uvicorn individually.`,
  ),
  chunk(
    'Engineering_Wiki.pdf - 5. On-Call',
    KnowledgeSourceType.WIKI,
    `- Rotation is weekly, Monday 9 AM handoff, managed in PagerDuty.
- Primary on-call must acknowledge P1 alerts within 15 minutes; secondary escalation after 20 minutes.
- All incidents affecting candidate-facing flows (portal, interview engine) are P1 by default.`,
  ),

  // --- Frontend_Standards.pdf ---
  chunk(
    'Frontend_Standards.pdf - 1. Stack Baseline',
    KnowledgeSourceType.STACK_PREFERENCE,
    `- React 18+ with TypeScript in strict mode; no any without an inline justification comment.
- Vite as the build tool for all new frontends; CRA-based legacy apps are being migrated off.
- Tailwind CSS for styling — no ad hoc CSS files except for rare third-party overrides.
- React Query for all server-state (API data); Zustand for local/UI-only state. Redux is deprecated for new work.`,
  ),
  chunk(
    'Frontend_Standards.pdf - 2. Component Guidelines',
    KnowledgeSourceType.STACK_PREFERENCE,
    `- Functional components with hooks only; no class components in new code.
- One component per file; co-locate its test and (if any) Storybook story in the same folder.
- Presentational components stay free of data-fetching — fetching happens in container components or route loaders.
- Shared UI primitives (buttons, inputs, tables) live in a single internal design-system package, not duplicated per app.`,
  ),
  chunk(
    'Frontend_Standards.pdf - 3. Folder Structure (per app)',
    KnowledgeSourceType.STACK_PREFERENCE,
    `src/routes: Route-level components / pages
src/components: Reusable, mostly presentational components
src/features: Feature-scoped logic: hooks, API calls, feature-local state
src/lib: Shared utilities, API client, formatting helpers
src/types: Shared TypeScript types/interfaces`,
  ),
  chunk(
    'Frontend_Standards.pdf - 4. Candidate-Facing UX Standards',
    KnowledgeSourceType.STACK_PREFERENCE,
    `The Candidate Portal and AI interview module are held to a higher UX bar than internal tools, since candidates form their first impression of Nexora here.
- Every async action (resume upload, interview submission) shows explicit loading and success/error states — no silent failures.
- Rejection and status messages are worded professionally and empathetically; copy changes go through the People Operations review.
- The 48-hour interview window countdown must be visible on the portal from the moment a candidate is invited.
- All forms are keyboard-navigable and pass WCAG 2.1 AA contrast checks.`,
  ),
  chunk(
    'Frontend_Standards.pdf - 5. HR Scoreboard Standards',
    KnowledgeSourceType.STACK_PREFERENCE,
    `- Action buttons (Select / Next Round / Reject) require a confirmation step before firing an email — no accidental bulk actions.
- Match percentage and interview score are always shown together with the justification text, never the number alone.
- Table views support sort and filter by score, status, and requisition without a full page reload.`,
  ),
  chunk(
    'Frontend_Standards.pdf - 6. Testing & Quality',
    KnowledgeSourceType.STACK_PREFERENCE,
    `Unit / component: Vitest + React Testing Library — All components with logic branches
End-to-end: Playwright — Critical flows: apply, upload resume, complete interview, HR decision actions
Visual regression: Chromatic (where Storybook exists) — Shared design-system components
Accessibility: axe-core in CI — Candidate-facing routes block merge on violations`,
  ),

  // --- HR_Policies.pdf ---
  chunk(
    'HR_Policies.pdf - 1. Employment Basics',
    KnowledgeSourceType.OTHER,
    `- Standard probation period: 3 months for full-time hires, extendable once by 1 month with written justification.
- Employment type is specified per offer letter: Full-time, Contract, or Intern.
- Notice period: 30 days for confirmed employees, 7 days during probation.`,
  ),
  chunk(
    'HR_Policies.pdf - 2. Working Hours & Remote Work',
    KnowledgeSourceType.OTHER,
    `- Core collaboration hours: 11:00 AM – 4:00 PM local pod timezone; flexible outside this window.
- Hybrid-first: 2 in-office days/week for Lahore & Dubai pods; fully remote roles are explicitly labeled in the requisition.
- Client Delivery roles may require overlap with client timezones as specified in the job description.
- Requests for a fully remote arrangement go through the Engineering/People Manager and are reviewed quarterly.`,
  ),
  chunk(
    'HR_Policies.pdf - 3. Leave Policy',
    KnowledgeSourceType.OTHER,
    `Annual Leave: 20 working days/year — Accrued monthly; unused days up to 5 carry over
Sick Leave: 10 days/year — Medical certificate required beyond 2 consecutive days
Parental Leave: 16 weeks primary / 4 weeks secondary — Fully paid; can be split within 12 months
Bereavement Leave: 5 days — Immediate family; extendable on manager approval
Public Holidays: Per local statutory calendar — Varies by office location
Unpaid Leave: Case-by-case, up to 30 days — Requires VP-level approval`,
  ),
  chunk(
    'HR_Policies.pdf - 4. Code of Conduct',
    KnowledgeSourceType.OTHER,
    `- Zero tolerance for harassment, discrimination, or retaliation of any kind.
- All production access is logged; credential sharing is a terminable offense.
- Client and candidate data (including resumes, interview transcripts, and scoring data) is confidential and must not leave approved systems.
- Conflicts of interest (e.g. hiring or managing a relative) must be disclosed to People Operations before the process begins.
- Outside employment or freelance work must not compete with Nexora's business and requires disclosure.`,
  ),
  chunk(
    'HR_Policies.pdf - 5. Grievance & Escalation',
    KnowledgeSourceType.OTHER,
    `- Step 1: Raise informally with your direct manager where appropriate.
- Step 2: Escalate in writing to People Operations (hr@nexorasystems.example) if unresolved or if the manager is the subject.
- Step 3: Formal review by the VP People & Operations within 10 business days; outcome communicated in writing.
- Retaliation against anyone raising a grievance in good faith is itself a disciplinary matter.`,
  ),
  chunk(
    'HR_Policies.pdf - 6. Performance & Compensation Cycle',
    KnowledgeSourceType.OTHER,
    `- Salary bands are published internally per level (L1–L6) and role family; new offers must fall within band.
- Performance & compensation reviews run twice yearly (January and July).
- Underperformance is addressed via a documented Performance Improvement Plan (PIP) with clear, time-boxed goals before any separation decision.`,
  ),
  chunk(
    'HR_Policies.pdf - 7. Offboarding',
    KnowledgeSourceType.OTHER,
    `- Access to all systems (including candidate/HR data) is revoked on the employee's last working day.
- Exit interviews are conducted by People Operations for all voluntary departures.
- Final settlement is processed within one payroll cycle of the last working day.
Note: This policy is reviewed annually. Country-specific addenda (Pakistan, UAE, USA) apply where local law differs from the standards above; the stricter provision governs.`,
  ),

  // --- Interview_Framework.pdf ---
  chunk(
    'Interview_Framework.pdf - 1. Competency Dimensions',
    KnowledgeSourceType.OTHER,
    `Every interview — human or AI-conducted — scores a candidate against a fixed set of dimensions. Scores are 1–5, and every score must carry a short textual justification; unexplained scores are not accepted for a hiring decision.
Technical Depth (35% for Eng. roles): Correctness and depth of domain/stack knowledge
System Design (20%): Ability to reason about trade-offs at scale
Problem Solving (20%): Approach to ambiguous or novel problems
Communication (15%): Clarity explaining technical decisions
Collaboration/Values Fit (10%): Alignment with Nexora's core values`,
  ),
  chunk(
    'Interview_Framework.pdf - 2. Role-Family Weighting Adjustments',
    KnowledgeSourceType.OTHER,
    `- Backend/Platform roles: System Design weight increases to 30%; Technical Depth to 30%.
- Frontend roles: Communication and product-sense questions increase; System Design reduces to 10%.
- AI/ML roles: Adds an "Evaluation Methodology" sub-dimension (how the candidate validates model/scoring quality) at 15%, drawn from the overall Technical Depth weight.
- Client Delivery roles: Communication weight increases to 30%; System Design reduces to 10%.`,
  ),
  chunk(
    'Interview_Framework.pdf - 3. AI Interview Session Structure',
    KnowledgeSourceType.OTHER,
    `Warm-up (~3 min): Background confirmation, role expectations recap
Technical / Behavioral Core (~25 min): Dynamic question set drawn from the role-family bank, adjusted by earlier answers
Scenario Round (~10 min): One open-ended, role-relevant scenario question
Wrap-up (~2 min): Candidate Q&A capture (routed to HR, not answered live)`,
  ),
  chunk(
    'Interview_Framework.pdf - 4. Grading Standard',
    KnowledgeSourceType.OTHER,
    `- Each answer is graded against the competency dimensions relevant to the question, with a 1–5 score plus a 1–3 sentence justification string.
- Dimension scores roll up into a single overall interview score (0–100) using the role-family weights above.
- The overall score, per-dimension breakdown, and justification text all appear on the HR scoreboard — never just the final number.`,
  ),
  chunk(
    'Interview_Framework.pdf - 5. Human Panel Interviews (Senior/Leadership Roles)',
    KnowledgeSourceType.OTHER,
    `Roles at L4 and above (Tech Lead, Engineering Manager, and up) include at least one human panel round in addition to the automated stage. Panels use the same rubric so scores remain comparable across the hiring funnel.
- Minimum 2 panelists, at least one from outside the hiring manager's direct reporting line.
- Panel notes are submitted within 24 hours of the interview, using the same 1–5 + justification format.
- Panel and AI-stage scores are shown side by side on the scoreboard for leadership-track requisitions.`,
  ),
  chunk(
    'Interview_Framework.pdf - 6. Calibration',
    KnowledgeSourceType.OTHER,
    `- Question banks and the AI grading model are recalibrated quarterly against a held-out set of human-labeled sample interviews.
- Any dimension where AI and human scores diverge by more than 1 point on average triggers a review by the Talent Lead and AI & Data Tech Lead.`,
  ),

  // --- Recruitment_Guidelines.pdf ---
  chunk(
    'Recruitment_Guidelines.pdf - 1. Raising a Requisition',
    KnowledgeSourceType.OTHER,
    `- Any Engineering Manager or Tech Lead may submit a plain-language hiring need through the HR Dashboard.
- Required inputs: role family, seniority level, team/pod, headcount, and any hard constraints (e.g. client-mandated stack, on-site requirement).
- The JD generator retrieves relevant context from the Engineering Wiki and Tech Stack Guide via RAG and drafts a company-customized Job Description.
- HR reviews the generated JD, may apply the optional manual edit override, then approves for posting.`,
  ),
  chunk(
    'Recruitment_Guidelines.pdf - 2. Posting & Syndication',
    KnowledgeSourceType.OTHER,
    `- Approved JDs publish automatically to the internal Candidate Portal.
- The system posts to LinkedIn via the Share/Publish API with an embedded tracking URL back to the Portal.
- Postings remain live until the requisition's "Hired" quota is met or HR manually closes it.`,
  ),
  chunk(
    'Recruitment_Guidelines.pdf - 3. Screening — The 80% Hard Gate',
    KnowledgeSourceType.OTHER,
    `Uploaded resumes (PDF/DOCX) are parsed into structured entities and semantically compared against the JD. This is a company-standard hard gate, not a per-requisition setting.
Advance: Match score ≥ 80% — Candidate proceeds to the automated AI interview
Reject: Match score < 80% — Immediate, polite rejection message; no further steps
Pods may not lower the 80% threshold without written sign-off from VP Engineering, since it is the company's baseline quality bar for the interview stage.`,
  ),
  chunk(
    'Recruitment_Guidelines.pdf - 4. Interview Stage',
    KnowledgeSourceType.OTHER,
    `- Advanced candidates receive a strict 48-hour window to complete the automated AI interview, with a reminder at the 24-hour mark.
- The interview module presents behavioral and technical questions dynamically, weighted per role family (see Interview_Framework.pdf for the rubric).
- On completion, the Candidate Portal status updates to "In Review" and an automated acknowledgment email is sent immediately.`,
  ),
  chunk(
    'Recruitment_Guidelines.pdf - 5. HR Decision Stage',
    KnowledgeSourceType.OTHER,
    `- HR views the scoreboard: candidate name, contact, match %, interview score, and per-skill justification text.
- Three action buttons are available per candidate: Selection Email, Next Round Email, Rejection Email.
- Engineering Managers have read-only access to sanity-check scores for their own team's requisitions before HR sends decisions.`,
  ),
  chunk(
    'Recruitment_Guidelines.pdf - 6. Smart Closure',
    KnowledgeSourceType.OTHER,
    `- The system tracks the count of candidates marked "Hired" against the requisition's headcount target.
- On reaching target: the listing is unpublished from the Candidate Portal and removed from LinkedIn via API.
- All remaining active or pending candidates in the pool automatically receive a standardized, courteous rejection email — no candidate is left without a response.`,
  ),
  chunk(
    'Recruitment_Guidelines.pdf - 7. Fairness & Escalation',
    KnowledgeSourceType.OTHER,
    `- Any candidate may request human review of an automated rejection by replying to the rejection email; People Operations responds within 5 business days.
- Match scoring and interview grading must remain explainable — the underlying percentage/score and rationale are logged and auditable per FR-SEC and data-privacy policy.`,
  ),

  // --- Security_Policies.pdf ---
  chunk(
    'Security_Policies.pdf - 1. Access Control',
    KnowledgeSourceType.OTHER,
    `- All application routes are protected by JWT-based auth with Role-Based Access Control (RBAC).
- Unauthorized access attempts (e.g. a candidate account calling an HR-only endpoint) must return an immediate 403 Forbidden and generate a logged, alertable security event.
- Access to production systems requires SSO + hardware-key MFA; no shared credentials, ever.
- Access reviews run quarterly; any account inactive for 90 days is automatically suspended.`,
  ),
  chunk(
    'Security_Policies.pdf - 2. Data Classification',
    KnowledgeSourceType.OTHER,
    `Restricted (candidate resumes, interview transcripts, salary data): Encrypted at rest & in transit; access logged per-record
Confidential (internal wikis, source code, roadmaps): Employee-only access, no external sharing
Internal (team schedules, non-sensitive docs): Company-wide access
Public (job postings, marketing content): No restriction`,
  ),
  chunk(
    'Security_Policies.pdf - 3. Candidate & Employee Data Handling',
    KnowledgeSourceType.OTHER,
    `- Resume and interview data is retained for 12 months post-decision, then automatically purged by a scheduled job.
- Only HR Managers and the assigned Engineering Manager for a requisition may view a candidate's AI interview score and justification text.
- Rejected-candidate data is anonymized in analytics dashboards after 90 days.
- Any AI-driven decision that filters out a candidate (e.g. the semantic match hard gate) must remain explainable — the matching percentage and rationale are logged and auditable.`,
  ),
  chunk(
    'Security_Policies.pdf - 4. Application Security',
    KnowledgeSourceType.OTHER,
    `- All new endpoints undergo a security review checklist before merge (input validation, authz check, rate limiting).
- Dependency scanning runs in CI on every PR; critical/high vulnerabilities block merge.
- Secrets are stored only in the internal vault; never in code, config files, or chat.
- LLM-facing endpoints validate and sanitize all user-supplied content before it is included in a prompt, to prevent prompt-injection from resume content or free-text answers.`,
  ),
  chunk(
    'Security_Policies.pdf - 5. Incident Response',
    KnowledgeSourceType.OTHER,
    `- Any suspected data exposure involving candidate or employee PII is escalated to Security & Compliance within 1 hour of discovery.
- Confirmed incidents trigger the incident response runbook: containment, root-cause, notification (legal/People Ops), and a blameless postmortem within 3 business days.
- Regulatory notification timelines (where applicable) are owned by Legal, not Engineering.`,
  ),
  chunk(
    'Security_Policies.pdf - 6. Device & Endpoint Policy',
    KnowledgeSourceType.OTHER,
    `- Company devices run full-disk encryption and an MDM agent by default.
- No production credentials or candidate data may be stored on personal devices.
Note: This policy is audited annually against SOC 2 Type II controls; exceptions require Security & Compliance sign-off and a documented compensating control.`,
  ),

  // --- Tech_Stack_Guide.pdf ---
  chunk(
    'Tech_Stack_Guide.pdf - 1. Approved Stack by Layer',
    KnowledgeSourceType.STACK_PREFERENCE,
    `Backend (core services): Node.js + NestJS + TypeScript — Node 20 LTS; strict TS config
Backend (AI/ML services): Python + FastAPI — Python 3.11+; Pydantic v2
Primary Database: PostgreSQL — v15+; pgvector extension enabled for embeddings
Cache / Queue: Redis + BullMQ (Node) / Celery (Python) — Redis 7+
ORM: Prisma (TS) / SQLAlchemy (Python) — Prisma 5+
Frontend: React + TypeScript + Vite — React 18+; Tailwind CSS for styling
Auth: JWT + RBAC — OAuth2 for third-party integrations
Cloud: AWS — ECS/Fargate, S3, CloudWatch
IaC: Terraform — No manual console changes in production
CI/CD: GitHub Actions — Test + lint gates mandatory before merge
Observability: Sentry + structured logging + PagerDuty`,
  ),
  chunk(
    'Tech_Stack_Guide.pdf - 2. AI / RAG Stack',
    KnowledgeSourceType.STACK_PREFERENCE,
    `- Vector store: pgvector inside the same PostgreSQL instance — avoids operating a separate vector database for most workloads.
- Embeddings: generated per-document (wiki pages, policy docs, resumes) and re-generated whenever source content changes (tracked via content hash).
- LLM orchestration: structured-output prompting with strict JSON schemas for any decision-relevant output (JD text, match score + rationale, interview grading).
- Evaluation: every AI-driven scoring model ships with an offline evaluation harness and is recalibrated quarterly against human-labeled samples.`,
  ),
  chunk(
    'Tech_Stack_Guide.pdf - 3. Why This Stack (Rationale)',
    KnowledgeSourceType.STACK_PREFERENCE,
    `- TypeScript end-to-end (Node + React) keeps a single type system across most of the product, reducing integration bugs.
- Python/FastAPI is reserved for AI/ML workloads to use the mature Python ML/LLM ecosystem without spreading it across all services.
- pgvector avoids the operational overhead of a dedicated vector database while comfortably handling Nexora's current document/resume volume.
- Prisma's migration workflow keeps schema changes reviewable as code, which matters a lot for a system (like the recruitment pipeline) handling sensitive PII.`,
  ),
  chunk(
    'Tech_Stack_Guide.pdf - 4. Deprecated / Discouraged',
    KnowledgeSourceType.STACK_PREFERENCE,
    `Redux: Discouraged for new code — Migrate to Zustand (local state) + React Query (server state)
Create React App: Deprecated — Migrate to Vite
MongoDB (for new services): Discouraged — Migrate to PostgreSQL, unless a documented case for a document store exists
Manual AWS console changes: Not permitted in production — Migrate to Terraform`,
  ),
  chunk(
    'Tech_Stack_Guide.pdf - 5. Proposing a New Technology',
    KnowledgeSourceType.STACK_PREFERENCE,
    `Any addition to the approved stack requires a short RFC (problem, alternatives considered, rollout/rollback plan) reviewed by the relevant Tech Lead and VP Engineering. Approved additions are logged here so job descriptions and onboarding docs generated from this guide stay accurate.`,
  ),

  // --- Company_Handbook.pdf ---
  chunk(
    'Company_Handbook.pdf - 2. Company Overview',
    KnowledgeSourceType.OTHER,
    `Nexora Systems is a mid-sized product engineering company (founded 2016, ~420 employees) building cloud-native SaaS platforms for logistics, fintech, and HR-tech clients. Headquartered in Lahore, Pakistan, with a distributed engineering pod in Dubai and a small go-to-market team in Austin, TX. Nexora operates three business units — Platform Engineering, AI & Data, and Client Delivery — united by a single engineering culture and a shared internal tooling stack.
Mission: To build dependable, automation-first software that removes repetitive work from businesses so their people can focus on judgment calls, not data entry.
Vision: To be the default engineering partner that mid-market companies in logistics, fintech, and HR-tech turn to when a manual process needs to become a reliable, automated one.
Organizational levels L1 (CEO) through L6 (Intern/Associate Engineer); Business units: Platform Engineering (~180 headcount), AI & Data (~60), Client Delivery (~120), People & Operations (~40), Go-to-Market (~20, Austin TX).`,
  ),
  chunk(
    'Company_Handbook.pdf - 3. Equal Employment Opportunity & Anti-Discrimination',
    KnowledgeSourceType.OTHER,
    `Nexora Systems provides equal employment opportunity to all employees and applicants without regard to race, color, religion, sex, national origin, age, disability, genetic information, marital status, or any other status protected by applicable law in the jurisdiction where an employee works. This policy applies to every stage of employment: recruitment, hiring, promotion, compensation, training, discipline, and termination. Hiring decisions — including those informed by the automated screening and interview scoring in the AI Recruitment Pipeline — must be based solely on job-related criteria. Retaliation against anyone who reports a concern in good faith is strictly prohibited.`,
  ),
  chunk(
    'Company_Handbook.pdf - 4. Employment Classification & Terms',
    KnowledgeSourceType.OTHER,
    `Full-Time: ~40 hrs/week — Full benefits package
Part-Time: under 30 hrs/week — Prorated / limited benefits per local law
Fixed-Term Contract: Engaged for a defined project or period — As specified in the contract
Intern: Structured 3–6 month rotation, guided by a mentor — Stipend; limited benefits
Standard probation: 3 months for full-time hires, extendable once by 1 month with written justification. Notice period: 30 days for confirmed employees, 7 days during probation.`,
  ),
  chunk(
    'Company_Handbook.pdf - 6. Workplace Policies',
    KnowledgeSourceType.OTHER,
    `Core collaboration hours: 11:00 AM – 4:00 PM local pod timezone; flexible outside this window. Hybrid-first: 2 in-office days/week for Lahore & Dubai pods; fully remote roles are explicitly labeled in the requisition. No formal dress code for day-to-day work.
AI Acceptable Use: Company-approved AI tools may be used for drafting, code assistance, and research. Restricted or client-confidential data, candidate PII, and unreleased source code must not be pasted into public/consumer AI tools not covered by a company data-processing agreement. AI-generated content used in client deliverables, job descriptions, or public communications must be reviewed by a human before publishing — automation informs decisions here, it does not have unsupervised final say on anything customer- or candidate-facing.`,
  ),
  chunk(
    'Company_Handbook.pdf - 13. Confidentiality, Intellectual Property & Data Privacy',
    KnowledgeSourceType.OTHER,
    `All proprietary information — source code, client data, candidate data, financials, roadmaps — is confidential and must not be disclosed outside the company. Candidate and employee personal data is handled per Security_Policies.pdf: encrypted at rest, access-logged, and retained only as long as necessary (12 months post-decision for candidate data, then purged).`,
  ),
  chunk(
    'Company_Handbook.pdf - 14. Engineering Stack & Preferences',
    KnowledgeSourceType.STACK_PREFERENCE,
    `Backend (core): Node.js + NestJS + TypeScript; Prisma ORM
Backend (AI/ML): Python + FastAPI; Pydantic v2
Database: PostgreSQL with pgvector for embeddings/semantic search
Frontend: React + TypeScript + Vite + Tailwind CSS
Auth: JWT-based auth with Role-Based Access Control (RBAC)
Cloud/Infra: AWS (ECS/Fargate, S3, CloudWatch), Terraform, GitHub Actions`,
  ),
  chunk(
    'Company_Handbook.pdf - 15. Hiring & Internal Mobility',
    KnowledgeSourceType.OTHER,
    `External hiring runs through the AI Recruitment Pipeline described in Recruitment_Guidelines.pdf: RAG-driven JD generation, an 80% semantic match hard gate, a 48-hour AI interview window, and HR-driven Select/Next-Round/Reject decisions with automated smart closure. Internal candidates may apply after 12 months in their current role (or earlier with manager sign-off), skip the resume hard-gate, but still complete the standard interview framework.`,
  ),
];
