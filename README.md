# biz2code

Answer four gated phases about a software idea and the app generates an MRD, a PRD and a
Business Plan as DOCX files. Runs entirely on your own machine.

React + TypeScript (Vite) · Node + Express · PostgreSQL · Groq

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
