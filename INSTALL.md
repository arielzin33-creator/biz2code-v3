# Installing biz2code

Everything runs locally. No container, no hosting step.

## 1. Prerequisites

- Node.js 20 or newer (`node -v`)
- PostgreSQL 14 or newer (`psql --version`)
- Git, any version (`git --version`)

You also need a free Groq API key from https://console.groq.com/keys.

On Windows the PostgreSQL installer does not always put `psql` on the PATH. If
`psql --version` fails, re-run the installer with *Command Line Tools* ticked, or add
`C:\Program Files\PostgreSQL\<version>\bin` to PATH and open a new terminal.

## 2. Get the code

```bash
git clone <repository-url> biz2code
cd biz2code
npm install
```

`npm install` covers all three workspaces (root, `server`, `client`).

## 3. Create the database

```bash
createdb biz2code
```

Or, if `createdb` isn't available:

```bash
psql -U postgres -c "CREATE DATABASE biz2code;"
```

Step 5 creates the tables.

## 4. Configure

```bash
cp .env.example .env          # macOS / Linux / Git Bash
copy .env.example .env        # Windows CMD
```

Set three values in `.env`:

```ini
DATABASE_URL=postgres://localhost:5432/biz2code
JWT_SECRET=any-long-random-string
GROQ_API_KEY=gsk_your_key_here
```

The server refuses to start without them and names the one that's missing. If your Postgres
uses a password: `postgres://postgres:yourpassword@localhost:5432/biz2code`.

The rest are optional. A blank key never breaks anything — the affected figure renders
unvalidated and the document says why.

- `GEMINI_API_KEY` blank: no fallback model, Groq handles generation alone.
- `LLM_FEEDBACK_ENABLED` blank: stays off, which is the default.

## 5. Build the database

```bash
npm run db:init      # applies the migrations, tracked in schema_migrations
npm run db:seed      # optional, recommended
```

`db:init` is safe to re-run; it skips migrations already applied.

`db:seed` loads the example project (IndoorWay, indoor navigation sold to retail venues) and
pre-caches its World Bank and iTunes responses so a first run works offline.

Both read `DATABASE_URL` from `.env`, not from your shell — don't apply the SQL by hand with
`psql "$DATABASE_URL"`.

## 6. Run it

```bash
npm run dev
```

```
[api] biz2code API on http://localhost:3001
[web] ➜  Local:  http://localhost:5173/
```

Open http://localhost:5173 and register — the account is local to your database, any email
works. Then start a new project, or click **Start from the example project** to load IndoorWay
with 19 of its 24 answers filled in. `Ctrl+C` stops both.

To check it worked:

```bash
curl http://localhost:5173/api/health
# {"ok":true,"service":"biz2code"}
```

The web app proxies `/api` to port 3001, so the browser only talks to one origin. That keeps
the auth cookie same-site and avoids CORS.

## 7. Optional extras

None of these are needed to run the app.

```bash
npm test                 # 255 unit tests, offline, no database, ~2s
npm run typecheck        # server and client
npm run lint

npm run probe:sources    # calls all 11 approved data sources live; needs the database
npm run validate:data    # checks the benchmark files; needs python3
```

Rehearse a demo — runs the real sequence and prints what a reader will see:

```bash
REHEARSE_DRY=1 npm run rehearse   # ~10s, no LLM quota, figures and caveats only
npm run rehearse                  # ~2 min, full run including documents
```

Browser tests need a one-time Chromium download:

```bash
npm run test:ui:install   # ~115 MB, once per machine
npm run test:ui           # ~11s, drives the whole journey
```

Playwright is a devDependency of the `client` workspace and nothing in the app imports it, so
`npm run dev` and `npm run build` work with no browser installed.

## 8. Troubleshooting

**`Missing required env var: X`** — `.env` is missing that value, or isn't at the repository
root. It belongs next to `package.json`, not inside `server/`.

**`ECONNREFUSED ... 5432`** — PostgreSQL isn't running. Start it (`brew services start
postgresql`, `sudo service postgresql start`, or Services on Windows).

**`database "biz2code" does not exist`** — step 3 was skipped, or `DATABASE_URL` names a
different database.

**`Port 5173 is already in use`** — another Vite project is running. Close it, or set a
different `PORT` in `.env` for the API and change `server.port` in `client/vite.config.ts`.

**`question-bank.json is invalid` / `benchmarks are invalid`** — the app validates its content
files at startup and refuses to boot on a bad one. The message names the file and the field.

**Most fields say "unvalidated"** — that's by design. The app may cite only its benchmark
files and approved sources; where no published figure exists it says so. Coverage is thin
today; see `Other/Documentation/docs/DATA_SOURCE_OPTIONS.md`.

**A data source is unreachable** — run `npm run probe:sources`. It reports which sources
answered, which failed, and which were skipped for want of a key. Failures are never fatal.

## 9. Layout

```
biz2code/
├── .env                     you create this — the only machine-specific file
├── data/
│   ├── question-bank.json   the fixed questions, never LLM-generated
│   ├── benchmarks/          the figures the model is permitted to cite
│   └── seed-project.json    the example project
├── server/                  Express API, port 3001
│   └── db/migrations/       numbered SQL, applied by npm run db:init
├── client/                  React + Vite, port 5173
├── outputs/                 generated .docx files land here
└── Other/                   architecture, ADRs, QA evidence, project deliverables
```

## Starting over

```bash
dropdb biz2code && createdb biz2code && npm run db:init && npm run db:seed
```

Deletes every project and account. The files under `data/` are untouched — they're part of the
repository, not the database.
