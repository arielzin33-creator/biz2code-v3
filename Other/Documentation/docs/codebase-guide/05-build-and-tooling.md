# 05 — Build, tooling and CI

Phase 6, part 1. Every npm script opened and traced; the TypeScript project layout; ESLint; CI;
the launchers. The eight CLI scripts under `server/scripts/` have their own file:
[05b-scripts.md](05b-scripts.md).

---

## 1. The workspace

[package.json](../../../../package.json) — an npm workspace root with two members and **one**
dependency.

```json
{ "workspaces": ["server", "client"],
  "devDependencies": { "concurrently": "^9.1.0" },
  "engines": { "node": ">=20" } }
```

`.nvmrc` pins **20**. CI runs **22** ([verify.yml:52](../../../../.github/workflows/verify.yml)),
and the machine this audit ran on has Node 24 — all satisfy `>=20`, but the three do not agree.

`npm install` at the root installs all three package sets and hoists `@types/*` into the root
`node_modules`. That hoisting is the reason `client/tsconfig.json` carries an explicit `types`
array — see §3.

---

## 2. Every `npm run` script, opened

### Root — 16 scripts

| Script | Command | What it actually does |
|---|---|---|
| `dev` | `concurrently -n api,web -c blue,green "npm:dev:api" "npm:dev:web"` | Both servers, colour-labelled. `Ctrl+C` stops both |
| `dev:api` | `npm run dev --workspace server` → `tsx watch index.ts` | Restarts on `.ts` change. **Not on `.json` change** — [INSTALL.md](../../../../INSTALL.md) and the Coding Guide **[sibling]** both note the bank is read once at boot |
| `dev:web` | `npm run dev --workspace client` → `vite` | Port 5173, proxying `/api` → `:3001` |
| `build` | server `tsc -p tsconfig.json` **then** client `tsc -b && vite build` | Sequential, so a server type error stops the client build |
| `test` | `npm run test --workspace server` → `vitest run` | **Server only.** The client has no test runner |
| `db:init` | `npm run migrate --workspace server` → `tsx scripts/migrate.ts` | Idempotent |
| `db:seed` | `npm run seed --workspace server` → `tsx scripts/seed.ts` | Loads `externalCache` only |
| `validate:data` | `python3 data/benchmarks/validate_benchmarks.py` | The only Python in the project |
| `typecheck` | server `tsc --noEmit` **then** client `tsc -b tsconfig.json tsconfig.node.json` | Three TS programs in total |
| `test:ui` | `npm run test:ui --workspace client` → `playwright test` | Starts both servers itself |
| `test:ui:install` | `playwright install chromium` | ~115 MB, once per machine |
| `rehearse` | `tsx scripts/rehearse.ts` | See [05b](05b-scripts.md) |
| `qa:api` | `tsx scripts/qa-api-probe.ts` | 77 probes in-process |
| `qa:resilience` | `tsx scripts/qa-resilience-probe.ts` | 17 checks |
| `qa:generation` | `tsx scripts/qa-generation-probe.ts` | 26 checks, **live model calls** |
| `lint` / `lint:fix` | `eslint .` / `eslint . --fix` | Flat config at the root |
| `probe:sources` | `tsx scripts/probe-sources.ts` | 11 live calls |

**Two scripts named in the docs do not exist.** `npm run checkpoint:day2` … `day5` appear in
[WORK_PLAN.md](../WORK_PLAN.md), Master Plan §8 and [FILE_INDEX.md](../../FILE_INDEX.md). They are
absent from all three `package.json` files, and the four `server/scripts/checkpoint-day*.ts` files
they would run are absent from the repository. See
[07-gaps-and-drift.md](07-gaps-and-drift.md) D3.

### Server workspace — 11 scripts

`dev`, `build`, `start` (`node dist/index.js`), `test`, `test:watch`, `typecheck`, `migrate`,
`seed`, `rehearse`, `qa:api`, `qa:resilience`, `qa:generation`, `probe:sources`.

`start` runs the compiled output. Nothing in CI or the launchers uses it — every documented path
runs `tsx` against the TypeScript directly. `npm run build` therefore produces a `server/dist/`
that no documented workflow executes.

### Client workspace — 6 scripts

`dev`, `build` (`tsc -b && vite build`), `preview`, `typecheck` (`tsc -b` over **both** projects),
`test:ui`, `test:ui:install`.

**There is no `test` script in the client workspace.** `npm test` at the root explicitly delegates
to `server` only. So `client/src`'s 22 files have no unit-test path at all — confirmed in
[03b-frontend-state.md](03b-frontend-state.md) §8.

---

## 3. TypeScript — three programs, two of them a defensive workaround

| Config | Program | `types` | `include` |
|---|---|---|---|
| [server/tsconfig.json](../../../../server/tsconfig.json) | server | `["node", "vitest/globals"]` | `**/*.ts` |
| [client/tsconfig.json](../../../../client/tsconfig.json) | browser | `["vite/client"]` | `src` only |
| [client/tsconfig.node.json](../../../../client/tsconfig.node.json) | Node-context client | `["node"]` | `tests`, `playwright.config.ts`, `vite.config.ts` |

**Both client configs still carry their explanatory comments** — they are `.json`, which the
comment-stripping pass did not touch. From `client/tsconfig.json`:

> *"Browser code only. Without this, TypeScript ambiently loads every `@types/*` package npm
> hoists into the workspace root — which, because the server workspace depends on them, means
> `@types/node`, express, pg and jsonwebtoken. That made `process.env`, `Buffer` and Express types
> type-check inside client components and fail at runtime in the browser."*

and, on `include: ["src"]`:

> *"`tests/` and `playwright.config.ts` import `node:path` and `node:url`, and a single `node:`
> import re-injects the whole `@types/node` global scope into this program — restricting `types`
> above is not enough on its own."*

**This is a workspace-hoisting defence, and it is load-bearing.** The split exists so that a
client component cannot accidentally type-check against `process.env`.

**Shared strictness across all three:** `strict: true`, `noUncheckedIndexedAccess: true`,
`forceConsistentCasingInFileNames: true`, `skipLibCheck: true`, `moduleResolution: "Bundler"`,
`target: "ES2022"`.

`noUncheckedIndexedAccess` is why the codebase is full of `?? null`, `rows[0] ?? null` and
`glyph[row] ?? 0` — every index access is `T | undefined`.

**Verified clean:**

```bash
npm run typecheck      # → exit 0, no output
```

**A defect recorded and fixed.** The QA assessment's defect 1 was
`"ignoreDeprecations": "6.0"` in `client/tsconfig.json`, invalid on the installed TypeScript
(5.9.3, resolved from `^5.7.2`), which failed both `typecheck` and `build` with `TS5103` and
propagated into `tsconfig.node.json` through `extends`. The key is gone from the current file.

---

## 4. ESLint — [eslint.config.mjs](../../../../eslint.config.mjs), 84 lines

**The only file in the repository that still carries the project's `PURPOSE / WHY` header**,
because the stripping pass targeted `.ts`/`.tsx`.

Flat config, four blocks:

| Block | Scope | Contents |
|---|---|---|
| 1 | ignores | `dist`, `node_modules`, `outputs`, `test-results`, `playwright-report`, `The Claude based answer/**`, **`Other/**`** |
| 2 | all files | `js.configs.recommended` + `tseslint.configs.recommended` + 6 rule overrides |
| 3 | `client/src/**` | `react-hooks/rules-of-hooks: error`, `react-hooks/exhaustive-deps: warn` |
| 4 | tests, scripts, `client/tests` | relaxes `no-explicit-any` and `no-non-null-assertion` to off |

**The six overrides, each with its stated reason:**

| Rule | Level | Reason (from the config) |
|---|---|---|
| `no-undef` | **off** | *"tsc already reports an undefined identifier… Leaving the rule on means maintaining a globals list… and getting 99 false positives"* |
| `@typescript-eslint/no-unused-vars` | error, `^_` opt-out, `caughtErrors: 'none'` | *"An unused variable is usually a rename that was left half-done"* |
| `@typescript-eslint/no-explicit-any` | **warn** | *"the DOM and JSON boundaries in the QA harnesses use it legitimately"* |
| `@typescript-eslint/no-non-null-assertion` | **warn** | *"used deliberately in a few places where the surrounding code has already proved the value"* |
| `eqeqeq` | error, `null: 'ignore'` | allows `== null` |
| `no-empty` | error, `allowEmptyCatch: true` | *"`catch {}` is used deliberately where a failure is the expected path — a cache miss, an optional key. The empty block IS the handling"* |

`react-hooks/exhaustive-deps` at **warn** is deliberate and named in the config: it exists to keep
`QuestionField`'s intentional dependency exception visible. See
[03b-frontend-state.md](03b-frontend-state.md) §5.4.

**Verified output:**

```bash
npm run lint      # → ✖ 29 problems (0 errors, 29 warnings)
```

29 warnings, 0 errors — matching WORK_PLAN's *"`npm run lint` (0 errors)"* and the QA assessment's
*"0 errors · 29 warnings"*. The warnings are `no-explicit-any` and `no-non-null-assertion`,
concentrated in the QA harnesses where block 4 does not reach (block 4 covers `**/scripts/**` and
`**/*.test.ts`; the remainder are in `sources.service.ts`'s parsers, which legitimately take
`unknown` JSON).

**Two ignores worth noting.** `Other/**` excludes
[Other/Documentation/docs/qa/qa-browser.mjs](../qa/qa-browser.mjs) from linting entirely.
`'The Claude based answer/**'` refers to a directory that does not exist in this repository —
a leftover ignore.

The config's header cites *"DEF-10, from the QA assessment"* as its origin: *"there was no
linter, and `error.ts` carried an `eslint-disable` pragma for a rule nothing enforced. A pragma
with no linter behind it is a comment pretending to be a control."* It also says *"165 unit
tests"* — stale; there are 260.

---

## 5. Vite — [client/vite.config.ts](../../../../client/vite.config.ts), 16 lines

```ts
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: { port: 5173, proxy: { '/api': { target: 'http://localhost:3001', changeOrigin: true } } },
});
```

**The proxy is the security design, not a convenience.** Because the browser only ever talks to
`localhost:5173`, the auth cookie stays same-site and no CORS preflight occurs. INSTALL §6 states
it; `api.ts`'s `BASE = '/api'` depends on it.

**The proxy target is hard-coded.** Changing `PORT` in `.env` without editing this line breaks the
client — which is exactly what [server/index.ts:16-17](../../../../server/index.ts)'s
`EADDRINUSE` message warns about.

**The `@` alias is configured in three places and used in none.** `vite.config.ts` sets it,
`client/tsconfig.json` declares `paths: { "@/*": ["src/*"] }`, and
`grep -rn "from '@/" client/src` returns nothing. Every import in `client/src` is relative.

**Production build output**, from the QA evidence
([harness.txt](../qa/evidence/harness.txt)): `index.html` 0.39 kB, CSS 0.89 kB, JS 249.59 kB
(79.10 kB gzipped), built in 1.33 s. The 0.89 kB CSS confirms the inline-styles approach — the
only stylesheet content is `tokens.css` plus `index.css`'s reset and keyframes.

---

## 6. Vitest — [server/vitest.config.ts](../../../../server/vitest.config.ts), 12 lines

```ts
test: {
  globals: true,
  environment: 'node',
  include: ['**/*.test.ts'],
  coverage: { include: ['services/**'], reporter: ['text'] },
}
```

`globals: true` is why the test files can use `describe`/`it`/`expect` without importing them —
and why `server/tsconfig.json` lists `"vitest/globals"` in `types`.

`include: ['**/*.test.ts']` places tests beside their subject rather than in a `__tests__`
directory. Verified: all 10 test files sit next to the module they cover, except
`prompts/budget.test.ts`, which covers the templates in the same directory.

**Coverage is configured but never collected.** `coverage.include: ['services/**']` is set, and no
script passes `--coverage`. Running it would also scope out `prompts/`, `middleware/` and
`scripts/`.

---

## 7. Playwright — [client/playwright.config.ts](../../../../client/playwright.config.ts), 47 lines

| Setting | Value | Note |
|---|---|---|
| `testDir` | `./tests` | |
| `workers` / `fullyParallel` | `1` / `false` | Serialised — the tests share one database |
| `timeout` | **150 000 ms** per test | |
| `expect.timeout` | 20 000 ms | |
| `projects` | `chromium` only | One engine. WORK_PLAN lists "a second browser engine" as needing a human |
| `use.trace` | `retain-on-failure` | |
| `use.screenshot` | `only-on-failure` | |
| `baseURL` | `http://localhost:5173` | **Through the proxy**, so the same-site cookie is exercised |

**`webServer` starts both servers itself** (lines 32-51): `npx tsx server/index.ts` from the repo
root, and `npx vite --port 5173 --strictPort` from `client/`. Both use
`reuseExistingServer: !process.env.CI`, so a local run attaches to an already-running
`npm run dev`.

**The 150 s test timeout is smaller than a generation.** The QA assessment's defect 7 records
that generation measures 126-192 s, so the test was torn down mid-run and reported the misleading
*"Target page, context or browser has been closed"*. Raising `expect.timeout` had no effect
because the **test** timeout fired first. The fix is per-test:
`test.setTimeout(300_000)` in the two generation tests. Verified present:

```bash
grep -n "setTimeout(300_000)" client/tests/*.spec.ts
# → journey.spec.ts and extended-qa.spec.ts, one each
```

The config's 150 s default is unchanged, which is correct — only two tests need 300 s.

**Playwright is a `client` devDependency and nothing in the app imports it**, so `npm run dev`
and `npm run build` work with no browser binary installed. INSTALL §7 states this; verified by
`grep -rn "@playwright" client/src` returning nothing.

---

## 8. CI — [.github/workflows/verify.yml](../../../../.github/workflows/verify.yml), 71 lines

**The only CI file in the repository.**

| | |
|---|---|
| Triggers | `push` to `main`, and every `pull_request` |
| Runner | `ubuntu-latest`, Node **22**, `cache: npm` |
| Service | `postgres:18` with a `pg_isready` health check, port 5432 |

**Environment** — four test-only values, each with a comment explaining why it is safe:

```yaml
DATABASE_URL: postgres://postgres:postgres@localhost:5432/biz2code
JWT_SECRET:   ci-only-not-a-real-secret
GROQ_API_KEY: ci-only-not-a-real-key
GEMINI_API_KEY: ci-only-not-a-real-key    # three llm.service fallback tests need it set
CLIENT_ORIGIN: http://localhost:5173
```

`GEMINI_API_KEY` is the fix from the QA follow-up — three `llm.service` tests assert the Gemini
rung and fail if `env.GEMINI_API_KEY` is null, so the workflow was red for an environmental
reason. Verified present at line 41.

**Nine steps, in order:**

| # | Step | Command |
|---|---|---|
| 1 | checkout | `actions/checkout@v4` |
| 2 | node | `actions/setup-node@v4`, node 22, npm cache |
| 3 | install | `npm ci` |
| 4 | type-check | `npm run typecheck` |
| 5 | lint | `npm run lint` |
| 6 | unit tests | `npm test` |
| 7 | data contract | `python3 data/benchmarks/validate_benchmarks.py` |
| 8 | build the client | `npm run build` |
| 9 | migrations | `npm run db:init` |
| 10 | API probe | `npm run qa:api` |
| 11 | resilience probe | `npm run qa:resilience` |

**Deliberately excluded**, per the workflow's own header:

> *"Deliberately excludes anything that spends LLM quota or needs a browser binary:
> `qa:generation` and `test:ui` are pre-release steps, run locally. What remains takes well under
> a minute and needs only Postgres."*

`probe:sources` is also excluded — it makes eleven live third-party calls and would make CI
depend on the availability of Overpass, Wikidata and eight other services.

**Step 8 runs `npm run build`, which builds the server *and* the client** — the step name says
"Build the client" but the root script does both. Harmless; the label is narrower than the action.

**No deploy job**, consistent with ADR-002 in substance. The existence of the workflow contradicts
ADR-002's literal *"no CI/CD"*, which was never amended.

**Order note.** Step 7 (`validate:data`) runs after the unit tests, which already enforce the same
contract at boot through `benchmark.service.load()`. So a corpus violation fails at step 6 with a
`benchmarks are invalid — …` message before step 7 can report it more precisely. The duplication
is intentional (two languages, two moments); the CI ordering means the less-specific error is
seen first.

---

## 9. The launchers

Two scripts, one per platform, both ~100 lines, both fully commented.

| | [start-biz2code.bat](../../../../start-biz2code.bat) | [start-biz2code.sh](../../../../start-biz2code.sh) |
|---|---|---|
| Size | 3,826 bytes | 2,557 bytes |
| Shell | `cmd` | `bash`, `set -euo pipefail` |
| Node check | `where node` | `command -v node` |
| Already-running check | port probe | `exec 3<>/dev/tcp/127.0.0.1/5173` |
| `.env` bootstrap | copies `.env.example` and stops with instructions | same |
| Browser | opens after the port accepts | `open` \|\| `xdg-open` |

Both implement the same contract: refuse to start a second copy (*"Opening a second copy would
fail on the port bind and look like a crash"*), create `.env` from the example on a first run and
stop with the three values to fill in, wait for a real connection rather than sleeping, and open
the browser.

The `.bat` header states its own convention: *"Every failure below pauses instead of exiting,
because a window that closes instantly tells a user nothing."*

Neither is referenced by any npm script. They are double-click entry points, listed in Master
Plan §11.

---

## 10. Other configuration

| File | Lines | Contents |
|---|---|---|
| [.editorconfig](../../../../.editorconfig) | 12 | UTF-8, LF, 2-space indent, final newline, trim trailing whitespace — **except in `*.md`**, where trailing whitespace is significant |
| [.nvmrc](../../../../.nvmrc) | 1 | `20` |
| [.env.example](../../../../.env.example) | 8 | `PORT`, `DATABASE_URL`, `JWT_SECRET`, `GROQ_API_KEY`, `GEMINI_API_KEY`, `CLIENT_ORIGIN`, `LLM_FEEDBACK_ENABLED` — matching `config/env.ts` exactly, including the three removed source keys' absence |
| [.gitignore](../../../../.gitignore) | 18 | `node_modules/`, `dist/`, `build/`, `.env`, `outputs/`, `*.log`, `coverage/`, `*.tsbuildinfo`, and three **unanchored** Playwright patterns |

`.gitignore`'s Playwright block carries its reason:

> *"Playwright test artefacts. Unanchored: running `playwright test` from the repo root rather
> than from `client/` drops a `test-results/` here instead."*

**Two ignored artefacts are checked in under `Other/`** —
`Other/Build Artifacts/tsconfig.tsbuildinfo` and
`Other/Build Artifacts/test-results/.last-run.json`. Both match `.gitignore` patterns
(`*.tsbuildinfo`, `test-results/`); moving them under `Other/` placed them outside the ignore's
effect. They are build residue, parked rather than deleted.

`outputs/` is ignored but present locally, holding **39 `.docx`** and **14 `.png`** across 10
project directories plus `qa-screenshots/`.

---

## 11. Reproducing every verification, in order

The full local gate, as a reader would run it:

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

The Coding Guide **[sibling]** names the four-step check that catches a half-landed change:
*"`npm test`, then `npm run typecheck`, then `npm run probe:sources`, then generate one document
and read it… All four of this project's worst bugs were only visible in the fourth step."*

---

*Next: [05b-scripts.md](05b-scripts.md).*
