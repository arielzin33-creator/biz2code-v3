# biz2code

Answer four gated phases about a software idea and the app generates an MRD, a PRD and a
Business Plan as DOCX files. Runs entirely on your own machine.

React + TypeScript (Vite) · Node + Express · PostgreSQL · Groq

## Why I built it

Jumping straight from "idea" to "code" is exactly how AI-assisted tools produce confident,
wrong output — there's no spec to hold the generation accountable to. biz2code forces the
opposite order: an idea has to clear a Market Requirements Document, then a Product
Requirements Document, then a Business Plan, with a human approving each phase before the
next one starts.

## What I did

Solo build, end to end — architecture, phase-gate logic, and the full stack
(Node.js/Express/TypeScript, PostgreSQL, React, JWT auth). I defined the trust boundary
separating deterministic computation from LLM narration: a market-sizing (TAM/SAM/SOM)
module and a 12-formula revenue model compute before any figure reaches the AI layer, with
confidence-tier propagation preventing invented numbers from reaching a document. A
database-enforced citation guardrail limits the system to an allow-list of external data
sources, with explicit labeling of unvalidated or conflicting data rather than silent gaps.

## The challenge

Designing the phase-gate logic itself — each stage needed explicit human approval before
the next could generate, which meant the state machine had to be strict about what
"approved" means and prevent a rejected phase from silently leaking into later documents.

## Result

Shipped as my bootcamp capstone: a working pipeline that takes a raw idea through four
human-approved phases and out the other side as a generated MRD, PRD and Business Plan,
backed by an internal test suite and documented architecture decisions (ADRs).

---

## Requirements

- Node.js 20 or newer
- PostgreSQL 14 or newer
- A free Groq API key from https://console.groq.com/keys

On Windows, the PostgreSQL installer does not always put `psql` on your PATH. If
`psql --version` fails, add `C:\Program Files\PostgreSQL\<version>\bin` to PATH and open a
new terminal.

## Setup

```bash
npm install
createdb biz2code
cp .env.example .env
```

Then open `.env` and set the three required values:

```ini
DATABASE_URL=postgres://localhost:5432/biz2code
JWT_SECRET=any-long-random-string
GROQ_API_KEY=gsk_your_key_here
```

Everything else in the file is optional and can stay blank. If your Postgres needs a
password, the URL looks like `postgres://postgres:yourpassword@localhost:5432/biz2code`.

Create the tables and load the example project:

```bash
npm run db:init      # applies the migrations
npm run db:seed      # optional, loads the example project and its cached API responses
```

`db:init` is safe to re-run. Both scripts read `DATABASE_URL` from `.env`, so don't try to
apply the SQL by hand with `psql "$DATABASE_URL"` — that variable isn't in your shell.

## Run

```bash
npm run dev
```

The API starts on port 3001 and the client on 5173. Open http://localhost:5173, register an
account (it is local to your database, any email works), then start a new project or load the
example. `Ctrl+C` stops both.

Check it came up:

```bash
curl http://localhost:5173/api/health
# {"ok":true,"service":"biz2code"}
```

Longer walkthrough and troubleshooting: [INSTALL.md](INSTALL.md).
