# File Index

What each file is for. The full rationale sits in the header of the file itself.

## client/

- `src/App.tsx` — Router and route guards
- `src/main.tsx` — React entry point; mounts providers
- `src/pages/PhasePage.tsx` — The main screen: a phase's questions and its gate
- `src/pages/ProjectsPage.tsx` — Project list and the New Project button
- `src/pages/DocumentsPage.tsx` — Generated documents: list, versions, download
- `src/pages/LoginPage.tsx` — Login and register
- `src/components/ApprovalGate.tsx` — Approve / Revise controls at the foot of a phase
- `src/components/PhaseStepper.tsx` — The four phases and the current position
- `src/components/QuestionField.tsx` — Renders one question by type: text, select, multiselect, number
- `src/components/UnvalidatedBadge.tsx` — Shows the guardrail wherever a figure could not be sourced
- `src/context/AuthContext.tsx` — Current user; exposes login/logout
- `src/hooks/useProject.ts` — Project queries and mutations
- `src/hooks/usePhase.ts` — Phase status, approve, revise
- `src/hooks/useAnswers.ts` — Answer fetch and autosave
- `src/hooks/useDocuments.ts` — Document list and download
- `src/lib/api.ts` — Fetch wrapper; always sends credentials
- `src/lib/types.ts` — Response types mirroring the API
- `playwright.config.ts` — Browser-test config; starts both servers itself
- `tests/journey.spec.ts` — The whole journey in a real browser

## server/

- `index.ts` — Process entry point; starts the HTTP listener
- `app.ts` — Builds the Express app: middleware chain and route mounting
- `config/env.ts` — Loads and validates environment variables once, at boot
- `db/pool.ts` — The single pg connection pool
- `db/query.ts` — Thin typed wrapper over pg
- `test/fakeDb.ts` — In-memory stand-in for `db/query.ts`; throws on undeclared SQL

### Routes and controllers

- `routes/auth.routes.ts` — `POST /register`, `/login`, `/logout`, `GET /me`
- `routes/project.routes.ts` — `GET/POST /projects`, `POST /projects/seed`, `GET /projects/:projectId`
- `routes/phase.routes.ts` — `GET /phases`, `/phases/:phaseNo`, `POST /phases/:phaseNo/approve`, `/revise`
- `routes/answer.routes.ts` — `GET/POST /projects/:projectId/answers`
- `routes/document.routes.ts` — `POST /projects/:id/generate`, `GET /documents`, `GET /documents/:id/download`
- `controllers/*.controller.ts` — Parse requests and shape responses for the matching routes

### Middleware

- `middleware/auth.ts` — Verifies the JWT from the httpOnly cookie, attaches `req.userId`
- `middleware/project.ts` — Resolves `:projectId`, checks ownership, attaches `req.project`
- `middleware/validate.ts` — Shape checks on request bodies
- `middleware/async.ts` — Wraps async handlers so a rejected promise reaches the error handler
- `middleware/error.ts` — Single error handler, last in the chain

### Services

- `services/gate.service.ts` — The gate. The only module allowed to mutate `phases.status` or `projects.current_phase`
- `services/calculation.service.ts` — Deterministic economics, 11 formulas. The LLM never does arithmetic
- `services/benchmark.service.ts` — Loads `benchmarks/*.json`, resolves a metric for a vertical, falls back cross-vertical
- `services/generation.service.ts` — Orchestrates MRD → PRD → Business Plan, then renders DOCX
- `services/llm.service.ts` — Groq client: JSON mode, one retry, Gemini fallback, hard timeout, budget-aware
- `services/docx.service.ts` — Renders sections into `MRD_v1.docx`, `PRD_v1.docx`, `BusinessPlan_v1.docx`
- `services/external.service.ts` — World Bank and iTunes clients, cached in `external_cache`
- `services/answer.service.ts` — Upserts answers, typed by question kind
- `services/auth.service.ts` — Register, login, token issuance
- `services/project.service.ts` — Create and list projects; loads the seed project
- `services/questionBank.service.ts` — Loads and indexes `question-bank.json`
- `services/competitorTerms.ts` — Turns the p2q4 answer into App Store search terms

Unit tests sit beside the service they cover as `*.service.test.ts`.

### Prompts

- `prompts/context.ts` — Assembles the permitted context and the allow-list of citable sources
- `prompts/documents.ts` — One template per document: fields, JSON shape, output size

### Scripts

- `scripts/checkpoint-day2.ts` — A full 4-phase run, approved end to end, over HTTP
- `scripts/checkpoint-day3.ts` — Seed answers to correct numbers and correct unvalidated flags
- `scripts/checkpoint-day4.ts` — Three DOCX files that unzip cleanly, with provenance and v2
- `scripts/checkpoint-day5.ts` — The whole journey through the Vite proxy
- `scripts/rehearse.ts` — Demo Day's exact sequence, with the talking points checked
