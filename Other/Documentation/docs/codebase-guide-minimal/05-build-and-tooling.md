# 05 — Build, tooling and CI (minimal)

The eight CLI scripts have their own file: [05b-scripts.md](05b-scripts.md).

## 1. The workspace

```json
{ "workspaces": ["server", "client"],
  "devDependencies": { "concurrently": "^9.1.0" },
  "engines": { "node": ">=20" } }
```

`.nvmrc` pins **20**, CI runs **22**, the audit machine had **24** — all satisfy `>=20`, none
agree. Root `npm install` hoists `@types/*` into the root `node_modules`, which is why
`client/tsconfig.json` needs an explicit `types` array (§3).

## 2. npm scripts

### Root — 16

| Script | Command | Notes |
|---|---|---|
| `dev` | `concurrently -n api,web …` | Both servers, colour-labelled |
| `dev:api` | `tsx watch index.ts` | Restarts on `.ts` change, **not on `.json`** — the bank is read once at boot |
| `dev:web` | `vite` | Port 5173, proxying `/api` → `:3001` |
| `build` | server `tsc` **then** client `tsc -b && vite build` | Sequential — a server type error stops the client build |
| `test` | `vitest run` in server | **Server only** — the client has no test runner |
| `db:init` | `tsx scripts/migrate.ts` | Idempotent |
| `db:seed` | `tsx scripts/seed.ts` | Loads `externalCache` only |
| `validate:data` | `python3 data/benchmarks/validate_benchmarks.py` | The only Python |
| `typecheck` | server `tsc --noEmit` then client `tsc -b` ×2 | Three TS programs |
| `test:ui` | `playwright test` | Starts both servers itself |
| `test:ui:install` | `playwright install chromium` | ~115 MB, once per machine |
| `rehearse` · `qa:api` · `qa:resilience` · `qa:generation` · `probe:sources` | `tsx scripts/…` | See [05b](05b-scripts.md) |
| `lint` / `lint:fix` | `eslint .` / `--fix` | Flat config at the root |

**Two scripts named in the docs do not exist** — `checkpoint:day2`…`day5` appear in WORK_PLAN,
Master Plan §8 and FILE_INDEX, but are absent from all three `package.json` files, as are the
four `server/scripts/checkpoint-day*.ts` files they would run (**D3**).

### Server — 11
`dev`, `build`, `start` (`node dist/index.js`), `test`, `test:watch`, `typecheck`, `migrate`,
`seed`, `rehearse`, the three `qa:*`, `probe:sources`.

**Nothing uses `start`** — every documented path runs `tsx` against the TypeScript directly, so
`npm run build` produces a `server/dist/` no documented workflow executes.

### Client — 6
`dev`, `build`, `preview`, `typecheck`, `test:ui`, `test:ui:install`.
**There is no `test` script** — `client/src`'s 22 files have no unit-test path at all.

## 3. TypeScript — three programs

| Config | Program | `types` | `include` |
|---|---|---|---|
| `server/tsconfig.json` | server | `["node", "vitest/globals"]` | `**/*.ts` |
| `client/tsconfig.json` | browser | `["vite/client"]` | `src` only |
| `client/tsconfig.node.json` | Node-context client | `["node"]` | `tests`, `playwright.config.ts`, `vite.config.ts` |

Both client configs still carry their explanatory comments (`.json` was not stripped):

> *"Browser code only. Without this, TypeScript ambiently loads every `@types/*` package npm
> hoists into the workspace root — which, because the server workspace depends on them, means
> `@types/node`, express, pg and jsonwebtoken. That made `process.env`, `Buffer` and Express types
> type-check inside client components and fail at runtime in the browser."*

> *"`tests/` and `playwright.config.ts` import `node:path` and `node:url`, and a single `node:`
> import re-injects the whole `@types/node` global scope into this program — restricting `types`
> above is not enough on its own."*

**Shared strictness:** `strict`, `noUncheckedIndexedAccess`, `forceConsistentCasingInFileNames`,
`skipLibCheck`, `moduleResolution: "Bundler"`, `target: "ES2022"`.

`noUncheckedIndexedAccess` is why the codebase is full of `?? null`, `rows[0] ?? null` and
`glyph[row] ?? 0` — every index access is `T | undefined`.

`npm run typecheck` → **exit 0, no output.**

A recorded and fixed defect: `"ignoreDeprecations": "6.0"` in `client/tsconfig.json`, invalid on
TypeScript 5.9.3, failed both `typecheck` and `build` with `TS5103` and propagated into
`tsconfig.node.json` through `extends`. The key is gone.

## 4. ESLint — `eslint.config.mjs`, 84 lines

The only file still carrying the project's `PURPOSE / WHY` header. Flat config, four blocks:

| Block | Scope | Contents |
|---|---|---|
| 1 | ignores | `dist`, `node_modules`, `outputs`, `test-results`, `playwright-report`, `The Claude based answer/**`, **`Other/**`** |
| 2 | all files | `js.configs.recommended` + `tseslint.configs.recommended` + 6 overrides |
| 3 | `client/src/**` | `react-hooks/rules-of-hooks: error`, `react-hooks/exhaustive-deps: warn` |
| 4 | tests, scripts, `client/tests` | `no-explicit-any` and `no-non-null-assertion` off |

| Rule | Level | Reason (from the config) |
|---|---|---|
| `no-undef` | **off** | *"tsc already reports an undefined identifier… maintaining a globals list… gets 99 false positives"* |
| `no-unused-vars` | error, `^_` opt-out, `caughtErrors: 'none'` | *"usually a rename left half-done"* |
| `no-explicit-any` | **warn** | *"the DOM and JSON boundaries in the QA harnesses use it legitimately"* |
| `no-non-null-assertion` | **warn** | *"used deliberately where the surrounding code has already proved the value"* |
| `eqeqeq` | error, `null: 'ignore'` | allows `== null` |
| `no-empty` | error, `allowEmptyCatch: true` | *"`catch {}` is used deliberately where a failure is the expected path. The empty block IS the handling"* |

`exhaustive-deps` at **warn** exists to keep `QuestionField`'s intentional dependency exception
visible.

`npm run lint` → **✖ 29 problems (0 errors, 29 warnings)** — `no-explicit-any` and
`no-non-null-assertion`, concentrated where block 4 does not reach (mostly
`sources.service.ts`'s parsers, which legitimately take `unknown` JSON).

`Other/**` excludes `qa-browser.mjs` from linting entirely. `'The Claude based answer/**'` refers
to a directory that does not exist — a leftover ignore. The config's header also says *"165 unit
tests"* — stale; there are 260.

## 5. Vite — `client/vite.config.ts`, 16 lines

```ts
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: { port: 5173, proxy: { '/api': { target: 'http://localhost:3001', changeOrigin: true } } },
});
```

**The proxy is the security design, not a convenience** — the browser only ever talks to
`localhost:5173`, so the auth cookie stays same-site and no CORS preflight occurs.
`api.ts`'s `BASE = '/api'` depends on it.

**The proxy target is hard-coded** — changing `PORT` in `.env` without editing this line breaks
the client, which is what `index.ts`'s `EADDRINUSE` message warns about.

**The `@` alias is configured in three places and used in none** — every import in `client/src`
is relative.

Production build: `index.html` 0.39 kB, CSS **0.89 kB**, JS 249.59 kB (79.10 kB gzipped), 1.33 s.
The tiny CSS confirms the inline-styles approach.

## 6. Vitest — `server/vitest.config.ts`, 12 lines

```ts
test: {
  globals: true,
  environment: 'node',
  include: ['**/*.test.ts'],
  coverage: { include: ['services/**'], reporter: ['text'] },
}
```

`globals: true` is why test files need no imports for `describe`/`it`/`expect` — and why
`server/tsconfig.json` lists `"vitest/globals"`.

All 10 test files sit beside their subject (`prompts/budget.test.ts` covers the templates in its
own directory).

**Coverage is configured but never collected** — no script passes `--coverage`, and running it
would scope out `prompts/`, `middleware/` and `scripts/`.

## 7. Playwright — `client/playwright.config.ts`, 47 lines

| Setting | Value |
|---|---|
| `testDir` | `./tests` |
| `workers` / `fullyParallel` | `1` / `false` — serialised, the tests share one database |
| `timeout` | **150 000 ms** per test |
| `expect.timeout` | 20 000 ms |
| `projects` | `chromium` only |
| `use.trace` / `use.screenshot` | `retain-on-failure` / `only-on-failure` |
| `baseURL` | `http://localhost:5173` — **through the proxy**, exercising the same-site cookie |

`webServer` starts both servers itself (`npx tsx server/index.ts`, `npx vite --port 5173
--strictPort`), with `reuseExistingServer: !process.env.CI` so a local run attaches to a running
`npm run dev`.

**The 150 s test timeout is smaller than a generation** (126-192 s), so the test was torn down
mid-run and reported the misleading *"Target page, context or browser has been closed"*. Raising
`expect.timeout` had no effect because the **test** timeout fired first. The fix is per-test —
`test.setTimeout(300_000)` — present in `journey.spec.ts` and `extended-qa.spec.ts`, one each.
The 150 s default is unchanged, which is correct: only two tests need 300 s.

Playwright is a `client` devDependency and nothing in the app imports it, so `npm run dev` and
`npm run build` work with no browser binary installed.

## 8. CI — `.github/workflows/verify.yml`, 71 lines

The **only** CI file. Triggers: `push` to `main`, every `pull_request`.
Runner: `ubuntu-latest`, Node **22**, `cache: npm`. Service: `postgres:18` with a `pg_isready`
health check.

```yaml
DATABASE_URL: postgres://postgres:postgres@localhost:5432/biz2code
JWT_SECRET:   ci-only-not-a-real-secret
GROQ_API_KEY: ci-only-not-a-real-key
GEMINI_API_KEY: ci-only-not-a-real-key    # three llm.service fallback tests need it set
CLIENT_ORIGIN: http://localhost:5173
```

`GEMINI_API_KEY` is a QA-follow-up fix — three `llm.service` tests assert the Gemini rung and fail
if it is null, so the workflow was red for an environmental reason.

**Steps:** checkout → setup-node → `npm ci` → `typecheck` → `lint` → `npm test` →
`validate_benchmarks.py` → `npm run build` → `db:init` → `qa:api` → `qa:resilience`.

**Deliberately excluded**, per the workflow's own header: *"anything that spends LLM quota or
needs a browser binary: `qa:generation` and `test:ui` are pre-release steps, run locally. What
remains takes well under a minute and needs only Postgres."* `probe:sources` is also excluded —
it would make CI depend on eleven third-party services.

The step named "Build the client" runs `npm run build`, which builds **both** — the label is
narrower than the action.

**No deploy job**, consistent with ADR-002 in substance; the workflow's existence contradicts its
literal *"no CI/CD"*, unamended.

**Ordering note:** `validate:data` runs after the unit tests, which already enforce the same
contract at boot. So a corpus violation fails at `npm test` with a generic `benchmarks are
invalid — …` before the more precise validator can report it.

## 9. The launchers

| | `start-biz2code.bat` | `start-biz2code.sh` |
|---|---|---|
| Size | 3,826 bytes | 2,557 bytes |
| Shell | `cmd` | `bash`, `set -euo pipefail` |
| Node check | `where node` | `command -v node` |
| Already-running check | port probe | `exec 3<>/dev/tcp/127.0.0.1/5173` |
| `.env` bootstrap | copies `.env.example`, stops with instructions | same |
| Browser | opens after the port accepts | `open` \|\| `xdg-open` |

Same contract: refuse to start a second copy (*"Opening a second copy would fail on the port bind
and look like a crash"*), create `.env` from the example on a first run, wait for a real
connection rather than sleeping, open the browser. The `.bat` header: *"Every failure below pauses
instead of exiting, because a window that closes instantly tells a user nothing."*

Neither is referenced by any npm script — they are double-click entry points.

## 10. Other configuration

| File | Lines | Contents |
|---|---:|---|
| `.editorconfig` | 12 | UTF-8, LF, 2-space indent, final newline, trim trailing whitespace — **except in `*.md`** |
| `.nvmrc` | 1 | `20` |
| `.env.example` | 8 | Matches `config/env.ts` exactly, including the three removed source keys' absence |
| `.gitignore` | 18 | `node_modules/`, `dist/`, `build/`, `.env`, `outputs/`, `*.log`, `coverage/`, `*.tsbuildinfo`, three **unanchored** Playwright patterns |

The Playwright block's reason: *"Unanchored: running `playwright test` from the repo root rather
than from `client/` drops a `test-results/` here instead."*

**Two ignored artefacts are checked in under `Other/`** — `Other/Build
Artifacts/tsconfig.tsbuildinfo` and `Other/Build Artifacts/test-results/.last-run.json`. Both
match `.gitignore` patterns; moving them under `Other/` placed them outside its effect.

`outputs/` is ignored but present locally: **39 `.docx`** and **14 `.png`** across 10 project
directories plus `qa-screenshots/`.

## 11. Reproducing every verification

```bash
npm ci                    # all three workspaces
npm run typecheck         # 3 TS programs   → exit 0
npm run lint              # → 0 errors, 29 warnings
npm test                  # → 260/260, ~3.4 s, offline, no DB
npm run validate:data     # → 0 errors, 6 warnings   (needs python3)
npm run build             # server tsc, then client tsc -b + vite build

# needs Postgres
npm run db:init           # applies 3 migrations, tracked in schema_migrations
npm run db:seed           # loads 4 cached API responses
npm run qa:api            # 77 probes, in-process
npm run qa:resilience     # 17 checks

# needs the network
npm run probe:sources     # 11 live calls → 8 reachable, 1 failed, 2 skipped

# needs a browser binary
npm run test:ui:install   # once per machine, ~115 MB
npm run test:ui           # 23 tests

# spends LLM quota
npm run qa:generation     # 26 checks, ~2-3 min
REHEARSE_DRY=1 npm run rehearse   # ~10 s, no generation
npm run rehearse          # full — currently exits non-zero, see 05b
```

The four-step check that catches a half-landed change: *"`npm test`, then `npm run typecheck`,
then `npm run probe:sources`, then generate one document and read it… All four of this project's
worst bugs were only visible in the fourth step."*
