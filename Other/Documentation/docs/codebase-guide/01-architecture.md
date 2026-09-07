# 01 — Architecture

Phase 1 (framework and stack rationale) and Phase 2 (data and architecture layer) of the
codebase guide. Every claim carries a file path; every number carries the command that produced
it.

**Audit subject:** `biz2code-v3.0-clean`. Where a header comment is quoted from
`../../biz2code` it is labelled **[sibling]** and is a statement of authorial intent, not a
statement about this repository's contents. See [00-index.md](00-index.md) §3.

---

## 1. Framework and stack rationale

### 1.1 What is actually installed

Observed from [package.json](../../../../package.json), [server/package.json](../../../../server/package.json)
and [client/package.json](../../../../client/package.json) — not from prose.

**Root** — an npm workspace root with two members, `server` and `client`.

```json
"workspaces": ["server", "client"],
"devDependencies": { "concurrently": "^9.1.0" },
"engines": { "node": ">=20" }
```

`concurrently` is the only root dependency. There is no bundler, no test runner and no linter
runtime at the root — `npm run lint` resolves `eslint` from the hoisted `server` devDependency.

**Server runtime dependencies** (10):

| Package | Declared | Used at | Purpose in this codebase |
|---|---|---|---|
| `express` | `^4.21.2` | [server/app.ts:3](../../../../server/app.ts) | HTTP server and routing |
| `pg` | `^8.13.1` | [server/db/pool.ts:3](../../../../server/db/pool.ts) | PostgreSQL driver, used raw (ADR-004) |
| `jsonwebtoken` | `^9.0.2` | [server/services/auth.service.ts:4](../../../../server/services/auth.service.ts), [server/middleware/auth.ts:4](../../../../server/middleware/auth.ts) | Issues and verifies the session JWT |
| `bcryptjs` | `^2.4.3` | [server/services/auth.service.ts:3](../../../../server/services/auth.service.ts) | Password hashing, 10 rounds |
| `cookie-parser` | `^1.4.7` | [server/app.ts:4](../../../../server/app.ts) | Parses the httpOnly cookie before `requireAuth` reads it |
| `cors` | `^2.8.5` | [server/app.ts:5](../../../../server/app.ts) | Single allowed origin, `credentials: true` |
| `helmet` | `^8.3.0` | [server/app.ts:6](../../../../server/app.ts) | CSP, HSTS (production only), frame-ancestors none |
| `express-rate-limit` | `^8.6.2` | [server/app.ts:7](../../../../server/app.ts) | 20 attempts / 15 min on login and register |
| `docx` | `^9.0.2` | [server/services/docx.service.ts:3-7](../../../../server/services/docx.service.ts) | OOXML generation |
| `dotenv` | `^16.4.7` | [server/config/env.ts:3](../../../../server/config/env.ts) | Loads the repo-root `.env` |

**Client runtime dependencies** (5): `react` `^18.3.1`, `react-dom` `^18.3.1`,
`react-router-dom` `^7.1.1`, `@tanstack/react-query` `^5.62.7`, `lucide-react` `^1.33.0`.

**Verified absences.** Neither `redux`, `zustand`, `prisma`, `knex`, `typeorm`, `sequelize`,
`axios`, nor any charting library appears in any `package.json`. There is no CSS framework: the
client ships two hand-written stylesheets, [client/src/index.css](../../../../client/src/index.css)
(91 lines) and [client/src/styles/tokens.css](../../../../client/src/styles/tokens.css)
(126 lines), and every component styles itself with inline `CSSProperties` objects referencing
custom properties.

### 1.2 Choice by choice, against its ADR

#### Node + Express + TypeScript monolith — ADR-001

**Observed.** One process. [server/index.ts](../../../../server/index.ts) (22 lines) calls
`app.listen`; [server/app.ts](../../../../server/app.ts) (80 lines) builds the app. The same
process serves HTTP, calls Groq, runs the calculation layer and writes `.docx` files —
confirmed by the import graph: `document.controller` → `generation.service` → `llm.service`
*and* → `docx.service`.

**ADR-001 rationale, quoted:** *"A one-week, single-user, local-only build cannot spend that;
every integration surface removed is a day not lost to debugging."*

**Extension not in the ADR.** `index.ts` carries a bespoke `EADDRINUSE` handler
([server/index.ts:11-22](../../../../server/index.ts)) that names `client/vite.config.ts` and
warns that the proxy target must move with `PORT`. That coupling is real —
[client/vite.config.ts:12](../../../../client/vite.config.ts) hard-codes
`target: 'http://localhost:3001'` and does not read an environment variable, so changing `PORT`
in `.env` alone breaks the client.

#### Local-only deployment — ADR-002

**Observed and consistent.** No `Dockerfile`, no `docker-compose*`, no `vercel.json`, no
`render.yaml`, no `Procfile` anywhere in the repository (`find . -type f` over the whole tree).
The one CI file, [.github/workflows/verify.yml](../../../../.github/workflows/verify.yml), runs
verification only — it has no deploy job. Output files are written to a local directory,
`OUTPUT_ROOT` at [server/services/docx.service.ts:13-15](../../../../server/services/docx.service.ts).

**Consistent extension.** ADR-002 says "no CI/CD". A CI workflow *does* now exist; it is
verification-only, so the decision holds in substance. The ADR was not amended to record it.

#### Fixed, seeded questions — ADR-003

**Observed.** [data/question-bank.json](../../../../data/question-bank.json) holds **23**
questions (`node -e "require('./data/question-bank.json').questions.length"` → 23). No code path
asks a model for a question: the only two `generateJson` call sites are
[server/services/generation.service.ts:165](../../../../server/services/generation.service.ts)
(document drafting) and
[server/services/llm.service.ts:393](../../../../server/services/llm.service.ts)
(`critiqueAnswers`, disabled — see ADR-011 below).

**ADR-003 rationale, quoted:** *"A gatekeeper that changes its own gates is not a gatekeeper."*

**Verified consequence.** ADR-003 says *"`dependsOnQuestionId` is reserved but unused."* True:
`grep -rn "dependsOnQuestionId"` returns nothing in `server/`, `client/` or `data/`. The
identifier does not appear anywhere, so it is not merely unused — it was never introduced.

#### Raw `pg` over an ORM — ADR-004

**Observed.** [server/db/query.ts](../../../../server/db/query.ts) is **33 lines** (`wc -l`) and
exports exactly three functions:

```ts
export async function query<T>(sql: string, params: unknown[] = []): Promise<T[]>
export async function queryOne<T>(sql: string, params: unknown[] = []): Promise<T | null>
export async function transaction<T>(fn: (q: typeof query) => Promise<T>): Promise<T>
```

**ADR-004 rationale, quoted:** *"Hand-written SQL is defensible at five tables and keeps the
query logic legible to an assessor."*

**Two things the code does that the ADR does not say.**

1. **`res.rows as T[]` is an unchecked assertion**, not a check
   ([server/db/query.ts:8](../../../../server/db/query.ts)). Nothing verifies the SQL returns the
   named columns. The Coding Guide **[sibling doc]** states this explicitly: *"The typing is a
   claim, not a check."* The ADR's phrase *"The wrapper recovers typing at the call site"*
   understates it.
2. **Parameterisation is universal.** `grep -rn "query(" server --include="*.ts"` shows every
   call passing values in the second argument. There is no string-concatenated SQL anywhere in
   `server/`.

**Contradiction with the ADR's own framing:** ADR-004 says *"The schema is five tables."*
[server/db/migrations/001_init.sql](../../../../server/db/migrations/001_init.sql) creates
**six** (`users`, `projects`, `phases`, `answers`, `deliverables`, `external_cache`), and
[server/scripts/migrate.ts:14-18](../../../../server/scripts/migrate.ts) creates a seventh,
`schema_migrations`, at runtime. See [07-gaps-and-drift.md](07-gaps-and-drift.md) D11.

#### JWT in an httpOnly cookie — ADR-005

**Observed.** [server/services/auth.service.ts:33-38](../../../../server/services/auth.service.ts):

```ts
const cookieOptions: CookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: env.NODE_ENV === 'production',
  path: '/',
};
```

TTL is 7 days (`TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7`, line 11). There is no `roles` column in
`001_init.sql` and no role check anywhere.

**ADR-005 rationale, quoted:** *"An Authorization header plus localStorage is the common
tutorial pattern, but the token is script-readable."*

**Three extensions the ADR does not mention, all present in code:**

1. **Timing-safe login.** [server/services/auth.service.ts:28](../../../../server/services/auth.service.ts)
   precomputes `DUMMY_HASH` and line 74 compares against it when no user row exists, so an
   unknown account costs the same as a wrong password.
2. **A second CSRF layer beyond `SameSite=Lax`.**
   [server/middleware/origin.ts](../../../../server/middleware/origin.ts) rejects any
   state-changing method whose `Origin` header is present and not `env.CLIENT_ORIGIN`. ADR-005
   says only *"`SameSite=Lax` covers the MVP"*. Note the middleware lets a **missing** `Origin`
   through (`if (!origin) return next();`, line 12) — deliberate, since non-browser clients and
   same-origin GETs omit it.
3. **Rate limiting.** [server/app.ts:57-67](../../../../server/app.ts) — 20 attempts per 15
   minutes, `skipSuccessfulRequests: true`, on `/api/auth/login` and `/api/auth/register` only.

**Confirmed.** Ownership is enforced by `user_id`, not by role:
[server/services/project.service.ts:58-64](../../../../server/services/project.service.ts)
`getOwned` selects `WHERE id = $1 AND user_id = $2` and throws 404 — never 403 — so another
user's project is indistinguishable from a missing one.

#### Authored content in JSON files — ADR-006

**Observed.** `data/` sits at the **repository root**, holding 22 JSON files totalling 7,753
lines (`find data -name "*.json" | wc -l`; `xargs wc -l`). Three loaders read it at module
scope, so a bad file crashes the process at import:

| Loader | File | Path resolution |
|---|---|---|
| Question bank | [server/services/questionBank.service.ts:41-43,71](../../../../server/services/questionBank.service.ts) | `../../data/question-bank.json` |
| Benchmarks | [server/services/benchmark.service.ts:55-57,101](../../../../server/services/benchmark.service.ts) | `../../data/benchmarks/` |
| Seed project | [server/services/project.service.ts:89-92](../../../../server/services/project.service.ts) | `../../data/seed-project.json` |

**ADR-006 rationale, quoted:** *"The benchmark file is a guardrail you can point at; that
argument is weaker if the data is hidden in a table."*

**A consequence the ADR states that is NOT implemented.** ADR-006: *"`answers` rows can outlive
a question that is later removed — the validator flags orphans."* No orphan check exists.
[data/benchmarks/validate_benchmarks.py](../../../../data/benchmarks/validate_benchmarks.py)
(82 lines) never opens `question-bank.json`, and
[server/services/questionBank.service.ts:49-69](../../../../server/services/questionBank.service.ts)
`load()` validates the bank internally but never reads the `answers` table. There is no
validator that flags orphans anywhere in the repository.

**Drift note.** ADR-006's tree also implies `docs/adr/`; the real path is
`Other/Documentation/docs/adr/`.

#### Immutable versioned deliverables — ADR-007

**Observed, and enforced in three places.**

1. Schema: `UNIQUE (project_id, doc_type, version)` at
   [server/db/migrations/001_init.sql:78](../../../../server/db/migrations/001_init.sql).
2. Code: the only write to `deliverables` is an `INSERT` —
   [server/services/generation.service.ts:347-352](../../../../server/services/generation.service.ts).
   `grep -rn "UPDATE deliverables\|DELETE FROM deliverables" server` returns **nothing**.
3. Filename: `${template.fileStem}_v${meta.version}.docx` at
   [server/services/docx.service.ts:253](../../../../server/services/docx.service.ts), so v1 and
   v2 are separate files on disk.

`nextVersion()` ([generation.service.ts:132-137](../../../../server/services/generation.service.ts))
is `MAX(version) + 1` and is computed **once per run, before drafting** (line 267), so all three
documents in a set share one version number.

#### Deterministic calculation layer — ADR-008

**Observed.** [server/services/calculation.service.ts](../../../../server/services/calculation.service.ts)
(412 lines) contains every arithmetic operation that reaches a document. The prompt forbids
recalculation in two places:
[server/services/llm.service.ts:117-119](../../../../server/services/llm.service.ts)
(*"Do not compute anything… Restate the supplied figures exactly; do not round, re-derive, sum,
or convert them."*) and
[server/prompts/context.ts:81](../../../../server/prompts/context.ts).

**ADR-008 rationale, quoted:** *"a figure that changes between runs is worse than no figure."*

**Contradiction — the formula count.** ADR-008 says *"Eleven formulas"*. So does the file's own
header comment ([calculation.service.ts:1](../../../../server/services/calculation.service.ts)):
`/* Deterministic economics. 11 formulas. */`. So does the test suite's describe block,
`describe('the eleven formulas', …)` at
[calculation.service.test.ts:160](../../../../server/services/calculation.service.test.ts). The
Master Plan and the Coding Guide **[sibling doc]** both say *twelve*.

**Counted from the source** (`grep -n "^export" server/services/calculation.service.ts`), the
file exports **13** figure-producing functions:

`payingUsers` · `grossMonthlyRevenue` · `storeCommission` · `netMonthlyRevenue` ·
`annualRecurringRevenue` · `monthlyTco` · `monthlyProfit` · `arpuEffective` · `cacEstimate` ·
`ltvEstimate` · `benchmarkImpliedLifetimeMonths` · `ltvCacRatio` · `paybackPeriodMonths`

plus **3** comparison functions (`arpuDivergence`, `lifetimeDivergence`, `ltvCacVerdict`) that
return a `Comparison`, not a `Computed`. The `calculationLayer.formulas` array in
[data/question-bank.json](../../../../data/question-bank.json) has **16** entries. No source
agrees with any other. Full detail: [02c-services-numbers.md](02c-services-numbers.md).

**Confirmed consequence.** *"Any formula touching a placeholder benchmark returns null and
renders unvalidated"* — enforced at the single chokepoint,
[calculation.service.ts:86-91](../../../../server/services/calculation.service.ts).

#### Guardrailed generation — ADR-009 (+ v3.0 amendment)

**Observed.** The allow-list is assembled at runtime in
[server/prompts/context.ts:208-225](../../../../server/prompts/context.ts) from what actually
resolved, exactly as the amendment claims. The approved-source list is also expressed in schema
— see §2.3 below.

**ADR-009 amendment, quoted:** *"the allow-list is still assembled at runtime from what actually
returned data. Widening adds sources that may be cited when they return data; it does not
license a citation the prompt did not carry."*

**A large contradiction.** The amendment lists twelve approved sources and
`external_cache`'s `CHECK` names twelve. But `allowedCitations()` can only ever emit **four**
external sources — World Bank, iTunes, Overpass and Wikidata
([context.ts:217-222](../../../../server/prompts/context.ts)) — because the other eight are
reachable only through `gatherSupplementary()`, **which has no caller in the application**:

```bash
grep -rn "gatherSupplementary" server --include="*.ts"
# → server/services/sources.service.ts:466  (the definition, only)
```

See [02d-services-data-sources.md](02d-services-data-sources.md) §4 and
[07-gaps-and-drift.md](07-gaps-and-drift.md) D16 for the full trace.

#### Generation order — ADR-010

**Observed and exact.**
[server/prompts/documents.ts:336](../../../../server/prompts/documents.ts):

```ts
export const GENERATION_ORDER: DocType[] = ['mrd', 'prd', 'business_plan'];
```

[generation.service.ts:281-292](../../../../server/services/generation.service.ts) iterates that
array and attaches `priorDocuments` only for `business_plan`. The dependency ADR-010 names is
real: `bp.product_weaknesses`'s instruction
([documents.ts:266](../../../../server/prompts/documents.ts)) says *"synthesised from the MRD
and PRD supplied below"*.

**Pinned-model behaviour, an extension of ADR-010 recorded only in the ARCHITECTURE doc.**
[generation.service.ts:299-305](../../../../server/services/generation.service.ts) drafts the
whole set on one model and escalates the **entire set** if any document fails.

#### Silent LLM with a scaffolded feedback mode — ADR-011

**Observed, and the scaffold is inert.**
[server/services/llm.service.ts:387-402](../../../../server/services/llm.service.ts) defines
`critiqueAnswers`, gated on `env.LLM_FEEDBACK_ENABLED`. That flag is `false` unless
`LLM_FEEDBACK_ENABLED === 'true'`
([server/config/env.ts:31](../../../../server/config/env.ts)), and `.env.example` ships it as
`false`.

**ADR-011 consequence, quoted:** *"A disabled path risks rotting; it needs at least one unit
test."* One test exists —
[llm.service.test.ts:226-228](../../../../server/services/llm.service.test.ts) — and it asserts
only that the function refuses while the flag is off. **No test exercises the enabled path.**

**The path is unreachable from HTTP.** `grep -rn "critiqueAnswers"` finds the definition and the
one test. No route, controller or service calls it. Turning the flag on changes nothing.

#### The founder states objectives; the market is derived — ADR-012

**Observed, and partially contradicted.** The three questions are genuinely gone from the bank:
`p2q3`, `p4q3` and `p4q6` have no entry
(`node -e "…questions.map(q=>q.questionId)"` → no such ids), and the bank states the rule itself
in `rules.noMarketEstimatesAsked`.

The purity test ADR-012 promises exists and passes:
[derivation.service.test.ts:299](../../../../server/services/derivation.service.test.ts)
`it('never lets an objective influence the projection it is judged against')`.

**Three contradictions, all verified in code:**

1. **The retired ids are still referenced by live application code.**
   [calculation.service.ts:325-332](../../../../server/services/calculation.service.ts):

   ```ts
   export const ECONOMIC_QUESTIONS = {
     reachableMarket: 'p2q3',
     …
     conversionPct: 'p4q3',
     …
     expectedLifetimeMonths: 'p4q6',
   } as const;
   ```

   `inputsFromAnswers()` looks those ids up, always misses, and returns `null` for all three —
   which makes three code paths in `calculate()` unreachable in production. Detail in
   [02c-services-numbers.md](02c-services-numbers.md) §5.

2. **ADR-012 says the band *"replaced an arbitrary 0.6 ratio in the verdict"*. The 0.6 is still
   there.** [derivation.service.ts:310-314](../../../../server/services/derivation.service.ts):

   ```ts
   function band(ratio: number): VerdictCode {
     if (ratio >= 1) return 'supported';
     if (ratio >= 0.6) return 'ambitious';
     return 'unsupported';
   }
   ```

   `judge()` bypasses `band()` only when a floor is supplied (line 329). The **adoption** verdict
   is called without one — `judge('user', 'people', input.objectiveUsers, somPayers, horizon)`
   at [derivation.service.ts:561](../../../../server/services/derivation.service.ts) — so 0.6
   still governs half the verdict.

3. **A prompt instruction still asks for the retired figure.** The MRD's
   `market_audience_sizing` field instructs the model to write *"the reachable market **the
   founder stated**"* ([documents.ts:108](../../../../server/prompts/documents.ts)). The founder
   no longer states one.

#### Two market models — ADR-013

**Observed and faithful.**
[derivation.service.ts:21-24](../../../../server/services/derivation.service.ts):

```ts
export const B2B_MODEL = 'Sold to businesses (B2B licence)';
export const marketModelFor = (businessModel: string | null): MarketModel =>
  businessModel === B2B_MODEL ? 'b2b_licence' : 'consumer_installs';
```

Every branch ADR-013 describes is present in `derive()`
([derivation.service.ts:471-586](../../../../server/services/derivation.service.ts)):
`tamVenues` vs `tamPeople` (491), `sam = tam` for B2B (493), `b2b_cac_usd` vs `cpi_usd` (495),
`noConversionStep()` (497), B2B logo churn with an explicit refusal to substitute app retention
(498-503), and zero commission (482-489). The "generous count is the one used" rule is
[tamVenues:212](../../../../server/services/derivation.service.ts) (`const high = v.high ?? v.low`).

**ADR-013's own "Known gap" is confirmed still open.**
[context.ts:238](../../../../server/prompts/context.ts) renders
`renderBenchmarks(ctx.calculations.benchmarksUsed)` — i.e. `BENCHMARK_KEYS` from the
*calculation* layer, which is keyed on category only. `DERIVATION_BENCHMARK_KEYS` (which holds
`b2b_cac_usd` and `b2b_logo_churn_monthly_pct`) never reaches "BENCHMARKS CONSULTED". A B2B
project therefore shows the model consumer CPI and retention it does not use, and hides the two
B2B benchmarks it does.

**An additional undocumented restriction.** The Wikidata half of the venue range only works for
Israel: [derivationInputs.service.ts:72](../../../../server/services/derivationInputs.service.ts)

```ts
iso2.toUpperCase() === 'IL' ? notableMallCount('Q801').catch(() => null) : Promise.resolve(null),
```

`Q801` is the Wikidata entity for Israel, hard-coded. For every other country the "range"
ADR-013 promises collapses to a single Overpass figure.

#### `unvalidated` marks absent data — ADR-014

**Observed, with one significant survival.** ADR-014 claims *"Every 'mark this field
unvalidated' instruction was removed"*. `grep -rn "mark this field unvalidated" server` returns
nothing, so the literal instruction is gone.

**But the old contract's text survives, contradicting the new rule inside the same prompt.**
[server/prompts/documents.ts:46-50](../../../../server/prompts/documents.ts):

```
    If every figure you used came from the supplied context, return an empty array.
    The key names above whose content you
      could not fully source. Include a key here whenever you had to write around
      a missing figure. An empty array claims everything is sourced, so use it
      only when that is true.
```

Lines 47-50 are an orphaned fragment of the pre-ADR-014 contract. *"Include a key here whenever
you had to write around a missing figure"* is the exact behaviour lines 37-40 forbid
(*"Do NOT flag a field when you correctly reported that a figure was unavailable"*). The model is
given both rules, four lines apart.

**ADR-014's honest self-assessment is the accurate one, and the QA assessment contradicting it is
wrong.** ADR-014 records: *"the injection resistance of this marker is weaker than it was."*
[QA-Assessment-2026-08-24.md](../qa/QA-Assessment-2026-08-24.md) instead calls
`GRD-MARKER-SURVIVES` a *"test-design false positive"* on the grounds that *"`unvalidated` is
computed deterministically in `benchmark.service.ts:124` … so the model cannot influence it"*.

That reasoning conflates two unrelated fields with the same name. Traced:

- `Resolved.unvalidated` — [benchmark.service.ts:124](../../../../server/services/benchmark.service.ts) —
  is deterministic, and never flows into the generation outcome.
- `GenerationOutcome.unvalidated` — the array the probe reads — is built in
  [generation.service.ts:203-213](../../../../server/services/generation.service.ts) from three
  conditions, the third of which **is** the model's self-report:

  ```ts
  } else if (modelFlagged.has(field.key)) {
    reason = 'The model reported that it could not fully source this field from the approved data.';
  }
  ```

  where `modelFlagged` comes from `content.unvalidated_fields` (line 183-187) — the model's own
  JSON key.

The same incorrect reasoning is embedded as a code comment at
[qa-generation-probe.ts:98-104](../../../../server/scripts/qa-generation-probe.ts). See
[07-gaps-and-drift.md](07-gaps-and-drift.md) D17.

**ARCHITECTURE.md's malformed-output string does not exist.** It claims a failed section is
marked *"unavailable — malformed model output"*. `grep -rn "malformed model output" server client`
returns nothing. The three real strings are at
[generation.service.ts:205-209](../../../../server/services/generation.service.ts).

#### Figures and chart rendered in code — ADR-015

**Observed exactly as described.**
[server/prompts/figures.ts](../../../../server/prompts/figures.ts) (165 lines) builds **six**
tables — Market, Acquisition, `Revenue at month N`, Costs and profit, Unit economics, Your
objectives against the evidence (lines 48-145) — each with `title`, `explanation` and three
columns `Figure | Value | Basis`
([docx.service.ts:116-118](../../../../server/services/docx.service.ts)). An absent figure renders
`'unvalidated'` in the warning colour
([docx.service.ts:127](../../../../server/services/docx.service.ts)).

The "As above." collapse ADR-015 describes is
[figures.ts:31-39](../../../../server/prompts/figures.ts) (`rowBuilder()` with a `seen` set).

The chart is dependency-free: [server/services/chart.service.ts](../../../../server/services/chart.service.ts)
(247 lines) imports only `node:zlib` and contains an RGBA canvas (lines 9-30), a 5×7 bitmap font
of 44 glyphs (lines 34-78), a CRC-32 table and PNG chunk encoder (lines 121-164). Rendering is
at 2× and displayed at half size (`const S = 2`, then `widthPt: W / S`, lines 202, 246) — the
mitigation ADR-015 names.

Both ADR-015 bug fixes are present: `drawTextVertical`'s rotation
([chart.service.ts:112](../../../../server/services/chart.service.ts)) and `niceCeiling`'s
round-the-step-then-multiply
([chart.service.ts:183-189](../../../../server/services/chart.service.ts)).

`RenderedSection` carries typed `blocks` as promised —
[docx.service.ts:25-46](../../../../server/services/docx.service.ts) — a discriminated union of
`prose | table | image`.

#### The prompt token budget — ADR-016

**Observed, and the guard does not hold under realistic input.**

The guard exists: [server/prompts/budget.test.ts](../../../../server/prompts/budget.test.ts)
(113 lines), `CEILING = 8000`, `MIN_HEADROOM = 100`, four tests, all passing.

**ADR-016 quotes current costs as 7,221 / 7,728 / 7,880.** Measured against the current code
they are lower for the fixture and higher for a real run. I rebuilt each template with the
test's own `realisticContext()` and then with the external context `gatherExternal()` actually
produces (5 iTunes apps — the cap applied at
[context.ts:140](../../../../server/prompts/context.ts) — plus the 2 World Bank rows fetched at
[generation.service.ts:103](../../../../server/services/generation.service.ts)):

```
=== budget.test.ts fixture (0 apps, 0 World Bank rows) ===
  mrd            chars  19758  maxTokens 2000  TOTAL  6940  ok
  prd            chars  20989  maxTokens 2200  TOTAL  7448  ok
  business_plan  chars  21843  maxTokens 2000  TOTAL  7461  ok
  business_plan+prior           TOTAL  7603  ok

=== realistic run (5 apps, 2 World Bank rows) ===
  mrd            chars  21765  maxTokens 2000  TOTAL  7442  ok
  prd            chars  23000  maxTokens 2200  TOTAL  7950  over the 7900 alarm
  business_plan  chars  23854  maxTokens 2000  TOTAL  7964  over the 7900 alarm
  business_plan+prior           TOTAL  8105  OVER CEILING
```

*Command: a scratchpad script importing `MRD`/`PRD`/`BUSINESS_PLAN` from
`server/prompts/documents.ts` and applying `budget.test.ts`'s own cost function
`Math.ceil((system.length + user.length) / 4) + maxTokens`, run under `npx tsx`.*

The cause is the fixture at
[budget.test.ts:76-81](../../../../server/prompts/budget.test.ts), which supplies
`worldBank: []` and `itunes: []`. `renderExternal()` then emits two one-line "no data retrieved"
fallbacks ([context.ts:134-135, 146-147](../../../../server/prompts/context.ts)) instead of the
~2,000 characters a populated context produces. ADR-016 says the test *"builds each template
against a realistic worst case"*; on the external block it builds a best case.

A second, smaller gap: the fourth test asserts `<= CEILING` (8000), not `<= CEILING -
MIN_HEADROOM` ([budget.test.ts:110-111](../../../../server/prompts/budget.test.ts)), so the
100-token alarm margin ADR-016 argues for is not applied to the one case most likely to breach.

**Also drifted:** WORK_PLAN Day 4 records output sizes *"2000/2400/3000"*. The code declares
2000 / 2200 / 2000 ([documents.ts:90, 135, 206](../../../../server/prompts/documents.ts)).

### 1.3 Choices with no ADR

Each of these is a real decision visible in the code with no decision record.

| Choice | Where | Note |
|---|---|---|
| **Vite** as the client build tool | [client/vite.config.ts](../../../../client/vite.config.ts), `vite ^6.0.5` | No ADR mentions Vite. ARCHITECTURE names it in passing. |
| **React Query** for server state | [client/src/main.tsx:12-24](../../../../client/src/main.tsx) | No ADR. ARCHITECTURE §7 argues it; the ADR set does not. |
| **React Router 7** | [client/src/App.tsx](../../../../client/src/App.tsx) | No ADR. |
| **Vitest** over Jest | [server/vitest.config.ts](../../../../server/vitest.config.ts) | No ADR. |
| **`tsx` watch** instead of `ts-node`/`nodemon` | [server/package.json](../../../../server/package.json) `"dev": "tsx watch index.ts"` | No ADR. |
| **Playwright** for browser tests | [client/playwright.config.ts](../../../../client/playwright.config.ts) | No ADR. WORK_PLAN Day 5 records the outcome, not the choice. |
| **`helmet` + `express-rate-limit` + an origin check** | [server/app.ts:24-67](../../../../server/app.ts), [server/middleware/origin.ts](../../../../server/middleware/origin.ts) | Added post-build per the QA assessment. ADR-005 is not amended. |
| **ESLint, flat config, deliberately narrow** | [eslint.config.mjs](../../../../eslint.config.mjs) | Its own header cites *"DEF-10, from the QA assessment"* rather than an ADR. |
| **Inline styles + CSS custom properties, no CSS framework** | every `client/src/**/*.tsx` | No ADR. The Design System doc governs the tokens. |
| **A CI workflow** | [.github/workflows/verify.yml](../../../../.github/workflows/verify.yml) | Directly contradicts ADR-002's *"no CI/CD"* in letter, not in spirit. Unamended. |

### 1.4 The one file that kept its original header

`eslint.config.mjs` is the only file in the repository still carrying the project's
`PURPOSE / WHY` header block — because the comment-stripping pass that produced this checkout
targeted `.ts`/`.tsx` only. It is worth reading as the surviving specimen of the convention:

```js
/*
 PURPOSE   Lint rules for the whole workspace.
 WHY       DEF-10, from the QA assessment: there was no linter, and error.ts carried an
           eslint-disable pragma for a rule nothing enforced. A pragma with no linter behind
           it is a comment pretending to be a control.
 */
```

SQL and Markdown were likewise untouched — `001_init.sql` retains its full comment header.

---

## 2. Data and architecture layer

### 2.1 Full schema

Three migrations, 147 lines total (`wc -l server/db/migrations/*.sql`). Six tables from
`001_init.sql`; a seventh, `schema_migrations`, is created by the migration runner itself.

#### `users` — [001_init.sql:6-11](../../../../server/db/migrations/001_init.sql)

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `SERIAL` | `PRIMARY KEY` | |
| `email` | `TEXT` | `UNIQUE NOT NULL` | Normalised lower-case before insert, [auth.service.ts:30](../../../../server/services/auth.service.ts) |
| `password_hash` | `TEXT` | `NOT NULL` | bcrypt, 10 rounds. Never selected into a response — `findUserById` and `register` both name columns explicitly |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()` | |

The `UNIQUE` on `email` is load-bearing: `register` catches Postgres error code `23505` and
converts it to a 409 ([auth.service.ts:59-60](../../../../server/services/auth.service.ts)).

#### `projects` — [001_init.sql:15-27](../../../../server/db/migrations/001_init.sql)

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `SERIAL` | `PRIMARY KEY` | |
| `user_id` | `INTEGER` | `NOT NULL REFERENCES users(id) ON DELETE CASCADE` | The whole isolation model |
| `name` | `TEXT` | `NOT NULL` | |
| `vertical_id` | `TEXT` | none | *"FK-by-convention to benchmarks/taxonomy.json"* (comment in the migration). Unenforced by design, ADR-006 |
| `business_model` | `TEXT` | none | **Not the value the derivation reads** — see §2.6 |
| `current_phase` | `INTEGER` | `NOT NULL DEFAULT 1 CHECK (current_phase BETWEEN 1 AND 4)` | *Furthest phase unlocked*, not the phase on screen |
| `status` | `TEXT` | `NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','complete','archived'))` | `archived` is never written by any code path (`grep -rn "archived" server` → the migration and two client label maps only) |
| `is_seed` | `BOOLEAN` | `NOT NULL DEFAULT FALSE` | Set by `createFromSeed` |
| `created_at` / `updated_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()` | `updated_at` is maintained by hand in `gate.service`, not by a trigger |

Index: `idx_projects_user ON projects(user_id)`.

#### `phases` — [001_init.sql:31-44](../../../../server/db/migrations/001_init.sql) — *this table is the gate*

| Column | Type | Constraints |
|---|---|---|
| `id` | `SERIAL` | `PRIMARY KEY` |
| `project_id` | `INTEGER` | `NOT NULL REFERENCES projects(id) ON DELETE CASCADE` |
| `phase_no` | `INTEGER` | `NOT NULL CHECK (phase_no BETWEEN 1 AND 4)` |
| `status` | `TEXT` | `NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','awaiting_approval','approved','revising'))` |
| `approved_at` | `TIMESTAMPTZ` | nullable |
| — | — | `UNIQUE (project_id, phase_no)` |
| — | — | `CONSTRAINT approved_needs_timestamp CHECK (status <> 'approved' OR approved_at IS NOT NULL)` |

`approved_needs_timestamp` is a **policy encoded as a constraint**: a phase cannot be approved
without evidence of when. It is what makes `revisePhase`'s `SET status = 'revising',
approved_at = NULL` safe and an accidental `SET status = 'approved'` impossible.

The five states exactly match the Gated Specification Method §4.2 and
`PhaseStatus` in [gate.service.ts:12-13](../../../../server/services/gate.service.ts).

Index: `idx_phases_project ON phases(project_id)`.

#### `answers` — [001_init.sql:48-60](../../../../server/db/migrations/001_init.sql)

| Column | Type | Constraints | Written for question types |
|---|---|---|---|
| `id` | `SERIAL` | `PRIMARY KEY` | |
| `project_id` | `INTEGER` | `NOT NULL REFERENCES projects(id) ON DELETE CASCADE` | |
| `question_id` | `TEXT` | `NOT NULL` | No FK — ADR-006 |
| `phase_no` | `INTEGER` | `NOT NULL CHECK (phase_no BETWEEN 1 AND 4)` | Derived by `phaseNoOf()`, never sent by the client |
| `value_text` | `TEXT` | nullable | `text`, `select` |
| `value_number` | `NUMERIC` | nullable | `number` |
| `value_json` | `JSONB` | nullable | `multiselect`, `range` |
| `answered_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()` | |
| — | — | `UNIQUE (project_id, question_id)` | Makes every save an upsert |

The migration's comment says `value_json -- multiselect`; since v3.0 it also carries `range`
(`{min, max}`). The comment was not updated.

`NUMERIC` returns as a **string** from `node-pg`. Both consumers guard for it —
[calculation.service.ts:340-346](../../../../server/services/calculation.service.ts) and
[derivationInputs.service.ts:22-28](../../../../server/services/derivationInputs.service.ts) —
each with the `raw.trim() === ''` check that stops a blank becoming a real zero.

Index: `idx_answers_project ON answers(project_id)`.

#### `deliverables` — [001_init.sql:64-79](../../../../server/db/migrations/001_init.sql)

| Column | Type | Constraints |
|---|---|---|
| `id` | `SERIAL` | `PRIMARY KEY` |
| `project_id` | `INTEGER` | `NOT NULL REFERENCES projects(id) ON DELETE CASCADE` |
| `doc_type` | `TEXT` | `NOT NULL CHECK (doc_type IN ('mrd','prd','business_plan'))` |
| `version` | `INTEGER` | `NOT NULL CHECK (version >= 1)` |
| `content_json` | `JSONB` | `NOT NULL` — the model's raw JSON |
| `file_path` | `TEXT` | nullable — repo-relative, forward slashes |
| `provenance` | `JSONB` | `NOT NULL` — the full ledger, identical across all three rows of a version |
| `unvalidated` | `JSONB` | nullable — **per document**, unlike `provenance` |
| `generated_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()` |
| — | — | `UNIQUE (project_id, doc_type, version)` |

Index: `idx_deliverables_project ON deliverables(project_id)`.

Note the asymmetry at
[generation.service.ts:350-351](../../../../server/services/generation.service.ts): `provenance`
is the run-wide object written three times; `unvalidated` is `r.unvalidated`, the per-document
slice. The `doc_type` CHECK is a third enforcement of `GENERATION_ORDER`'s membership.

#### `external_cache` — [001_init.sql:83-90](../../../../server/db/migrations/001_init.sql), amended by 002 and 003

| Column | Type | Constraints |
|---|---|---|
| `id` | `SERIAL` | `PRIMARY KEY` |
| `source` | `TEXT` | `NOT NULL CHECK (source IN (…12 values…))` — see §2.3 |
| `cache_key` | `TEXT` | `NOT NULL` |
| `payload` | `JSONB` | `NOT NULL` |
| `fetched_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()` |
| — | — | `UNIQUE (source, cache_key)` |

Index added by migration 002: `idx_external_cache_fetched ON external_cache(source, fetched_at)`.

**A verified gap in the cache design.** `fetched_at` is written on every upsert
([external.service.ts:19-24](../../../../server/services/external.service.ts)) and the index
exists to support staleness queries — migration 002's comment says *"`fetched_at` is read to
decide whether a cached row is stale enough to refresh."* **Nothing reads it.**

```bash
grep -rn "fetched_at" server --include="*.ts"
# → external.service.ts:19, 22  (both writes)
# → rehearse.ts and the QA probes read source/cache_key only
```

`getCached` selects `payload` alone
([external.service.ts:10-13](../../../../server/services/external.service.ts)). There is no TTL
and no refresh rule: a cached row is served forever. The index is unused by any query in the
codebase.

#### `schema_migrations` — created at runtime

[server/scripts/migrate.ts:13-18](../../../../server/scripts/migrate.ts):

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename   TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
```

It is not in any `.sql` file, so `psql -f 001_init.sql` alone would not create it.

### 2.2 Migration history, one line each

Read from the migrations themselves, not inferred.

| # | File | Lines | What it changed | Why (from the file) |
|---|---|---|---|---|
| 001 | [001_init.sql](../../../../server/db/migrations/001_init.sql) | 86 | Creates all six tables, four indexes, both named CHECK policies | *"Raw SQL by design (ADR-004). Migrations are hand-written, numbered files."* |
| 002 | [002_widen_external_cache_sources.sql](../../../../server/db/migrations/002_widen_external_cache_sources.sql) | 38 | Drops and re-adds `external_cache_source_check` with 11 sources; adds `idx_external_cache_fetched` | *"a rejected insert there would not fail a request; it would just make every call a live call, and the offline demo would quietly stop working"* |
| 003 | [003_add_overpass_source.sql](../../../../server/db/migrations/003_add_overpass_source.sql) | 23 | Drops and re-adds the same constraint with `'overpass'` added — 12 sources | *"no statistical agency publishes 'how many shopping centres are there' as an indicator. Overpass answers it by counting the tagged objects, keylessly and checkably"* |

Both 002 and 003 use `DROP CONSTRAINT IF EXISTS` then `ADD CONSTRAINT`, so each is idempotent
against a partially-migrated database. `migrate.ts` wraps each file in its own
`BEGIN`/`COMMIT` and records the filename, applying in lexical `.sort()` order
([migrate.ts:25, 34-45](../../../../server/scripts/migrate.ts)).

**The 001 header instruction is stale.** Line 3 says `-- Apply in order: psql -f 001_init.sql`.
Both [README.md](../../../../README.md) and [INSTALL.md](../../../../INSTALL.md) explicitly warn
*against* applying the SQL by hand, because `DATABASE_URL` lives in `.env` rather than the
shell. The migration comment predates `migrate.ts`.

### 2.3 The CHECK constraint that encodes policy

This is the claim the project makes most often, so it is worth stating exactly what is and is
not true.

**True.** After migration 003 the constraint reads
([003_add_overpass_source.sql:14-22](../../../../server/db/migrations/003_add_overpass_source.sql)):

```sql
CHECK (source IN (
  'worldbank', 'itunes',
  'restcountries', 'eurostat', 'oecd', 'unsd',
  'wikidata', 'datagovil', 'crossref', 'googlebooks',
  'openexchangerates',
  'overpass'
))
```

Twelve values. `SourceId` in
[sources.service.ts:7-10](../../../../server/services/sources.service.ts) declares ten (it
excludes `worldbank` and `itunes`, which live in `external.service.ts`) — 10 + 2 = 12, so the
type union and the constraint agree exactly. Adding a source genuinely requires a migration.

**Also true.** A cache write to an unapproved source would be rejected, and — because
`setCached` is always called `.catch(() => {})`
([external.service.ts:60, 136](../../../../server/services/external.service.ts);
[sources.service.ts:92](../../../../server/services/sources.service.ts)) — the rejection would be
silent. Migration 002's comment identifies exactly this failure mode.

**Not true as commonly stated.** The constraint governs *caching*, not *citation*. A source that
is never cached can still reach a document, because `viaCache` returns the live parse before it
caches ([sources.service.ts:90-93](../../../../server/services/sources.service.ts)) and the
`.catch` swallows the failure. The citation allow-list is a separate, code-level mechanism
([context.ts:208-225](../../../../server/prompts/context.ts)). The constraint is a strong
statement about the cache; it is a weaker statement about the document than
`DATA_SOURCES.md`'s phrasing (*"cannot be cached and therefore cannot reach a document"*)
implies.

### 2.4 The layering rule, and where it is not followed

**The stated rule** (ARCHITECTURE §6, Coding Guide §3.1 **[sibling doc]**):
`routes → controllers → services → data`, each layer calling only the one below.

**Verified by import inspection of all 41 non-test server modules.**

Holds cleanly:

- **routes** (5 files, 76 lines) import only `express`, their controller, and middleware. No
  route imports a service. Confirmed by reading all five.
- **controllers** (5 files, 242 lines) import services and middleware; none imports `db/query`
  or another controller. Confirmed by reading all five.
- **data** (`db/pool.ts`, `db/query.ts`, 39 lines) imports nothing above it.

**Three documented exceptions.**

1. **`middleware/project.ts` calls a service.**
   [server/middleware/project.ts:5-6](../../../../server/middleware/project.ts) imports
   `getOwned` from `project.service` and `PHASE_COUNT` from `questionBank.service`. This is
   middleware reaching sideways into the service layer, ahead of any controller. It is
   deliberate and load-bearing — it is what makes ownership impossible to omit, because each
   router mounts `requireAuth, loadProject` as a chain
   ([answer.routes.ts:10](../../../../server/routes/answer.routes.ts) and the three siblings) —
   but it is not "the layer below".

2. **`app.ts` calls the data layer directly.**
   [server/app.ts:15, 47](../../../../server/app.ts): the `/api/ready` handler runs
   `await query('SELECT 1')` with no controller and no service. A deliberate shortcut for a
   liveness probe; still a layer skip.

3. **Services import middleware.** Every service that can fail imports `AppError` from
   [server/middleware/error.ts](../../../../server/middleware/error.ts) — `gate.service`,
   `answer.service`, `auth.service`, `project.service`, `questionBank.service`,
   `generation.service`. `AppError` is a plain error class, not middleware behaviour, but it is
   *located* in the middleware directory, so by file path this is an upward import in six
   services.

**Service-to-service calls are permitted and used.** The dependency graph among services is
acyclic:

```
questionBank ─┬─→ gate ──→ answer
              └─→ project ─┘
benchmark ──→ calculation ──→ derivation ──→ derivationInputs
                     │                              ↑
                     └──────→ generation ───────────┘
                               ├→ llm ──→ (prompts/documents ──→ prompts/context)
                               ├→ docx ←── prompts/figures ──→ chart
                               ├→ external ←── sources
                               └→ competitorTerms
```

One cycle-looking edge is not one: `prompts/documents.ts` imports `buildGuardrailPreamble` from
`services/llm.service.ts` ([documents.ts:3](../../../../server/prompts/documents.ts)) while
`generation.service.ts` imports from both. `llm.service` imports nothing from `prompts/`, so the
graph stays acyclic.

### 2.5 Single-writer invariants — verified by searching every write site

**The claim** (ARCHITECTURE §6, ADR-003, the build guide **[sibling doc]**):
*"`gate.service` is the only module permitted to mutate `phases.status` or
`projects.current_phase`."*

**Method.** `grep -rn "UPDATE phases\|INSERT INTO phases\|UPDATE projects\|current_phase" server --include="*.ts"`,
then reading every hit.

#### `phases.status` — the claim needs one qualification

| Site | File:line | Verdict |
|---|---|---|
| `refreshPhaseStatus` | [gate.service.ts:42-43](../../../../server/services/gate.service.ts) | gate.service ✓ |
| `approvePhase` (approve) | [gate.service.ts:71-74](../../../../server/services/gate.service.ts) | gate.service ✓ |
| `approvePhase` (open next) | [gate.service.ts:83-87](../../../../server/services/gate.service.ts) | gate.service ✓ |
| `revisePhase` | [gate.service.ts:106-110](../../../../server/services/gate.service.ts) | gate.service ✓ |
| **`create` — `INSERT INTO phases … CASE WHEN n = 1 THEN 'in_progress' ELSE 'pending' END`** | [project.service.ts:42-47](../../../../server/services/project.service.ts) | **project.service** |

**The invariant holds for mutation and not for creation.** `project.service.create` writes the
initial `phases.status` for all four rows. Nothing in `gate.service` creates phase rows. The
correct statement is: *`gate.service` is the only module that **transitions** phase state;
`project.service` establishes it.* That is a sound design — creation is not a transition — but
the claim as written is slightly stronger than the code.

`project.service.createFromSeed` then calls `refreshPhaseStatus` for each phase
([project.service.ts:116](../../../../server/services/project.service.ts)), routing the
*transition* back through the gate. `answer.service` does the same after every save
([answer.service.ts:116, 152](../../../../server/services/answer.service.ts)). Neither writes
`phases` directly.

#### `projects.current_phase` — the claim holds exactly

Only two SQL statements touch it, both inside `gate.service.approvePhase`'s transaction:

```sql
UPDATE projects SET current_phase = GREATEST(current_phase, $2), updated_at = now() WHERE id = $1
```
([gate.service.ts:80-81](../../../../server/services/gate.service.ts))

`GREATEST` is the ADR-012-era fix that makes revise non-rewinding. The only other `UPDATE
projects` statements set `status` — [gate.service.ts:91-98](../../../../server/services/gate.service.ts)
and [gate.service.ts:113-115](../../../../server/services/gate.service.ts) — and both are in
`gate.service`. The `DEFAULT 1` in the schema is the only other origin.

`revisePhase` never touches `current_phase`. Asserted by
[gate.service.test.ts:101](../../../../server/services/gate.service.test.ts)
`it('does not rewind current_phase')`.

#### `deliverables` — a second single-writer invariant, undocumented

`generation.service.generateAll` is the only writer
([generation.service.ts:347-352](../../../../server/services/generation.service.ts)), and the
only statement is an `INSERT`. This is ADR-007's guarantee, and it holds absolutely.

#### `external_cache` — two writers, both funnelled through one function

`setCached` ([external.service.ts:17-25](../../../../server/services/external.service.ts)) is the
single write path for application code. It is called from `external.service` (2 sites),
`sources.service` (1 site, inside `viaCache`) and — bypassing it —
[server/scripts/seed.ts:60-66](../../../../server/scripts/seed.ts), which issues its own
equivalent upsert. The seed script's copy is a genuine duplicate of the SQL; a change to
`setCached` would not reach it.

### 2.6 The trust boundary, traced through the call graph

The claim is that a hard line separates deterministic computation from LLM narration. Traced
from `POST /api/projects/:projectId/documents/generate` rather than from the architecture
diagram:

```
document.controller.generate                       generation.service.ts:248  generateAll()
  │
  ├─ queryOne('SELECT * FROM projects …')                                 :249
  ├─ assertAllPhasesApproved()   ← reads phases; throws 409                :251,75
  ├─ getAnswers(projectId)                                                 :253
  │
  ├─ gatherExternal(answers, fallbackTerm)                                 :256,86
  │     ├─ resolveCountry(p2q2 answer)      → external_cache/worldbank
  │     ├─ worldBankIndicator × 2           → external_cache/worldbank
  │     └─ itunesSearch × |competitorTerms| → external_cache/itunes
  │
  ├─ buildDerivationInputs(verticalId, answers, external)                  :259
  │     ├─ resolveSegments()  → worldBankIndicator (per segment, max 2)
  │     └─ countVenues()      → retailVenueCount (Overpass)
  │                           → notableMallCount (Wikidata, iso2 === 'IL' only)
  │
  ├─ derive(inputs)              PURE. No network, no DB.  derivation.service.ts:471
  │
  ├─ calculate({ …inputsFromAnswers, derivedPayers, derivedLifetimeMonths, derivedCac })
  │                              PURE except resolveBenchmark (reads a module-scope Map)   :260
  │
  ├─ nextVersion(projectId)                                                :267
  │
  ╔═══════════════════════════ THE TRUST BOUNDARY ═══════════════════════════╗
  ║  baseContext: GenerationContext = { project, answers, calculations,      ║
  ║                                     derivation, external }         :268  ║
  ║                                                                          ║
  ║  draftSet(model) → for each docType in GENERATION_ORDER:           :279  ║
  ║    TEMPLATES[docType].build(ctx)   → { systemPrompt, userPrompt }         ║
  ║      systemPrompt = ROLE + buildGuardrailPreamble(allowedCitations(ctx))  ║
  ║      userPrompt   = renderSharedContext(ctx) + extra(ctx) + RESPONSE_RULES║
  ║    generateJson(...)  ─────────────────────►  Groq / Gemini               ║
  ╚══════════════════════════════════════════════════════════════════════════╝
  │
  ├─ renderDraft(draft, …)  ← the model's JSON becomes prose bodies    :174
  │     keyFigures = keyFigureBlocks(calculations, derivation)         :171
  │       └─ built BEFORE the model call, from the computed objects only
  │     sections[0] = { heading: 'Key Figures', body: null, blocks: keyFigures }  :189
  │     sections[1..] = one per template.fields, body = model prose     :215
  │
  ├─ renderDocument(...)  → outputs/<projectId>/<Stem>_v<n>.docx        :229
  └─ INSERT INTO deliverables × 3, one transaction                      :345
```

**What crosses the boundary in each direction, verified:**

*Into the model* — only what `renderSharedContext` emits
([context.ts:227-243](../../../../server/prompts/context.ts)): project name/vertical/business
model, every answer as Q/A prose, 14 computed figures with confidence tiers and numbered
caveats, 9 benchmark rows, the derivation block, the verdict, the levers, and the external data
block. Nothing else. `GenerationContext` has no database handle and no fetch capability.

*Out of the model* — only `Record<string, unknown>` parsed from JSON
([llm.service.ts:274-283](../../../../server/services/llm.service.ts)). Every value is read as
`typeof raw === 'string' ? raw.trim() : null`
([generation.service.ts:201](../../../../server/services/generation.service.ts)), so a
non-string is discarded rather than rendered. The one structural key the model can influence is
`unvalidated_fields`, read at
[generation.service.ts:183-187](../../../../server/services/generation.service.ts).

**Two facts about the boundary that the architecture doc does not state:**

1. **Key Figures are computed before the model runs and are section index 0 of every document.**
   `keyFigureBlocks(ctx.calculations, ctx.derivation)` is evaluated inside `draftDocument`
   ([generation.service.ts:171](../../../../server/services/generation.service.ts)) — i.e. in the
   same function as the model call, but from the `ctx` object, not from the response. The model
   cannot alter a single cell.

2. **The boundary is one-way for numbers but not for the marker.** As established under ADR-014
   above, `unvalidated_fields` is model-supplied and does set a marker. Numbers cannot cross
   back; one boolean can.

### 2.7 The gate state machine, as implemented

Five states, six transitions. Read from
[gate.service.ts](../../../../server/services/gate.service.ts) (117 lines) and
[project.service.ts:42-47](../../../../server/services/project.service.ts).

```
                    project created
                          │
       ┌──────────────────┴───────────────────┐
       ▼ (phase 1)                            ▼ (phases 2-4)
  in_progress                              pending
       │  ▲                                    │
       │  │ refreshPhaseStatus                 │ approvePhase(n-1)
       │  │ (a required answer removed —       │ sets status='in_progress'
       │  │  no code path does this today)     │ WHERE status='pending'
       ▼  │                                    ▼
  awaiting_approval ◄───────── refreshPhaseStatus, when canApprove() is true
       │
       │ approvePhase(n)   requires: n <= current_phase
       │                   AND no earlier phase with status <> 'approved'
       │                   AND canApprove(n)
       ▼
   approved  (approved_at = now();  current_phase = GREATEST(current_phase, n+1))
       │
       │ revisePhase(n)    approved_at = NULL
       ▼
   revising ──── saveAnswer → refreshPhaseStatus → awaiting_approval → approved …
```

**Invariant enforcement, line by line, in `approvePhase`
([gate.service.ts:49-102](../../../../server/services/gate.service.ts)):**

| Guard | Line | Status |
|---|---|---|
| project exists | 53 | 404 |
| `phaseNo > current_phase` | 55-56 | 409 *"Phase N is not unlocked yet"* |
| any earlier phase not `approved` | 58-64 | 409 *"Phase N must be approved first"* |
| `canApprove` false | 66-67 | 409 *"Phase has unanswered required questions"* |

Then a single `transaction()` (line 70) performs: set approved + timestamp → advance
`current_phase` with `GREATEST` → open the next phase only `WHERE status = 'pending'` → recompute
`projects.status` by **counting approved rows** rather than inferring from `current_phase`
(lines 90-98).

That last statement is the one WORK_PLAN Day 2 calls out: *"Completeness is counted from the
phases table, never inferred."* Verified —

```sql
status = CASE WHEN (SELECT count(*) FROM phases
                    WHERE project_id = $1 AND status = 'approved') = $2
              THEN 'complete' ELSE 'in_progress' END
```

and it is guarded by `WHERE id = $1 AND status <> 'archived'`, so an archived project is never
silently reactivated.

**`refreshPhaseStatus` never reopens an approved phase** — line 34 returns early. That is what
makes an approved phase read-only without a lock, and it is asserted at
[gate.service.test.ts:185](../../../../server/services/gate.service.test.ts).

**One state is only half-reachable.** `revising` is written by `revisePhase` and then
immediately superseded on the next answer save: `refreshPhaseStatus` maps a non-`pending`,
non-`approved`, complete phase to `awaiting_approval` and an incomplete one to `in_progress`
(lines 37-39). Neither branch can produce `revising`. So `revising` is a transient marker that
survives only until the first save — which is correct behaviour, but means the UI's "Revising"
label ([client/src/lib/types.ts:143](../../../../client/src/lib/types.ts)) is rarely seen.

### 2.8 The `business_model` divergence

Worth isolating because it affects the prompt.

`projects.business_model` is set from the seed file, which stores the slug `"b2b_licensing"`
([data/seed-project.json](../../../../data/seed-project.json), `project.businessModel`). The
p4q1 **answer** stores the option string `"Sold to businesses (B2B licence)"`.

- `derive()` and `calculate()` read the **answer** —
  [derivationInputs.service.ts:96](../../../../server/services/derivationInputs.service.ts) and
  [calculation.service.ts:354](../../../../server/services/calculation.service.ts) — so both
  branch correctly. `marketModelFor` matches `B2B_MODEL` exactly, and `storeCommission` finds
  the string in `NOT_STORE_DISTRIBUTED`
  ([calculation.service.ts:128-132](../../../../server/services/calculation.service.ts)).
- The **prompt** reads the column —
  [generation.service.ts:272](../../../../server/services/generation.service.ts) →
  [context.ts:231](../../../../server/prompts/context.ts) — so every document's context header
  reads `BUSINESS MODEL: b2b_licensing`, a slug that matches none of p4q1's options and appears
  nowhere else in the system.

Nothing breaks. The model is simply shown an internal identifier where a human-readable choice
was intended.

---

*Next: [02a-server-core.md](02a-server-core.md) — the request path, file by file.*
