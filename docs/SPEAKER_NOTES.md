# Speaker Notes — AI Recruitment Pipeline Management System

Talking points for a project defense / viva presentation. Organized as
slide-by-slide notes; adapt the slide breaks to your own deck. Each section
leads with what to *say*, then a **Why / anticipate** block with the
reasoning an examiner is likely to probe.

---

## 1. Title Slide

**Say:** "AI Recruitment Pipeline Management System — an end-to-end
recruitment platform that automates job description generation, CV
screening, technical interviewing, and hiring decisions using a
Retrieval-Augmented Generation architecture, with no human interviewer or
manual resume screening in the loop."

Name it as what it is: a full-stack TypeScript system — NestJS backend,
Next.js frontend, PostgreSQL with the pgvector extension, and Groq-hosted
LLMs.

---

## 2. Problem Statement

**Say:** Traditional recruitment pipelines have three bottlenecks:
1. Writing consistent, well-structured job descriptions takes HR time and
   produces inconsistent quality across postings.
2. Manually screening every CV against a job description doesn't scale and
   introduces reviewer bias/inconsistency.
3. Scheduling and conducting first-round technical interviews consumes
   interviewer time on candidates who may not be a fit.

**Say:** This system addresses all three by inserting AI at each stage while
keeping HR in control of every consequential decision (publish, reject,
hire) through an explicit confirmation step — the system recommends and
drafts, HR decides.

**Why / anticipate:** Be ready for "why not just have HR do X manually" —
answer: the system doesn't remove HR judgment, it removes repetitive
mechanical work (typing a JD from scratch, reading 200 CVs, scheduling a
first-round call) so HR time goes to review and decision-making instead.

---

## 3. Objectives / Scope

**Say the functional requirement groups** (these map directly onto the
system's modules and are referenced in code comments as FR- IDs):
- **FR-JOB** — AI-generated job postings from a one-line prompt, LinkedIn
  publishing.
- **FR-RES** — CV parsing/extraction and semantic resume-to-job matching.
- **FR-INT** — fully automated, proctored AI interview with a bounded
  completion window.
- **FR-HR** — HR scoreboard, hiring-manager review routing, and
  quota-driven auto-closure of postings.

**Say what's explicitly out of scope:** multi-tenant/multi-company support
(this is a single-company deployment — no `Company` entity), and any
candidate self-service portal/login (candidates apply anonymously via a
public form and track status by application ID only).

---

## 4. System Architecture

**Say, describing the diagram:**
- The **Next.js frontend** serves three audiences from one app: the public
  job-listing/apply pages (no login), the candidate-facing AI interview
  page, and the role-gated staff dashboard (Admin/HR/Hiring Manager).
- The **NestJS backend** exposes REST (via Swagger-documented controllers)
  plus one WebSocket gateway (`/interviews` namespace, Socket.io) for the
  live interview session — REST alone can't do turn-by-turn
  question/answer/audio streaming with low latency.
- **PostgreSQL + pgvector** is the single source of truth. Job, résumé, and
  policy-document embeddings all live as native `vector(384)` columns
  alongside their relational data — no separate vector database.
- **Groq** supplies generation (job descriptions, interview questions,
  grading), speech-to-text (Whisper, for candidate answers), and
  text-to-speech (for questions read aloud).
- **Brevo** sends every transactional email; every send is logged
  (`EmailLog`) against the application it belongs to.

**Why one database instead of a dedicated vector store:** pgvector keeps
embeddings transactionally consistent with the relational data they
describe (a candidate's skills, a job's requirements) — there's no
sync/consistency problem between two stores, and at this dataset scale
(single-company job postings and applicants) a dedicated vector database
would be unjustified operational overhead.

---

## 5. Why RAG, and Where It's Used

**Say:** Retrieval-Augmented Generation appears in three places, not one:
1. **Job description generation** — the LLM is grounded on the job's
   structured fields rather than hallucinating a generic template.
2. **Résumé/job semantic matching** — cosine similarity between the job's
   and candidate's 384-dim embeddings feeds into the experience subscore
   (see scoring, slide 7), catching semantic overlap that keyword matching
   alone would miss (e.g. "led a team of engineers" matching a
   "leadership" requirement without the literal word appearing).
3. **Company policy chatbot** — admin-uploaded HR policy PDFs are chunked,
   embedded, and retrieved to ground the assistant's answers to HR policy
   questions, instead of the LLM inventing policy.

**Why local embeddings instead of an embedding API:** `@huggingface/transformers`
running `Xenova/all-MiniLM-L6-v2` locally means embedding generation has no
per-call cost and no external dependency for a step that runs on every CV
upload and every document chunk — only generation/extraction/STT/TTS, which
need larger models, go to Groq.

---

## 6. Database Design Highlights

Walk through `backend/prisma/schema.prisma` selectively — don't read every
model, pick the ones with a design story:

- **`CandidateProfile.source` (`SELF_APPLIED` vs `HR_SOURCED`)** — the same
  profile model serves two intake paths (public apply form, and HR
  uploading a CV directly through the assistant) without two parallel
  tables.
- **`Application` unique constraints** — `@@unique([candidateProfileId,
  jobId])` and `@@unique([jobId, applicantEmail])` together let Postgres
  itself close a race condition: two concurrent uploads with the same email
  but different files each create their own `CandidateProfile` row, so an
  application-level "check then insert" can't catch the duplicate — only a
  DB constraint can.
- **`MatchResult` is append-only** — re-scoring a candidate never
  overwrites history; "the current score" is just the most recent row by
  `processedAt`. Same pattern as `Document` versioning below — every score
  a candidate ever received is auditable.
- **`Document` versioning** — re-uploading a policy PDF with the same name
  creates a new version rather than mutating the old one; the chatbot
  always retrieves from the single `ACTIVE` version while every prior
  version is retained for audit.
- **`PendingAssistantAction`** — see slide 8; this table is what makes
  "the LLM proposes, HR confirms" enforceable at the code level rather than
  just a prompt instruction.
- **`BackgroundJob`** — CV/document processing is a durable row
  (`QUEUED`/`PROCESSING`/`COMPLETED`/`FAILED`), not an in-memory
  `setTimeout`/promise — a process crash between "queued" and "processed"
  can't silently strand a candidate at `cvStatus: PROCESSING` forever.

**Anticipate:** "Why UUID primary keys, not auto-increment ints?" —
avoids leaking sequential IDs/row counts through public-facing URLs (e.g.
application status lookup), and merges cleanly if data ever needs to move
between environments.

---

## 7. Semantic Matching — the Scoring Model

**Say:** Each candidate/job pair gets a weighted composite score:

| Category | Weight |
|---|---|
| Required skills | 40% |
| Relevant experience | 25% |
| Preferred skills | 15% |
| Projects | 10% |
| Education | 10% |

- **Required/preferred skills**: fuzzy substring matching between job
  skill tags and the candidate's extracted skill list.
- **Relevant experience**: a blend — `0.6 × cosine-similarity(job
  embedding, résumé embedding) + 0.4 × (years / required years, capped at
  100)` — so both semantic fit and a literal years-of-experience floor
  count.
- **Projects**: keyword overlap between the job's skill pool and the
  candidate's project/certification text.
- **Education**: only scored if the job description actually states an
  education requirement (keyword-gated), so roles that don't care about a
  degree don't penalize candidates without one.

The output isn't just a number — it's an **explainable** result: a
per-criterion `evidence` list (`MATCHED`/`PARTIAL`/`MISSING`, each pointing
to the résumé page it came from), a `confidence` level, and a plain-language
`summary`. This is deliberate — a bare score isn't reviewable by HR; the
evidence trail is what makes the automated screening step auditable and
trustworthy.

**Say the gate:** candidates scoring ≥60 are automatically invited to the
AI interview (`INTERVIEW_SCORE_THRESHOLD`); this is a separate constant
from the `POTENTIAL_MATCH` classification band (65) used for HR's
dashboard labeling — one governs an automatic action, the other is just
informational, so they're allowed to diverge.

**Anticipate:** "Why not use a single LLM call to score the whole CV?" —
determinism and unit-testability. `computeMatch()` is a pure function with
no DB/LLM access (see `scoring.ts` header comment) — same inputs always
produce the same score, and it's directly testable against fixtures. The
LLM's job is upstream (extracting structured data from the CV text and
generating the job description), not scoring.

---

## 8. The Recruitment Assistant — Tool-Calling with a Safety Gate

**Say:** HR interacts with a chatbot that has real tools: create/update a
job posting, publish/pause/delete it, upload and score a CV, rank
candidates, assign a hiring manager, search company policy documents. This
is a genuine tool-calling agent, not a scripted flow.

**Say the safety design — this is the key design decision to defend:**
Any tool with a real-world side effect that's hard to undo (publishing a
job, deleting a posting, changing status) is never executed directly by the
LLM's tool call. Instead the orchestrator writes a `PendingAssistantAction`
row and returns a preview to HR. The action only actually runs when HR hits
confirm, which calls a **separate, non-LLM controller endpoint**
(`POST /assistant/actions/:id/confirm`). Pending actions also expire — a
scheduled sweep (`pending-action-sweep.service.ts`) marks stale ones
`EXPIRED` so a forgotten confirmation can't fire days later.

**Why:** LLM tool-calling is non-deterministic — the same prompt can
occasionally select or phrase a call differently. Letting the model
directly execute an irreversible action (publish, delete) means a
misinterpreted instruction becomes a real mutation with no human check.
Routing mutations through a human-confirmed, code-only path means the
worst a bad LLM call can do is *propose* the wrong thing, never *do* it.

Every tool execution and confirmed/cancelled action is also written to
`AuditLog`, attributed to the real user who triggered or confirmed it —
so "what did the AI actually do" is always answerable.

---

## 9. The AI Interview — Real-Time, No Human Interviewer

**Say the flow:**
1. Clearing the screening gate opens a 48-hour window
   (`INTERVIEW_WINDOW_HOURS`). A one-time reminder email fires if the
   candidate hasn't started 30 minutes after the window opens.
2. The interview runs live over a WebSocket (`interview.gateway.ts`), not
   REST polling — question delivery, answer submission, and proctoring
   signals all need low-latency, stateful, bidirectional communication.
3. Questions are generated per required skill, with the LLM able to ask a
   **follow-up** on the previous answer rather than only fixed questions
   (`AIInterviewQuestion.isFollowUp` + `targetSkillId` track this across
   what are otherwise independent HTTP/WebSocket turns).
4. Questions are synthesized to speech (Groq TTS) and read aloud; candidate
   answers are recorded, transcribed (Groq Whisper STT), and stored as both
   audio and text.
5. After the session, each skill gets a `CandidateSkillGrade`
   (proficiency score + a mandatory textual justification — never just a
   bare number) plus an overall session recommendation and summary.

**Why fully automated instead of AI-assisted (human still interviewing):**
this was a deliberate scope decision (see the schema comment: "interviewing
is fully automated... no self-service candidate portal/login has ever been
built") — it's the piece of the pipeline that scales worst for HR when done
manually, so it's the one fully removed from the human loop, while
higher-stakes decisions (hire/reject) stay human.

---

## 10. Interview Proctoring — Integrity Without a Human Watching

**Say:** Because no human is present to watch the candidate, the browser
client runs a proctoring layer during the session:

- **Face/gaze tracking** (MediaPipe Tasks Vision, client-side) — flags a
  missing face (>5s), multiple faces, and sustained looking-away (>10s
  past a ~20° threshold).
- **Object detection** (TensorFlow.js COCO-SSD) — flags a visible phone
  across consecutive frames to avoid one-frame false positives.
- **Environment enforcement** — fullscreen exit, tab switch/window blur,
  disabled camera/mic, blocked keyboard shortcuts, and a browser-close
  beacon are all detected.
- All violation types funnel through one `WarningManager` with a shared
  5-warning budget; exceeding it **forces submission** of the interview —
  and the resulting `AIInterviewSession.terminationReason` records that it
  was a forced stop, distinguishing it from a candidate naturally
  finishing, on the transcript HR reviews later.
- Every violation is persisted (`InterviewViolation`, never deleted) for
  audit, the same durability pattern as `EmailLog`/`AuditLog`.

**Anticipate — the interesting engineering tradeoff to volunteer:** face
detection was tuned to run at 5Hz (200ms interval), not the ~12Hz the spec
initially targeted. `detectForVideo()` runs synchronously on the main
thread; at higher frequency it started starving the WebSocket/audio
pipeline, tripping a 20-second answer-submit timeout on real hardware. 5Hz
is still ~10× finer than the 5-10 second violation thresholds actually
need, so it was the right trade — this is a good example to cite if asked
about performance decisions made under real-device testing rather than
just in theory.

**Anticipate — privacy/fairness question:** all detection runs client-side
(browser), and only discrete violation *events* (type + timestamp), not
continuous video, are sent to the backend — the raw camera feed is never
uploaded or stored.

---

## 11. Hiring Decision Workflow

**Say:** Post-interview, a candidate lands in `IN_REVIEW`. HR can route
them to `MANAGER_REVIEW` for an assigned Hiring Manager's input; once that
manager posts a comment and marks it reviewed (`MANAGER_REVIEWED`), HR
makes the final call: `SELECTED` / `NEXT_ROUND` / `REJECTED`. This is a
deliberate two-step gate — `HiringDecisionsService.decide()` requires
manager feedback to exist before HR's final decision proceeds, so a hiring
manager's input can't be silently skipped.

**Say quota-driven closure:** each job has a `hiringTarget`; once
`hiredCount` reaches it, the posting auto-closes and every remaining
open application is bulk-rejected with a templated email
(`BULK_REJECTION`) — HR doesn't have to manually reject a backlog once a
role is filled.

---

## 12. Role-Based Access Control

**Say the three roles and why there are only three:**
- `SUPER_ADMIN` — user management, policy document uploads, unrestricted.
- `HR_ADMIN` — day-to-day recruiting through the assistant.
- `HIRING_MANAGER` — read + comment only, and only on job postings they've
  been explicitly assigned to (`JobPostingHiringManager` join table,
  enforced by a dedicated guard) — not a blanket "manager" role with
  company-wide visibility.

**Say what was removed and why:** earlier iterations had `RECRUITER` and
`INTERVIEWER` roles; both were dropped once interviewing became fully
automated — there's no human interviewer to gate access for, and
recruiting work folded into `HR_ADMIN`.

**Say enforcement detail worth mentioning:** `isActive` is checked on
*every* authenticated request via `JwtAuthGuard`, not only at login — so
deactivating a user's access takes effect immediately rather than waiting
out their JWT's expiry window.

---

## 13. Testing Strategy

**Say:** Business-logic-heavy modules are unit tested with fixture data —
notably `scoring.spec.ts` (pure scoring function, no mocks needed since
`computeMatch()` has no DB/LLM dependency), `matching.service.spec.ts`,
`hiring-decisions.service.spec.ts`, `auth.service.spec.ts`,
`interview.gateway.spec.ts`, and the assistant's orchestrator and tool
registry. NestJS's dependency injection makes service-level unit testing
straightforward — Prisma and external clients are mocked at the module
boundary. `npm run test:e2e` covers the HTTP layer end-to-end; `npm run
test:cov` reports coverage.

---

## 14. Demo Script (suggested live walkthrough order)

1. **Login** as `HR_ADMIN` → staff dashboard.
2. **Create a job posting** via the assistant chat: give it a one-line
   prompt, show the generated description, edit a field, publish it — call
   out the confirmation step before publish actually fires.
3. **Open the public apply page** for that job (new tab/incognito, no
   login) and submit a CV.
4. Show the **CV processing → match score → evidence breakdown** on the HR
   dashboard once background processing completes.
5. If the candidate clears the gate, show the **interview invite email**
   and open the **interview page** — walk through camera/mic permission,
   fullscreen entry, and a question being asked/answered; briefly trigger
   a proctoring warning (e.g. look away, or open dev tools) to show the
   toast and warning count live.
6. Show the **completed transcript + per-skill grades** on the HR side.
7. Walk a candidate through **Manager Review → final decision**, and show
   the resulting email log entry.

Keep this to 6-8 minutes; narrate what's automated vs. what required a
click from you at each step, since that distinction is the thesis of the
project.

---

## 15. Limitations & Future Work

**Say honestly:**
- Single-tenant only — no multi-company/workspace concept.
- No candidate-facing account/login — status is looked up by application
  ID, which is simple but not a full candidate portal experience.
- Skill matching for the required/preferred skill buckets is
  fuzzy-substring, not embedding-based — a natural next step is
  per-skill semantic matching rather than composite résumé/job embeddings
  alone.
- Groq is a single LLM provider dependency for generation/STT/TTS — no
  fallback provider if it's unavailable.

**Future work to mention if asked:** multi-tenant support, richer
analytics/reporting dashboard, configurable scoring weights per job
(currently global constants), and a provider-agnostic LLM client layer.

---

## 16. Conclusion

**Say:** The system demonstrates a complete automated recruitment
pipeline — RAG-grounded generation, explainable semantic matching, a
tool-calling assistant with a hard safety gate on irreversible actions, and
a fully autonomous, proctored AI interview — while keeping every
consequential human decision (publish, hire, reject) behind explicit
confirmation and a full audit trail. The design throughout optimizes for
one principle: **AI proposes and automates the mechanical work; a human
confirms anything that can't be undone.**

---

## Anticipated Q&A Bank

- **"What stops the LLM from hallucinating a candidate's skills?"** — CV
  extraction uses a specific model (`gpt-oss-20b` via `GROQ_CV_PARSER_MODEL`)
  chosen after the default chat model was found to confabulate fictional
  résumé content; extraction is grounded on the actual parsed PDF text, and
  the scoring layer cites the résumé page each matched skill came from.
- **"Why Groq instead of OpenAI/Anthropic directly?"** — Groq's inference
  speed matters specifically for the live interview loop (question
  generation, STT, TTS all need to feel real-time to a candidate mid-session)
  and its API is OpenAI-compatible, so the integration surface stayed small.
- **"How do you prevent the assistant from publishing a job by mistake?"**
  — see slide 8, the `PendingAssistantAction` confirmation gate.
- **"How is interview integrity enforced without a human proctor?"** — see
  slide 10, the client-side detection + shared warning budget + forced
  submission.
- **"Why pgvector instead of Pinecone/Weaviate/a dedicated vector DB?"** —
  see slide 4 — transactional consistency with relational data, and no
  justified scale for a separate system at this dataset size.
- **"What happens if the process crashes mid-CV-processing?"** — see slide
  6, `BackgroundJob` durability — the job resumes/retries rather than being
  lost.
