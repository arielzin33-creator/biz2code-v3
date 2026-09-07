# biz2code — Master Technical Guide

A verified, file-by-file, function-by-function guide to how this application actually works.

**Audit subject:** `biz2code-v3.0-clean`
**Produced:** 2026-08-25 · read-only audit · no source file was modified
**Method:** every claim carries a file path; every number carries the command that produced it.

---

## How to use this guide

**Read it in this order if you are new to the codebase:**

1. [01-architecture.md](01-architecture.md) — why the stack is what it is, and the data model
2. [02a-server-core.md](02a-server-core.md) — one HTTP request, end to end
3. [02b-services-gate-and-domain.md](02b-services-gate-and-domain.md) — the gate, which is the product
4. [02c-services-numbers.md](02c-services-numbers.md) — the deterministic core
5. everything else, as needed

**Read this first if you are about to change something:**
[07-gaps-and-drift.md](07-gaps-and-drift.md) — twenty-four verified discrepancies between the
documentation and the code, ranked.

**Read this if you want the shape of the system at a glance:**
[system-diagram.html](system-diagram.html) — an interactive, self-contained map of all 87
TypeScript files and their real import edges. Open it in any browser; no server, no network.

### Three conventions used throughout

| Convention | Meaning |
|---|---|
| **[sibling]** | Quoted from `../../biz2code`, a **different version** of this project that retains its comments. It is evidence of *authorial intent*, never of this repository's contents. See §3 |
| *purpose not evident from source* | Written where a symbol's job cannot be established from its code, name and neighbours. Not guessed |
| `file.ts:12` | Exact and copy-pasteable. Line numbers were read from the current files |

---

## Contents

| File | Covers | Length |
|---|---|---|
| **[01-architecture.md](01-architecture.md)** | Phase 1 — every stack choice observed in code and matched to its ADR, plus the ten choices with no ADR. Phase 2 — the full schema, all three migrations, the layering rule and its three exceptions, the single-writer invariants verified by searching every write site, and the trust boundary traced through the real call graph | ~700 lines |
| **[02a-server-core.md](02a-server-core.md)** | `index` · `app` · `config` · `db` · 7 middleware · 5 routers · 5 controllers. The complete 19-endpoint table | ~300 |
| **[02b-services-gate-and-domain.md](02b-services-gate-and-domain.md)** | `gate` · `questionBank` · `answer` · `auth` · `project` · `competitorTerms`. The gate's four guards and its transaction, statement by statement | ~400 |
| **[02c-services-numbers.md](02c-services-numbers.md)** | `calculation` (31 exports) · `derivation` (22) · `derivationInputs` (3). The `Computed` type, the `combine` chokepoint, all 13 formulas, the funnel's two branches, the verdict, and **the three code paths ADR-012 left unreachable** | ~550 |
| **[02d-services-data-sources.md](02d-services-data-sources.md)** | `benchmark` · `external` · `sources`. The function that cannot return null, the cache-on-failure pattern, the query-language defences, and **why 8 of the 12 approved sources cannot reach a document** | ~400 |
| **[02e-services-generation.md](02e-services-generation.md)** | `generation` · `llm` · `docx` · `chart` · `prompts/*`. The two escalation ladders, the guardrail preamble, the 25 document fields, the six Key Figures tables, and the dependency-free PNG encoder | ~600 |
| **[03a-frontend-structure.md](03a-frontend-structure.md)** | The component tree, 4 pages, 5 components, 3 UI primitives. Props, state and responsibilities for each | ~450 |
| **[03b-frontend-state.md](03b-frontend-state.md)** | Phase 4 — React Query's defaults, the key registry, the API client, `AuthContext`, and the **commit / dedupe / re-sync** logic traced line by line | ~400 |
| **[04-content-layer.md](04-content-layer.md)** | Phase 5 — `question-bank.json`'s nine keys (five of which no code reads), the benchmark corpus, the honesty contract traced to its three enforcement points, and what is authored twice | ~400 |
| **[05-build-and-tooling.md](05-build-and-tooling.md)** | Phase 6 — every npm script opened, the three TypeScript programs, ESLint, Vite, Vitest, Playwright, CI, the launchers | ~350 |
| **[05b-scripts.md](05b-scripts.md)** | The 8 CLI entry points, including the 77-, 17- and 26-check QA probes and **the three defects that make `npm run rehearse` fail** | ~350 |
| **[06-testing.md](06-testing.md)** | Phase 7 — all 260 unit tests by file and block, the 23 browser tests, and **every export with no test** | ~350 |
| **[07-gaps-and-drift.md](07-gaps-and-drift.md)** | Phase 8 — Master Plan §10 and WORK_PLAN re-verified item by item, then a 24-entry discrepancy register and 16 further gaps | ~650 |
| **[system-diagram.html](system-diagram.html)** | Interactive whole-system map: layers, modules, real import edges, the request path, the generation pipeline, and the trust boundary | — |

---

## 1. Verified inventory

Every figure below came from a command. Commands are shown.

### Source

```bash
find . \( -name "*.ts" -o -name "*.tsx" \) -not -path "*/node_modules/*" | wc -l
find . \( -name "*.ts" -o -name "*.tsx" \) -not -path "*/node_modules/*" -print0 | xargs -0 wc -l | tail -1
```

| Area | Files | Lines |
|---|---:|---:|
| **All TypeScript (`.ts` + `.tsx`)** | **87** | **11,861** |
| server, non-test | 51 | 6,866 |
| server, `*.test.ts` | 10 | 2,265 |
| client `src/` | 22 | 2,170 |
| client `tests/` | 2 | 497 |
| client root configs | 2 | 63 |
| SQL migrations | 3 | 147 |
| `data/**/*.json` | 22 | 7,753 |
| Python | 1 | 82 |
| CSS | 2 | 217 |
| Markdown (repo-wide, pre-guide) | 30 | 3,360 |

Server by directory:

| Directory | Files | Lines |
|---|---:|---:|
| `services/` | 24 | 6,092 |
| `scripts/` | 8 | 1,307 |
| `prompts/` | 4 | 858 |
| `controllers/` | 5 | 242 |
| `middleware/` | 7 | 225 |
| `test/` | 1 | 132 |
| `routes/` | 5 | 76 |
| `db/` | 2 | 39 |
| `config/` | 1 | 32 |
| `types/` | 1 | 14 |
| `index.ts` + `app.ts` | 2 | 102 |

**306 top-level `export` statements** across the 85 TS/TSX files in `server/` and `client/`.

### Verification

| Gate | Command | Result |
|---|---|---|
| Unit tests | `npm test` | **260 passed** in 10 files, 3.44 s, offline, no database |
| Type-check | `npm run typecheck` | **exit 0** (3 TS programs) |
| Lint | `npm run lint` | **0 errors, 29 warnings** |
| Data contract | `npm run validate:data` | **0 errors, 6 warnings** (16 verticals) |
| API probe | `npm run qa:api` | 77 probes (evidence: 75 as expected, 2 TLS-only) |
| Resilience probe | `npm run qa:resilience` | 17 checks |
| Generation probe | `npm run qa:generation` | 26 checks |
| Browser | `npm run test:ui` | 23 tests in 2 files |
| Live sources | `npm run probe:sources` | 11 calls → 8 reachable, 1 failed, 2 skipped |

**Total automated checks: 414.**

### Architecture and content

| Item | Verified | Command basis |
|---|---:|---|
| **ADRs** | **16** (001-016, no gaps) | `ls Other/Documentation/docs/adr/*.md \| wc -l` |
| HTTP endpoints | 19 | read from `app.ts` + `routes/` |
| Database tables | 6 in `001_init.sql`, +1 at runtime | read from the migrations |
| Migrations | 3 | `wc -l server/db/migrations/*.sql` |
| Approved sources in the `CHECK` | 12 | migration 003 |
| **Sources that can reach a document** | **4** | call-graph trace — [D16](07-gaps-and-drift.md) |
| Questions | **23** (22 required, 1 optional) | `node -e "…question-bank.json…"` |
| Question types | 5 | `text · select · multiselect · number · range` |
| Seed answers | 23; **18** pre-filled, 5 cleared for the demo | `clearOnDemo` census |
| Benchmark vertical files | 16 (+1 cross-vertical) | directory scan |
| Vertical metrics | **194**, **43** sourced | recomputed from the corpus |
| Cross-vertical metrics | **28**, **26** sourced | recomputed |
| Document sections | 26 — 25 model-written + 1 built in code | `prompts/documents.ts` field counts |
| Formulas in `calculation.service.ts` | **13** + 3 comparisons | `grep -n "^export"` |

---

## 2. What this guide found

Twenty-four numbered discrepancies and sixteen further gaps, all in
[07-gaps-and-drift.md](07-gaps-and-drift.md). The eight that most affect the product's central
claim:

| # | Finding | Where |
|---|---|---|
| 1 | **Retired question ids are still wired into the calculation layer.** The prompt tells the model the founder answered a customer-lifetime figure the app derives. Three code paths are unreachable in production | [D7](07-gaps-and-drift.md) · [02c §1.7](02c-services-numbers.md) |
| 2 | **The prompt-budget guard passes on an unrealistically light fixture.** A normal seed run measures **8,105** tokens against Groq's 8,000 ceiling — the regression ADR-016 exists to catch | [D22](07-gaps-and-drift.md) · [01 §1.2](01-architecture.md) |
| 3 | **Two unrelated fields are both called `unvalidated`.** The QA assessment closed an item ADR-014 correctly left open, on reasoning that applies to the wrong field | [D17](07-gaps-and-drift.md) |
| 4 | **The pre-ADR-014 prompt instruction survives**, contradicting the new rule four lines above it in the same block | [D18](07-gaps-and-drift.md) |
| 5 | **Eight of the twelve approved sources cannot reach a document.** `gatherSupplementary()` has no caller | [D16](07-gaps-and-drift.md) · [02d §3.5](02d-services-data-sources.md) |
| 6 | **The revenue band reaches every prompt as `[object Object]`** — the same `String()`-on-an-object trap the client fixed, in the server | [D19](07-gaps-and-drift.md) |
| 7 | **`db:seed` pre-caches 4 of the 9 cache keys the pipeline needs.** A cold offline run cannot produce the seed project's headline verdict | [D21](07-gaps-and-drift.md) |
| 8 | **This checkout is comment-stripped** — ~87 % of comment lines removed, including every `WHY` | [A1](07-gaps-and-drift.md) · §3 below |

**What is verified as working exactly as documented**, and worth saying because most of it is:

- The gate's five invariants, including the non-rewinding `GREATEST` advance and completeness
  counted rather than inferred ([02b](02b-services-gate-and-domain.md))
- `benchmark.resolve()` never returning null and never throwing, with all four provenance flags
  surviving ([02d](02d-services-data-sources.md))
- `combine()`'s three guarantees — poisoning names its cause, confidence never launders, no
  non-finite value escapes ([02c](02c-services-numbers.md))
- The purity test: *"an objective never influences its own projection"* is genuinely load-bearing
  ([02c §2.8](02c-services-numbers.md))
- ADR-007's insert-only deliverables, enforced in the schema, the code and the filename
- Both Day-5 browser bugs fixed, and the range-save bug fixed ([03a](03a-frontend-structure.md),
  [03b](03b-frontend-state.md))
- ADR-015's Key Figures and chart, built before the model runs, from the computed objects only

---

## 3. An important caveat about this repository

**`biz2code-v3.0-clean` is a comment-stripped copy.** Zero files carry the
`PURPOSE / WHY / DEPENDS / ADR` header block that the project's own documentation describes as
universal:

```bash
grep -rl "PURPOSE" --include="*.ts" --include="*.tsx" server client/src | wc -l   # → 0
```

Against the sibling checkout at `../../biz2code`, same 85 paths:

| | Lines | Comment lines |
|---|---:|---:|
| this repository | 11,798 | **172** |
| `../../biz2code` | 14,616 | **1,309** |

SQL, Markdown and `.mjs` were untouched — which is why
[eslint.config.mjs](../../../../eslint.config.mjs) is the one surviving specimen of the
convention, and why `001_init.sql` still reads as intended.

**What this means for the guide.** Per-file purpose was derived from code, names and signatures.
Where the sibling's header is quoted it is marked **[sibling]** and attributed as intent. That
attribution matters: **9 of the 85 files differ in code**, not only in comments —
`sources.service.ts`, `config/env.ts`, `QuestionField.tsx`, `useDocuments.ts`,
`probe-sources.ts`, `qa-generation-probe.ts` and three spec files. The sibling also contains four
files this repository does not (`server/scripts/checkpoint-day{2,3,4,5}.ts`). It is a **different
version**, not a commented edition of this one.

---

## 4. Scope

**In scope:** everything under `server/`, `client/`, `data/`, `.github/`, and the repository-root
configuration and launchers.

**Out of scope, per the audit brief:** AAAEE. One reference exists —
[Other/Summary/Capstone Project Master Plan v3.0.md](../../../Summary/Capstone%20Project%20Master%20Plan%20v3.0.md)
§1, *"v1.0 was a plan written before the build, for a seven-phase pipeline called AAAEE"* — and it
is historical. No AAAEE code, schema or specification exists in this repository.

```bash
grep -ril "aaaee\|agnostic app architecture" . | grep -v node_modules
# → Other/Summary/Capstone Project Master Plan v3.0.md
```

**Not verifiable in this checkout:** anything requiring git history. There is no `.git`
directory, so WORK_PLAN's *"13 branches, 28 commits, every merge `--no-ff`"* could not be checked.

---

## 5. Tooling note

Before starting, the environment's installed skills and plugins were enumerated and the four
plausible candidates were read: `document-generate` (Diataxis-structured generation — a different
output contract), `sync-project-docs` (scoped to `CLAUDE.md` / `AGENTS.md`, neither of which
exists here), `document-architecture-decision` (authors new ADRs), and `diagram` (emits
mermaid/excalidraw triplets, not the interactive HTML requested). None fitted a read-only,
verification-first audit with a prescribed output structure. The guide and the diagram were
produced manually; no skill output was simulated.

---

*Produced by a read-only audit of `biz2code-v3.0-clean`. No source file was modified.
Every number in this guide was measured, not remembered.*
