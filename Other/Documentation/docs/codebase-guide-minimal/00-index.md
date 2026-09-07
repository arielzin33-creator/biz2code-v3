# biz2code — Technical Guide (minimal)

Condensed clone of `../codebase-guide/`. Facts only; rationale, commands and evidence trails
live in the full guide.

**Subject:** `biz2code-v3.0-clean` · read-only audit · no source file modified.

---

## Contents

| File | Covers |
|---|---|
| [01-architecture.md](01-architecture.md) | Stack, ADRs 001-016, schema, layering, invariants, trust boundary, gate machine |
| [02a-server-core.md](02a-server-core.md) | `index` · `app` · `config` · `db` · middleware · routes · controllers · 19 endpoints |
| [02b-services-gate-and-domain.md](02b-services-gate-and-domain.md) | `gate` · `questionBank` · `answer` · `auth` · `project` · `competitorTerms` |
| [02c-services-numbers.md](02c-services-numbers.md) | `calculation` · `derivation` · `derivationInputs` — the deterministic core |
| [02d-services-data-sources.md](02d-services-data-sources.md) | `benchmark` · `external` · `sources` |
| [02e-services-generation.md](02e-services-generation.md) | `generation` · `llm` · `docx` · `chart` · `prompts/*` |
| [03a-frontend-structure.md](03a-frontend-structure.md) | Component tree, 4 pages, 5 components, 3 UI primitives |
| [03b-frontend-state.md](03b-frontend-state.md) | React Query, key registry, API client, `AuthContext`, save logic |
| [04-content-layer.md](04-content-layer.md) | `question-bank.json`, `seed-project.json`, benchmark corpus |
| [05-build-and-tooling.md](05-build-and-tooling.md) | npm scripts, TS programs, ESLint, Vite, Vitest, Playwright, CI |
| [05b-scripts.md](05b-scripts.md) | The 8 CLI entry points |
| [06-testing.md](06-testing.md) | 260 unit tests, 23 browser tests, untested exports |
| [07-gaps-and-drift.md](07-gaps-and-drift.md) | 24 discrepancies + 16 further gaps |

## Conventions

| Convention | Meaning |
|---|---|
| **[sibling]** | Quoted from `../../biz2code`, a different version that retains comments — authorial intent only |
| *purpose not evident from source* | Cannot be established from code; not guessed |
| `file.ts:12` | Exact line number in the current files |

---

## 1. Inventory

| Area | Files | Lines |
|---|---:|---:|
| All TypeScript (`.ts` + `.tsx`) | **87** | **11,861** |
| server, non-test | 51 | 6,866 |
| server `*.test.ts` | 10 | 2,265 |
| client `src/` | 22 | 2,170 |
| client `tests/` | 2 | 497 |
| client root configs | 2 | 63 |
| SQL migrations | 3 | 147 |
| `data/**/*.json` | 22 | 7,753 |
| Python | 1 | 82 |
| CSS | 2 | 217 |

Server by directory: `services/` 24/6,092 · `scripts/` 8/1,307 · `prompts/` 4/858 ·
`controllers/` 5/242 · `middleware/` 7/225 · `test/` 1/132 · `routes/` 5/76 · `db/` 2/39 ·
`config/` 1/32 · `types/` 1/14 · `index.ts`+`app.ts` 2/102.

**306 top-level `export` statements** across 85 TS/TSX files.

### Verification gates

| Gate | Command | Result |
|---|---|---|
| Unit tests | `npm test` | 260 passed, 10 files, 3.44 s, offline |
| Type-check | `npm run typecheck` | exit 0 (3 TS programs) |
| Lint | `npm run lint` | 0 errors, 29 warnings |
| Data contract | `npm run validate:data` | 0 errors, 6 warnings (16 verticals) |
| API probe | `npm run qa:api` | 77 probes |
| Resilience probe | `npm run qa:resilience` | 17 checks |
| Generation probe | `npm run qa:generation` | 26 checks |
| Browser | `npm run test:ui` | 23 tests, 2 files |
| Live sources | `npm run probe:sources` | 11 calls → 8 reachable, 1 failed, 2 skipped |

**Total automated checks: 414.**

### Key counts

| Item | Value |
|---|---|
| ADRs | 16 (001-016, no gaps) |
| HTTP endpoints | 19 |
| Database tables | 6 in `001_init.sql`, +1 at runtime |
| Migrations | 3 |
| Approved sources in the `CHECK` | 12 |
| Sources that can reach a document | **4** |
| Questions | 23 (22 required, 1 optional), 5 types |
| Seed answers | 23; 18 pre-filled, 5 cleared for demo |
| Benchmark vertical files | 16 (+1 cross-vertical) |
| Vertical metrics | 194, 43 sourced |
| Cross-vertical metrics | 28, 26 sourced |
| Document sections | 26 — 25 model-written + 1 built in code |
| Formulas in `calculation.service.ts` | 13 + 3 comparisons |

---

## 2. Headline findings

| # | Finding |
|---|---|
| 1 | Retired question ids (`p2q3`, `p4q3`, `p4q6`) still wired into the calculation layer — 3 unreachable code paths |
| 2 | Prompt-budget guard passes on a light fixture; a realistic seed run measures 8,105 tokens vs Groq's 8,000 ceiling |
| 3 | Two unrelated fields both named `unvalidated`; QA closed an item on reasoning that applies to the wrong one |
| 4 | Pre-ADR-014 prompt instruction survives, contradicting the new rule 4 lines above it |
| 5 | 8 of 12 approved sources cannot reach a document — `gatherSupplementary()` has no caller |
| 6 | Revenue band reaches every prompt as `[object Object]` |
| 7 | `db:seed` pre-caches 4 of the 9 cache keys needed; cold offline run cannot produce the verdict |
| 8 | This checkout is comment-stripped — ~87 % of comment lines removed |

**Verified working as documented:** the gate's five invariants · `benchmark.resolve()` never
returns null and never throws · `combine()`'s three guarantees · the purity test · ADR-007
insert-only deliverables · both Day-5 browser bugs and the range-save bug fixed · ADR-015 Key
Figures and chart built before the model runs.

---

## 3. Caveat: this repository is comment-stripped

Zero `.ts`/`.tsx` files carry the `PURPOSE / WHY / DEPENDS / ADR` header block.

| | Lines | Comment lines |
|---|---:|---:|
| this repository | 11,798 | **172** |
| sibling `../../biz2code` | 14,616 | **1,309** |

SQL, Markdown and `.mjs` were untouched — `eslint.config.mjs` is the one surviving specimen.

**9 of the 85 files differ in code**, not only comments: `sources.service.ts`, `config/env.ts`,
`QuestionField.tsx`, `useDocuments.ts`, `probe-sources.ts`, `qa-generation-probe.ts` and three
spec files. The sibling also has four files this repo lacks (`checkpoint-day{2,3,4,5}.ts`). It
is a **different version**, not a commented edition.

---

## 4. Scope

**In:** `server/`, `client/`, `data/`, `.github/`, root config and launchers.
**Out:** AAAEE (historical only — one reference in the Master Plan; no code, schema or spec).
**Not verifiable:** anything needing git history — there is no `.git` directory.
