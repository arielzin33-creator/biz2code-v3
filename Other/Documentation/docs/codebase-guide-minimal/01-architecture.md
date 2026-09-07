# 01 — Architecture (minimal)

## 1. Stack

**Root** — npm workspace, members `server` and `client`. Only dep: `concurrently ^9.1.0`.
`engines.node >= 20`.

**Server runtime deps (10)**

| Package | Version | Used at | Purpose |
|---|---|---|---|
| `express` | ^4.21.2 | `app.ts:3` | HTTP server, routing |
| `pg` | ^8.13.1 | `db/pool.ts:3` | Postgres driver, raw (ADR-004) |
| `jsonwebtoken` | ^9.0.2 | `auth.service.ts:4`, `middleware/auth.ts:4` | Session JWT |
| `bcryptjs` | ^2.4.3 | `auth.service.ts:3` | Password hashing, 10 rounds |
| `cookie-parser` | ^1.4.7 | `app.ts:4` | Parses httpOnly cookie |
| `cors` | ^2.8.5 | `app.ts:5` | Single origin, `credentials: true` |
| `helmet` | ^8.3.0 | `app.ts:6` | CSP, HSTS (prod), frame-ancestors none |
| `express-rate-limit` | ^8.6.2 | `app.ts:7` | 20 attempts / 15 min on login+register |
| `docx` | ^9.0.2 | `docx.service.ts:3-7` | OOXML generation |
| `dotenv` | ^16.4.7 | `config/env.ts:3` | Loads repo-root `.env` |

**Client runtime deps (5)** — `react` ^18.3.1, `react-dom` ^18.3.1, `react-router-dom` ^7.1.1,
`@tanstack/react-query` ^5.62.7, `lucide-react` ^1.33.0.

**Absent:** redux, zustand, prisma, knex, typeorm, sequelize, axios, any charting library, any
CSS framework. Styling is two hand-written stylesheets (`index.css` 91 lines,
`styles/tokens.css` 126 lines) plus inline `CSSProperties`.

## 2. ADRs 001-016 — observed state

| ADR | Decision | Verified state |
|---|---|---|
| 001 | Node + Express + TS monolith | One process. `index.ts` (22 lines) listens; `app.ts` (80) builds. Bespoke `EADDRINUSE` handler at `index.ts:11-22`; `vite.config.ts:12` hard-codes `http://localhost:3001`, so changing `PORT` alone breaks the client |
| 002 | Local-only deployment | No Dockerfile/compose/vercel/render/Procfile. One CI file, verification-only, no deploy job. `OUTPUT_ROOT` at `docx.service.ts:13-15`. CI exists despite "no CI/CD" — unamended |
| 003 | Fixed seeded questions | 23 questions in `question-bank.json`. No model-generated questions. `dependsOnQuestionId` never appears anywhere |
| 004 | Raw `pg` over an ORM | `db/query.ts` = 33 lines, 3 exports: `query`, `queryOne`, `transaction`. `res.rows as T[]` is an unchecked assertion. Parameterisation universal — no concatenated SQL. ADR says "five tables"; there are **six** + `schema_migrations` at runtime |
| 005 | JWT in httpOnly cookie | `httpOnly`, `sameSite: 'lax'`, `secure` in prod, `path: '/'`. TTL 7 days. No roles column, no role check. Extras not in ADR: timing-safe login via `DUMMY_HASH` (`auth.service.ts:28,74`), an Origin check (`middleware/origin.ts`, missing Origin passes), rate limiting. Ownership via `user_id` — `getOwned` throws 404, never 403 |
| 006 | Authored content in JSON | `data/` at repo root, 22 files / 7,753 lines. Three module-scope loaders: questionBank, benchmark, project (seed). **Orphan check promised by the ADR does not exist** — `validate_benchmarks.py` never opens the question bank |
| 007 | Immutable versioned deliverables | Enforced 3x: `UNIQUE (project_id, doc_type, version)`; only write is an INSERT; filename `<fileStem>_v<version>.docx`. `nextVersion()` = `MAX(version)+1`, computed once per run — all 3 docs share a version |
| 008 | Deterministic calculation layer | All arithmetic in `calculation.service.ts` (412 lines). Prompt forbids recalculation twice. **Formula count disagrees everywhere:** ADR + file header + test say 11, Master Plan says 12, source exports **13** + 3 comparisons, `question-bank.json` lists 16 |
| 009 | Guardrailed generation | Allow-list assembled at runtime (`context.ts:208-225`). Amendment lists 12 sources, `CHECK` names 12, but `allowedCitations()` can emit only **4** (World Bank, iTunes, Overpass, Wikidata) — the other 8 are reachable only via `gatherSupplementary()`, which has no caller |
| 010 | Generation order | `GENERATION_ORDER = ['mrd','prd','business_plan']`. `priorDocuments` attached only for `business_plan`. Whole set drafted on one model; any failure escalates the entire set |
| 011 | Silent LLM + scaffolded feedback | `critiqueAnswers` gated on `env.LLM_FEEDBACK_ENABLED` (default false). One test, asserting only the disabled path. No route/controller/service calls it — unreachable from HTTP |
| 012 | Founder states objectives; market derived | `p2q3`, `p4q3`, `p4q6` gone from the bank; purity test exists and passes. **3 contradictions:** retired ids still in `ECONOMIC_QUESTIONS` (`calculation.service.ts:325-332`) making 3 paths unreachable; the "replaced" 0.6 ratio still governs the adoption verdict (`derivation.service.ts:310-314`, called without a floor at :561); MRD field `market_audience_sizing` still asks for "the reachable market the founder stated" (`documents.ts:108`) |
| 013 | Two market models | `B2B_MODEL = 'Sold to businesses (B2B licence)'`; `marketModelFor` at `derivation.service.ts:21-24`. All branches present in `derive()` (:471-586). **Known gap open:** `DERIVATION_BENCHMARK_KEYS` never reaches "BENCHMARKS CONSULTED", so a B2B project shows consumer CPI/retention it does not use. **Undocumented:** the Wikidata venue half is Israel-only — `Q801` hard-coded at `derivationInputs.service.ts:72` |
| 014 | `unvalidated` marks absent data | Literal instruction removed. **But** an orphaned pre-ADR-014 fragment survives at `documents.ts:46-50`, contradicting `documents.ts:37-40` four lines above. QA closed `GRD-MARKER-SURVIVES` by conflating two same-named fields: `Resolved.unvalidated` (deterministic, `benchmark.service.ts:124`) vs `GenerationOutcome.unvalidated` (built at `generation.service.ts:203-213`, third condition **is** the model's self-report). ARCHITECTURE.md's "unavailable — malformed model output" string does not exist |
| 015 | Figures and chart rendered in code | `prompts/figures.ts` (165 lines) builds 6 tables, columns Figure / Value / Basis. Absent figure renders `'unvalidated'` in warning colour. "As above." collapse at `figures.ts:31-39`. `chart.service.ts` (247 lines) imports only `node:zlib`: RGBA canvas, 5x7 bitmap font of 44 glyphs, CRC-32 + PNG chunk encoder. Rendered at 2x, displayed at half. Both ADR bug fixes present |
| 016 | Prompt token budget | `budget.test.ts` (113 lines), `CEILING = 8000`, `MIN_HEADROOM = 100`, 4 tests passing. **Guard does not hold under realistic input** — see below |

### ADR-016 measured costs

```
=== budget.test.ts fixture (0 apps, 0 World Bank rows) ===
  mrd            TOTAL  6940  ok
  prd            TOTAL  7448  ok
  business_plan  TOTAL  7461  ok
  business_plan+prior   TOTAL  7603  ok

=== realistic run (5 apps, 2 World Bank rows) ===
  mrd            TOTAL  7442  ok
  prd            TOTAL  7950  over the 7900 alarm
  business_plan  TOTAL  7964  over the 7900 alarm
  business_plan+prior   TOTAL  8105  OVER CEILING
```

Cause: the fixture supplies `worldBank: []` and `itunes: []` (`budget.test.ts:76-81`), so
`renderExternal()` emits two one-line fallbacks instead of ~2,000 characters. Second gap: test 4
asserts `<= CEILING`, not `<= CEILING - MIN_HEADROOM`.

Also drifted: WORK_PLAN Day 4 records output sizes 2000/2400/3000; the code declares
2000 / 2200 / 2000.

## 3. Choices with no ADR

Vite · React Query · React Router 7 · Vitest over Jest · `tsx watch` over ts-node/nodemon ·
Playwright · helmet + express-rate-limit + origin check · ESLint flat config · inline styles +
CSS custom properties · the CI workflow (contradicts ADR-002 in letter).

`eslint.config.mjs` is the only file still carrying the `PURPOSE / WHY` header block — the
stripping pass targeted `.ts`/`.tsx` only.

---

## 4. Schema

Three migrations, 147 lines. Six tables from `001_init.sql`; `schema_migrations` created at
runtime by `migrate.ts:13-18` (so `psql -f 001_init.sql` alone would not create it).

**`users`** — `id SERIAL PK` · `email TEXT UNIQUE NOT NULL` (lower-cased before insert) ·
`password_hash TEXT NOT NULL` (bcrypt 10, never selected into a response) · `created_at`.
The `UNIQUE` is load-bearing: PG `23505` maps to 409.

**`projects`** — `id` · `user_id NOT NULL REFERENCES users ON DELETE CASCADE` (the whole
isolation model) · `name` · `vertical_id` (FK-by-convention, unenforced) · `business_model`
(*not* the value the derivation reads) · `current_phase CHECK 1..4` (furthest phase unlocked) ·
`status CHECK in_progress|complete|archived` (`archived` never written by any code) ·
`is_seed` · `created_at`/`updated_at` (maintained by hand in `gate.service`, no trigger).
Index `idx_projects_user`.

**`phases`** — *this table is the gate.* `id` · `project_id` · `phase_no CHECK 1..4` ·
`status CHECK pending|in_progress|awaiting_approval|approved|revising` · `approved_at` ·
`UNIQUE (project_id, phase_no)` · `CONSTRAINT approved_needs_timestamp CHECK (status <>
'approved' OR approved_at IS NOT NULL)`. Index `idx_phases_project`.

**`answers`** — `id` · `project_id` · `question_id` (no FK) · `phase_no CHECK 1..4` (derived by
`phaseNoOf()`, never client-sent) · `value_text` (text, select) · `value_number` (number) ·
`value_json` (multiselect **and** range — comment not updated) · `answered_at` ·
`UNIQUE (project_id, question_id)` making every save an upsert. Index `idx_answers_project`.
`NUMERIC` returns as a **string** from node-pg; both consumers guard with a
`raw.trim() === ''` check so a blank never becomes a real zero.

**`deliverables`** — `id` · `project_id` · `doc_type CHECK mrd|prd|business_plan` ·
`version CHECK >= 1` · `content_json JSONB NOT NULL` · `file_path` · `provenance JSONB NOT NULL`
(run-wide, identical across all 3 rows) · `unvalidated JSONB` (**per document**) ·
`generated_at` · `UNIQUE (project_id, doc_type, version)`. Index `idx_deliverables_project`.

**`external_cache`** — `id` · `source CHECK IN (12 values)` · `cache_key` · `payload JSONB` ·
`fetched_at` · `UNIQUE (source, cache_key)`. Index `idx_external_cache_fetched` (002).
**Gap:** `fetched_at` is written but never read. No TTL, no refresh rule — a cached row is
served forever, and the index is unused by any query.

### Migrations

| # | File | Lines | Change |
|---|---|---:|---|
| 001 | `001_init.sql` | 86 | Six tables, four indexes, both named CHECK policies |
| 002 | `002_widen_external_cache_sources.sql` | 38 | Re-adds source CHECK with 11 sources; adds `idx_external_cache_fetched` |
| 003 | `003_add_overpass_source.sql` | 23 | Re-adds the CHECK with `'overpass'` — 12 sources |

Both 002 and 003 use `DROP CONSTRAINT IF EXISTS` then `ADD`, so each is idempotent.
`migrate.ts` wraps each file in its own `BEGIN`/`COMMIT`, applies in lexical order, records the
filename. The 001 header's `psql -f` instruction is stale — README and INSTALL warn against it.

### The source CHECK

```sql
CHECK (source IN (
  'worldbank', 'itunes',
  'restcountries', 'eurostat', 'oecd', 'unsd',
  'wikidata', 'datagovil', 'crossref', 'googlebooks',
  'openexchangerates',
  'overpass'
))
```

`SourceId` declares 10 (excluding worldbank/itunes, which live in `external.service.ts`) —
10 + 2 = 12, exact agreement. Adding a source genuinely requires a migration.

**But the constraint governs caching, not citation.** `viaCache` returns the live parse *before*
caching, and every `setCached` is `.catch(() => {})`, so an unapproved source could still reach
a document. The citation allow-list is a separate code-level mechanism (`context.ts:208-225`).

---

## 5. Layering

**Rule:** `routes -> controllers -> services -> data`.

Holds cleanly: routes (5 files, 76 lines) import only express, their controller and middleware —
no route imports a service. Controllers (5 files, 242 lines) import services and middleware —
none imports `db/query` or another controller. `db/` imports nothing above it.

**Three exceptions**

1. `middleware/project.ts:5-6` imports `getOwned` from `project.service` — middleware reaching
   sideways, ahead of any controller. Deliberate: it is what makes ownership impossible to omit.
2. `app.ts:15,47` — `/api/ready` runs `await query('SELECT 1')` with no controller or service.
3. Six services import `AppError` from `middleware/error.ts` — an upward import by file path.

**Service graph (acyclic)**

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

`prompts/documents.ts` imports `buildGuardrailPreamble` from `llm.service.ts`, but `llm.service`
imports nothing from `prompts/` — the graph stays acyclic.

## 6. Single-writer invariants

**`phases.status`** — four transition sites, all in `gate.service` (`refreshPhaseStatus`,
`approvePhase` x2, `revisePhase`). **One creation site outside it:** `project.service.create`
writes the initial status for all four rows (`project.service.ts:42-47`). Correct statement:
*`gate.service` is the only module that **transitions** phase state; `project.service`
establishes it.* `createFromSeed` and `answer.service` both route transitions back through
`refreshPhaseStatus`.

**`projects.current_phase`** — holds exactly. Only two statements, both inside `approvePhase`'s
transaction: `SET current_phase = GREATEST(current_phase, $2)`. `revisePhase` never touches it.

**`deliverables`** — `generation.service.generateAll` is the only writer, and the only statement
is an INSERT. Undocumented but absolute.

**`external_cache`** — `setCached` is the single application write path (3 call sites), but
`seed.ts:60-66` issues its own equivalent upsert, duplicating the SQL.

## 7. Trust boundary

```
document.controller.generate                    generation.service.ts:248 generateAll()
  ├─ queryOne('SELECT * FROM projects …')                            :249
  ├─ assertAllPhasesApproved()   ← throws 409                        :251
  ├─ getAnswers(projectId)                                           :253
  ├─ gatherExternal(answers, fallbackTerm)                           :256
  │     resolveCountry · worldBankIndicator x2 · itunesSearch xN
  ├─ buildDerivationInputs(verticalId, answers, external)            :259
  │     resolveSegments (<=2) · countVenues (Overpass) · notableMallCount (IL only)
  ├─ derive(inputs)          PURE — no network, no DB
  ├─ calculate({…})          PURE except a module-scope benchmark Map :260
  ├─ nextVersion(projectId)                                          :267
  ╔══════════════════ THE TRUST BOUNDARY ═══════════════════╗
  ║ baseContext = { project, answers, calculations,          ║
  ║                 derivation, external }             :268  ║
  ║ draftSet(model) → per docType in GENERATION_ORDER: :279  ║
  ║   TEMPLATES[docType].build(ctx) → system + user prompt   ║
  ║   generateJson(...) ───────────► Groq / Gemini           ║
  ╚══════════════════════════════════════════════════════════╝
  ├─ renderDraft(draft, …)                                           :174
  │     keyFigures built BEFORE the call, from computed objects only  :171
  │     sections[0] = Key Figures (blocks);  sections[1..] = model prose
  ├─ renderDocument(...) → outputs/<projectId>/<Stem>_v<n>.docx      :229
  └─ INSERT INTO deliverables x 3, one transaction                    :345
```

**In:** only what `renderSharedContext` emits (`context.ts:227-243`) — project header, every
answer as Q/A prose, 14 computed figures with confidence tiers and numbered caveats, 9 benchmark
rows, the derivation block, verdict, levers, external block. `GenerationContext` has no DB
handle and no fetch capability.

**Out:** only `Record<string, unknown>` parsed from JSON. Every value read as
`typeof raw === 'string' ? raw.trim() : null`, so a non-string is discarded. The one structural
key the model influences is `unvalidated_fields`.

**Two facts not in the architecture doc:** Key Figures are section index 0 of every document and
the model cannot alter a cell; and the boundary is one-way for numbers but not for the marker —
numbers cannot cross back, one boolean can.

## 8. Gate state machine

```
                    project created
       ┌──────────────────┴───────────────────┐
       ▼ (phase 1)                            ▼ (phases 2-4)
  in_progress                              pending
       │  ▲                                    │ approvePhase(n-1)
       │  │ refreshPhaseStatus                 │ sets in_progress WHERE pending
       ▼  │                                    ▼
  awaiting_approval ◄──── refreshPhaseStatus when canApprove()
       │ approvePhase(n)
       ▼
   approved  (approved_at = now(); current_phase = GREATEST(current_phase, n+1))
       │ revisePhase(n)  → approved_at = NULL
       ▼
   revising ──── saveAnswer → refreshPhaseStatus → awaiting_approval → approved …
```

**`approvePhase` guards** (`gate.service.ts:49-102`)

| Guard | Line | Result |
|---|---|---|
| project exists | 53 | 404 |
| `phaseNo > current_phase` | 55-56 | 409 "Phase N is not unlocked yet" |
| any earlier phase not approved | 58-64 | 409 "Phase N must be approved first" |
| `canApprove` false | 66-67 | 409 "Phase has unanswered required questions" |

Then one transaction: approve + timestamp → `GREATEST` advance → open next phase only
`WHERE status = 'pending'` → recompute `projects.status` by **counting** approved rows, guarded
by `AND status <> 'archived'`.

`refreshPhaseStatus` returns early on an approved phase (line 34) — that is what makes an
approved phase read-only without a lock.

**`revising` is half-reachable.** It is written by `revisePhase` and superseded on the next
save: `refreshPhaseStatus` can only produce `awaiting_approval` or `in_progress`. The UI's
"Revising" label is rarely seen.

## 9. The `business_model` divergence

`projects.business_model` holds the slug `"b2b_licensing"` (from the seed file). The p4q1
**answer** holds `"Sold to businesses (B2B licence)"`.

- `derive()` and `calculate()` read the **answer** — both branch correctly.
- The **prompt** reads the **column** (`generation.service.ts:272` → `context.ts:231`), so every
  document header reads `BUSINESS MODEL: b2b_licensing`, a slug matching no p4q1 option.

Nothing breaks; the model is shown an internal identifier.
