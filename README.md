# AI Recruitment Pipeline Management System

An end-to-end, largely autonomous recruitment platform. HR describes a role in a
sentence and the system generates the job posting, screens every incoming CV
with semantic matching, conducts a fully AI-driven proctored interview, grades
it per-skill, and routes the candidate through hiring-manager review — all
without a human interviewer or manual resume screening in the loop.

Built as a full-stack TypeScript monorepo: a **NestJS + Prisma + PostgreSQL
(pgvector)** backend, a **Next.js 16 / React 19** frontend, and **Groq**-hosted
LLMs for generation, extraction, and interview STT/TTS.

## Table of Contents

- [Key Features](#key-features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Running the App](#running-the-app)
- [Testing](#testing)
- [API Documentation](#api-documentation)
- [Roles & Access Control](#roles--access-control)

## Key Features

### AI-Generated Job Postings
HR supplies a one-line prompt; a RAG-grounded LLM pipeline generates a full
job description (responsibilities, required/preferred skills, summary), which
HR can edit before publishing. Published postings can be shared to LinkedIn
with a tracked application URL and auto-removed on closure.

### Semantic CV Screening
Uploaded CVs are parsed (PDF text extraction + LLM schema extraction for
name/skills/experience/education), embedded locally (384-dim vectors via
`@huggingface/transformers`, no external API), and matched against the job's
embedding and structured requirements. Each match produces an explainable
score with per-category breakdown, matched/missing skills, and cited
evidence — candidates scoring above the gate threshold advance automatically.

### Conversational Recruitment Assistant
An HR-facing chatbot (tool-calling LLM agent) can create/update/publish job
postings, upload and score CVs, rank candidates, assign hiring managers, and
answer questions against company policy documents (RAG over uploaded PDFs).
Any mutating action (publish, delete, status change) is never executed
directly by the LLM — it's staged as a `PendingAssistantAction` and only runs
after explicit HR confirmation through a plain, non-LLM endpoint.

### Fully Automated AI Interviews
Once a candidate clears the screening gate, a 48-hour interview window opens.
The interview itself is a real-time, AI-conducted session over WebSockets:
questions are generated per-skill (with LLM-driven follow-ups), read aloud via
Groq TTS, answered by voice and transcribed via Groq STT (Whisper), and graded
per-skill with a justification — no human interviewer involved.

### Live Interview Proctoring
While the interview is active, the browser client runs:
- **Face & gaze tracking** (MediaPipe Tasks Vision) — detects a missing face,
  multiple faces, and sustained looking-away/eyes-closed patterns.
- **Object detection** (TensorFlow.js COCO-SSD) — flags a visible phone.
- **Environment enforcement** — fullscreen exit, tab switch/window blur,
  disabled camera/mic, and blocked keyboard shortcuts are all detected and
  logged.
- A shared warning budget escalates through toasts and forces submission of
  the interview after repeated violations; every violation is persisted
  (`InterviewViolation`) for HR review, including a distinct "forced
  termination" reason on the transcript.

### Hiring Workflow & Decisions
Post-interview candidates land `IN_REVIEW`; HR can route a candidate to an
assigned **Hiring Manager** (scoped access — only their assigned postings,
read + comment only) for feedback before making a final Select / Next Round /
Reject call. Every decision triggers the appropriate templated email and, on
reaching the job's hiring quota, the posting auto-closes with bulk rejection
of remaining candidates.

### Automated Communications & Audit Trail
All transactional email (application received, screening rejection, interview
invite/reminder, decision outcomes, offer letter) is sent via Brevo and logged
per-application. Every assistant tool execution and confirmed/cancelled
action is written to an `AuditLog`, attributable to a real user.

### Resilient Background Processing
CV parsing/embedding and document ingestion run as durable `BackgroundJob`
rows rather than in-memory tasks, so a process restart mid-job doesn't leave a
candidate's status stuck in `PROCESSING`.

## Architecture

```
┌─────────────────────┐        REST + WebSocket        ┌──────────────────────────┐
│  Next.js Frontend    │ ──────────────────────────────▶│   NestJS Backend          │
│  (staff dashboard,    │                                 │   (Express, Socket.io)    │
│   public job/apply     │◀──────────────────────────────│                            │
│   pages, AI interview) │        JSON / audio streams    │                            │
└─────────────────────┘                                 └───────────┬──────────────┘
                                                                       │
                        ┌──────────────────────────────────────────┼───────────────────────────┐
                        ▼                                          ▼                            ▼
             ┌────────────────────┐                    ┌─────────────────────┐      ┌────────────────────┐
             │ PostgreSQL +        │                    │ Groq LLM APIs        │      │ Brevo Email API     │
             │ pgvector (Prisma)   │                    │ (chat / STT / TTS)   │      │ (transactional mail)│
             └────────────────────┘                    └─────────────────────┘      └────────────────────┘
```

Embeddings (résumé, job description, policy-document chunks) are computed
**locally** via `@huggingface/transformers` (Xenova/all-MiniLM-L6-v2,
384-dim) and stored as native `vector` columns in Postgres, so semantic search
never leaves the machine or costs an API call. Generation, extraction, and
grading use Groq-hosted models.

## Tech Stack

**Backend**
- [NestJS 11](https://nestjs.com/) (Express, WebSockets via `@nestjs/websockets` + Socket.io)
- [Prisma 7](https://www.prisma.io/) with the `postgresqlExtensions` preview feature (pgvector)
- PostgreSQL + [pgvector](https://github.com/pgvector/pgvector)
- [Groq](https://groq.com/) — chat completion, Whisper STT, TTS
- `@huggingface/transformers` — local embedding generation
- `@langchain/core` / `@langchain/langgraph` — RAG orchestration
- JWT auth (`@nestjs/jwt`), `bcryptjs`, `class-validator`
- `@nestjs/schedule` — cron sweeps (interview reminders, pending-action expiry)
- `@nestjs/swagger` — OpenAPI docs

**Frontend**
- [Next.js 16](https://nextjs.org/) (App Router) + React 19
- Tailwind CSS 4
- `@mediapipe/tasks-vision` — face/gaze tracking
- `@tensorflow/tfjs` + `@tensorflow-models/coco-ssd` — phone/object detection
- `socket.io-client` — live interview session transport

## Project Structure

```
.
├── backend/                  NestJS API
│   ├── prisma/schema.prisma  Data model (see below)
│   └── src/
│       ├── assistant/        Tool-calling recruitment chatbot + confirmation flow
│       ├── auth/             JWT auth, role guards
│       ├── candidates/       CV upload, parsing, embedding
│       ├── documents/        Company policy RAG (upload, chunk, embed, chat)
│       ├── hiring-decisions/ Manager review + final HR decision workflow
│       ├── interviews/       AI interview WebSocket gateway, proctoring, grading
│       ├── job-postings/     Job CRUD, AI generation, LinkedIn publishing
│       ├── matching/         Semantic scoring, ranking, explainability
│       └── shared/           Embeddings, LLM client, email, PDF parsing, background jobs
└── frontend/                 Next.js app
    ├── app/
    │   ├── staff/             HR/Admin/Hiring-Manager dashboard (role-gated)
    │   ├── jobs/[jobId]/      Public job posting + apply page
    │   ├── interview/         Candidate-facing AI interview session
    │   └── status/            Candidate application status lookup
    ├── components/interview/ Camera, transcript, proctoring UI
    ├── components/assistant/ Chat UI for the recruitment assistant
    └── hooks/                 useInterviewMonitoring, useEyeTracking, etc.
```

## Getting Started

### Prerequisites
- Node.js 20+
- PostgreSQL with the `vector` extension (a Docker `pgvector/pgvector` image
  is the easiest route — see below)
- A [Groq API key](https://console.groq.com/) (chat + STT + TTS)
- A [Brevo](https://www.brevo.com/) API key for transactional email

### 1. Clone & install

```bash
git clone https://github.com/ghulamdastgir0/AI-Recruitment-Pipeline-Management-System.git
cd AI-Recruitment-Pipeline-Management-System

cd backend && npm install
cd ../frontend && npm install
```

### 2. Start Postgres with pgvector

```bash
docker run -d --name rms_pgvector \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=rms_db \
  -p 5433:5432 \
  pgvector/pgvector:pg17
```

Running on port `5433` keeps a native local Postgres install (if any) on
`5432` untouched.

### 3. Configure environment variables

Copy the example env files and fill in your values:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

See [Environment Variables](#environment-variables) below for what each key
does.

### 4. Migrate & seed the database

```bash
cd backend
npx prisma migrate deploy
npm run db:seed   # bootstraps the first SUPER_ADMIN login from SEED_ADMIN_EMAIL/PASSWORD
```

## Environment Variables

**backend/.env**

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string (pgvector-enabled) |
| `CORS_ORIGIN` | Allowed browser origin for the frontend |
| `PUBLIC_APP_URL` | Frontend base URL, used to build links in emails |
| `GROQ_API_KEY` / `GROQ_API_URL` | Groq chat completions |
| `GROQ_CV_PARSER_MODEL` | Model used specifically for CV extraction (`gpt-oss-20b`; verified more reliable than the default chat model for grounding on the actual CV text) |
| `GROQ_STT_API_URL` / `GROQ_STT_MODEL` | Whisper speech-to-text for interview answers |
| `GROQ_TTS_API_URL` / `GROQ_TTS_MODEL` / `GROQ_TTS_VOICE` | Text-to-speech for interview questions |
| `DOCUMENT_STORAGE_DIR` / `CV_STORAGE_DIR` / `INTERVIEW_AUDIO_STORAGE_DIR` | Local disk storage paths |
| `JWT_SECRET` / `JWT_EXPIRES_IN` | Auth token signing |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | First admin login, used once by `db:seed` |
| `SMTP_API` / `BREVO_SENDER_EMAIL` / `BREVO_SENDER_NAME` | Brevo transactional email |

**frontend/.env.local**

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | Backend base URL (REST + derived WebSocket URL) |
| `NEXT_PUBLIC_COMPANY_NAME` | Company name shown on the public apply page (single-tenant system) |

## Running the App

```bash
# backend — http://localhost:3000
cd backend
npm run start:dev

# frontend — http://localhost:3001
cd frontend
npm run dev
```

## Testing

```bash
cd backend
npm run test        # unit tests
npm run test:e2e    # e2e tests
npm run test:cov    # coverage
```

## API Documentation

With the backend running, Swagger/OpenAPI docs are available at:

```
http://localhost:3000/api-docs
```

## Roles & Access Control

The system is single-tenant with three staff roles (enforced via JWT guards
on every request, not just at login):

| Role | Access |
|---|---|
| `SUPER_ADMIN` | Full access — user management, policy document RAG uploads, all jobs |
| `HR_ADMIN` | Day-to-day recruiting via the assistant — jobs, candidates, interviews, hiring decisions |
| `HIRING_MANAGER` | Read + comment only, scoped to job postings they've been explicitly assigned to |

There is no candidate-facing login — candidates apply via a public form and
track status by application ID; the entire pipeline from screening to
interview to decision is either automated or driven by HR/hiring-manager
action.
