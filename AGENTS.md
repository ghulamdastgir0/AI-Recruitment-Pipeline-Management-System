# AGENTS.md

Guidance for AI coding agents working in this repo. See [README.md](README.md)
for the full feature/architecture writeup — this file is the condensed,
agent-facing version: where things live, how to run/test them, and
conventions that aren't obvious from reading a single file in isolation.

## Monorepo layout

Two independent npm projects, no workspace tooling tying them together —
`cd` into each before running its scripts.

```
backend/    NestJS + Prisma + PostgreSQL (pgvector) API — http://localhost:3000
frontend/   Next.js 16 / React 19 app     — http://localhost:3001
```

`frontend/AGENTS.md` carries its own note: this repo pins a Next.js version
with breaking changes vs. training data — read
`frontend/node_modules/next/dist/docs/` before writing Next.js code that
relies on prior knowledge of the framework.

## Commands

**backend/** (run from `backend/`):
```bash
npm run start:dev     # dev server, watch mode
npm run lint           # eslint --fix
npm run format          # prettier --write
npm run test             # jest unit tests
npm run test:e2e          # jest e2e (test/jest-e2e.json)
npm run test:cov           # jest with coverage
npx prisma migrate dev    # after editing prisma/schema.prisma
```

**frontend/** (run from `frontend/`):
```bash
npm run dev     # dev server on :3001
npm run lint      # eslint
npm run build      # production build — run before declaring a frontend change done
```

Postgres runs in Docker with pgvector on port `5433` (native Postgres on
`5432`, if any, is left untouched):
```bash
docker run -d --name rms_pgvector -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=rms_db -p 5433:5432 pgvector/pgvector:pg17
```

## Backend structure (`backend/src/`)

| Module | Responsibility |
|---|---|
| `assistant/` | Tool-calling recruitment chatbot + confirmation flow (`PendingAssistantAction`) |
| `auth/` | JWT auth, role guards |
| `candidates/` | CV upload, LLM parsing, embedding |
| `documents/` | Company policy RAG (upload, chunk, embed, chat) |
| `hiring-decisions/` | Manager review + final HR decision workflow |
| `interviews/` | AI interview WebSocket gateway, proctoring, grading |
| `job-postings/` | Job CRUD, AI generation, LinkedIn publishing |
| `matching/` | Semantic scoring, ranking, explainability |
| `shared/` | Embeddings, LLM client (Groq + Gemini), email, PDF parsing, background jobs |

## LLM providers

- **Groq** (`shared/llm/llm-client.service.ts`) is the primary chat-completion
  provider — shared default model in `DEFAULT_MODEL`, overridable per-call or
  via `GROQ_MODEL`/`GROQ_CV_PARSER_MODEL` env vars. Groq also serves STT
  (Whisper) and TTS for interviews.
- **Gemini** (`shared/llm/gemini-client.service.ts`) backs the HR/Manager
  assistant via LangGraph — see memory note on its tool-schema quirks before
  touching `assistant/`.
- The CV parser (`candidates/services/cv-parser.service.ts`) intentionally
  overrides the shared default model — the default has previously confabulated
  fictional resume data on this specific task. Don't "simplify" it back to the
  shared default without re-verifying against a real CV.
- Groq model names are vendor-controlled and get decommissioned on short
  notice (weeks, not months). If a Groq call starts failing, check whether the
  configured model name is still listed at console.groq.com before assuming a
  code bug.

## Conventions

- Single-tenant, three staff roles enforced via JWT guards on every request:
  `SUPER_ADMIN`, `HR_ADMIN`, `HIRING_MANAGER` (scoped, read+comment only).
  Candidates never authenticate — public apply form + application-ID status
  lookup only.
- Any mutating action the assistant LLM proposes (publish, delete, status
  change) must be staged as a `PendingAssistantAction`, never executed
  directly by the LLM tool call — confirmation happens through a plain
  non-LLM endpoint.
- Embeddings (résumé, job description, policy chunks) are computed **locally**
  via `@huggingface/transformers` (Xenova/all-MiniLM-L6-v2, 384-dim) and
  stored as native pgvector columns — no external embedding API call, ever.
- CV parsing and document ingestion run as durable `BackgroundJob` rows, not
  in-memory tasks, so a restart mid-job doesn't strand a candidate in
  `PROCESSING`.
- Every assistant tool execution and confirmed/cancelled action is written to
  `AuditLog`, attributable to a real user — don't add a mutating code path
  that bypasses this.
