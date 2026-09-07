# 06 — Testing inventory (minimal)

## 1. Totals

**260 tests in 10 files, 3.44 s, offline, with Postgres stopped.**

| File | Tests | ms |
|---|---:|---:|
| `services/derivation.service.test.ts` | 61 | 141 |
| `services/calculation.service.test.ts` | 48 | 27 |
| `services/llm.service.test.ts` | 30 | 261 |
| `services/sources.service.test.ts` | 30 | 20 |
| `services/benchmark.service.test.ts` | 25 | 13 |
| `services/answer.service.test.ts` | 21 | 12 |
| `services/gate.service.test.ts` | 20 | 17 |
| `middleware/error.test.ts` | 11 | 13 |
| `services/competitorTerms.test.ts` | 10 | 8 |
| `prompts/budget.test.ts` | 4 | 7 |

| Claim | Source | Verified |
|---|---|---|
| 260 unit tests | Master Plan §8, WORK_PLAN, QA-2026-08-24 | **✓** |
| 255 | INSTALL §7 | ✗ |
| 165 | `eslint.config.mjs` header | ✗ stale |
| 154 in 6 files | `evidence/harness.txt` | stale (2026-08-22) |

### The layers

| Layer | Command | Count | Needs | CI? |
|---|---|---:|---|---|
| **Unit** (Vitest) | `npm test` | **260** | nothing | ✓ |
| **HTTP** (in-process probes) | `qa:api` + `qa:resilience` | **77** + **17** | Postgres | ✓ |
| **Adversarial** (live model) | `qa:generation` | **26** | Postgres + LLM quota | ✗ |
| **Browser** (Playwright) | `test:ui` | **23** | Chromium | ✗ |
| **Live sources** | `probe:sources` | **11** | network | ✗ |
| **Data contract** | `validate:data` | 16 verticals | python3 | ✓ |

**Total automated checks: 414.**

ARCHITECTURE §8 describes the HTTP layer as *"Four HTTP checkpoints (243 assertions)"* run by
`checkpoint:day2..5`. **Those scripts do not exist** (**D3**); the HTTP layer today is 94 checks.

---

## 2. Unit tests, file by file

### `derivation.service.test.ts` — 488 lines, **61 tests** — the largest suite

| Block | Tests | Covers |
|---|---:|---|
| `tamPeople` | 4 | the product, the caveats, both missing-input refusals |
| `samPeople` | 7 | percent, complement, **headcount replacing the base**, independence warning, missing segment, unsourced/sourced platform share, unvalidated passthrough |
| `installsPerMonth` | 4 | the division, zero budget, unsourced CPI, zero CPI |
| `monthlySurvival` | 4 | churn preferred, D30 proxy admitted, neither sourced, 100 % churn refused |
| `project` | 4 | accumulation and decay, commission applied, **convergence**, a blocked input named |
| `judge` | 5 | supported / ambitious / unsupported, unvalidated projection, no objective |
| `levers` | 4 | nothing when met, all three back-solves, not-back-solvable, "more time will not help" |
| `derive` (real files) | 6 | TAM/SAM sizing, **the purity test**, a verdict always returned, blame the benchmark, horizon honoured and clamped |
| `marketModelFor` | 2 | B2B routed, everything else routed |
| `tamVenues` | 5 | generous count used, second carried, no false disagreement, one source, neither |
| `marketCeilingRevenue` | 5 | the ceiling, commission deducted, unsourced commission ignored, "nobody achieves 100 %", missing inputs |
| `derive` on B2B | 9 | venues not people, no segments/platform/commission, ceiling refusal, **ceiling outranks a projection**, B2B wording, no conversion step, **churn never substituted by app retention** |
| the consumer ceiling | 1 | a consumer objective larger than the market |

```ts
it('never lets an objective influence the projection it is judged against', () => {
  const modest = derive(inputs({ objectiveRevenue: 1 }));
  const wild   = derive(inputs({ objectiveRevenue: 100_000_000 }));
  expect(modest.derivedMonthlyRevenue.value).toEqual(wild.derivedMonthlyRevenue.value);
});
```

**Six tests assert *intent*, not absence** — `it('takes licence renewal from B2B churn, never from
app retention')` asserts survival is **0.955 from B2B churn**, not merely that it is unvalidated.
That form survives the data arriving; the earlier form did not.

### `calculation.service.test.ts` — 357 lines, **48 tests** — guardrails first, formulas last

| Block | Tests | Notable |
|---|---:|---|
| no NaN, no Infinity, ever | 6 | zero price/customers/CAC/conversion, `0/0`, **plus a sweep driving every formula with 0, -0 and ±1e308** |
| a missing input poisons honestly | 5 | propagation, **the reason names the input**, a whole chain, unanswered question, placeholder benchmark |
| confidence inheritance | 6 | weakest tier, assumption below tertiary, mixed inherits the guess, benchmarks keep their tier, wholly- and **partly-assumed** caveats |
| the eleven formulas | 9 | one per formula group |
| store commission | 5 | charged, a genuine zero, refuses to guess, unanswered, "standard rate assumed" |
| implied-lifetime cross-check | 4 | churn preferred, D30 fallback, infinite refused, neither sourced |
| comparisons | 5 | ARPU >2×, ARPU close, no benchmark, the 1.5 floor, **never asserts the unsourced 3:1** |
| reproducibility | 8 | identical across runs, seed end to end, floor cleared, divergence flagged, proxy warnings propagated, ARPU unavailable, unknown vertical, every question unanswered |

**Two naming defects:** `describe('the eleven formulas')` holds 9 tests while the file exports
**13**; and `it('arpu_effective = net / reachable')` passes a `people` figure as the denominator,
describing the pre-v3.0 behaviour recorded as a defect. Both pass either way, so neither can catch
a regression.

### `sources.service.test.ts` — 299 lines, **30 tests**

Nine parser blocks plus the registry: `parseCountryFacts` 4 (incl. the **M49 code** the UN API
needs) · `parseEurostat` 4 · `parseOecd` 3 · `parseUnsd` 3 · `parseWikidata` 3 · `parseCkan` 3
(incl. **truncation before a prompt**) · `parseOxr` 2 · `parseCrossref` 2 · `parseGoogleBooks` 3 ·
registry 3.

**Every test is a fixture test** — no network, which is why `npm test` runs offline.
**Two parsers are missing:** `parseOverpassCount` and `parseWikidataCount` — **the only two whose
fetchers reach the pipeline.**

### `llm.service.test.ts` — 308 lines, **30 tests**

| Block | Tests | Notable |
|---|---:|---|
| the contract | 3 | never throws; **names what it tried**; survives non-JSON |
| the fallback ladder | 7 | primary stops there, one retry on malformed, drop to 20b, cross to Gemini, **413 skips the retry**, **429 skips the retry**, a timeout is a timeout |
| what counts as malformed | 5 | fences stripped, truncation rejected, missing key rejected, an array rejected, empty rejected |
| the guardrail preamble | 4 | lists exactly the sources given, **says what to do instead**, forbids recomputation, requires caveats carried |
| remaining | 11 | pacing, budget, `critiqueAnswers` disabled |

Fetch is mocked; `resetPacing()` + `__setPacingForTests(0)` neutralise the 2.5 s pacing.

### `benchmark.service.test.ts` — 195 lines, **25 tests**

| Block | Tests |
|---|---:|
| resolve always answers | 4 — never null, never throws, always explains, **shaped exactly like a real one** |
| resolution order | 6 — own figure preferred, cross-vertical fallback labelled, alias reported, **unknown vertical does not fall back**, placeholder does not block the aggregate |
| the unvalidated path | 5 — placeholder reported, **exactly one caveat**, `isUnvalidated` agrees, the 3:1 stays unvalidated, the 1.5 floor IS sourced |
| the six Day-0 warnings | 6 — conflicts surfaced and carried, the four proxy verticals, **the demo vertical's two proxies** |
| the contract at boot | 3 — every taxonomy vertical loaded, no sourced metric without a publisher, **no placeholder carries a value** |
| `resolveMany` | 1 |

**These assert facts about the corpus, not only the code** — they would fail if the data changed.

### `answer.service.test.ts` — 146 lines, **21 tests**

Five type blocks plus *the bank is the authority*. Highlights: refuses a boolean (which `Number()`
would coerce to 0/1) · case-sensitive, because the value is a key downstream · deduplicates ·
**`it('every question in the bank can be answered')`**, a corpus test over the real bank.

**Only `toColumns` is covered** — `saveAnswer`, `saveAnswers`, `getAnswers`,
`getAnswersForPhase` have no direct test.

### `gate.service.test.ts` — 198 lines, **20 tests**

Runs against `server/test/fakeDb.ts` (132 lines): `canApprove` 3 · `approvePhase` 5 ·
`revisePhase` 4 · revise-then-re-approve (the demo path) 3 · `refreshPhaseStatus` 4 · the fake
database itself 1.

**`it('covers every statement the gate issues')`** is the meta-test — `fakeDb.query` throws
`fakeDb has no rule for: <sql>`, so a query added to the gate fails loudly. Answers are built from
the real bank, so retiring a question would surface here.

**`fakeDb`'s `transaction` is `fn(query)`** — no `BEGIN`, no `ROLLBACK`. No unit test can verify
`approvePhase`'s four statements roll back together; only `RACE-DOUBLE-APPROVE` covers that.

### `middleware/error.test.ts` — 101 lines, **11 tests**

The only middleware with unit coverage. Three blocks: `AppError` · foreign errors that know their
own status (`DEF-01`) · *anything else is a 500*. Sharpest: `it('does NOT trust a foreign 5xx')`,
`it('does not log a client error as a server fault')`.

### `competitorTerms.test.ts` — 60 lines, **10 tests**

Covers the one exported function completely, **including determinism** — the output becomes a
cache key `fetch-seed-data.ts` must reproduce exactly.

### `prompts/budget.test.ts` — 113 lines, **4 tests**

Three per-template tests at `<= 7900`, plus the Business Plan with priors at `<= 8000`. All pass.
**The fixture understates a real prompt** (`worldBank: []`, `itunes: []`):

```
fixture (0 apps, 0 WB rows):   mrd 6940 · prd 7448 · bp 7461 · bp+prior 7603
realistic (5 apps, 2 WB rows): mrd 7442 · prd 7950 · bp 7964 · bp+prior 8105   ← over the ceiling
```

The fourth test also asserts `<= CEILING` rather than `<= CEILING - MIN_HEADROOM`.

---

## 3. Browser tests — 2 files, 497 lines, **23 tests**

Both use `test.describe.serial` — one shared account and project, run in order.

**`journey.spec.ts` (221 lines, 11):** create an account · the session survives a reload · the
example project opens on phase 1 · **the stepper shows four phases on one row**, later ones locked
· the gate refuses an incomplete phase and names the missing questions · **answering enables the
gate, and approving moves forward — not back** · an approved phase is locked until revised · the
remaining three gates pass · the documents page warns how long generation takes · generation
produces downloadable documents with visible badges (`setTimeout(300_000)`) · signing out closes
the protected pages.

**Tests 4 and 6 are the regression tests for the two Day-5 bugs** — the 3-then-1 stepper wrap and
the approve-then-bounce-back redirect. Both were found in a browser and nothing else could catch
them.

**`extended-qa.spec.ts` (276 lines, 12):** `QA-01`…`QA-12` — auth validation, session persistence,
seed creation, **responsive stepper at multiple viewports**, each of the four phases, the revision
flow, live generation, blank-project validation, sign-out + route guards.

| Fixed defect | Fix |
|---|---|
| A heading that never rendered | the assertion repointed — the brand is an `<img alt>` |
| The helper could not drive half the demo set | `answerDemoQuestions` gained multiselect and range branches |
| Generation outran the per-test timeout | `test.setTimeout(300_000)` in both generation tests |

**One stale title remains:** `QA-06: Phase 2 External APIs, Reachable Market & Approval` names a
concept ADR-012 retired. The body was repointed; the title was not.

These 23 tests are the **only** automated coverage of `client/src` — 22 files, 2,170 lines.

---

## 4. Exports with no test

### Entirely untested modules

| Module | Lines | Exports | Covered by |
|---|---:|---:|---|
| `index.ts` · `app.ts` · `config/env.ts` · `db/pool.ts` · `db/query.ts` | 173 | 6 | `qa:api`, the probes |
| `middleware/` × 6 (not `error.ts`) · `routes/` × 5 · `controllers/` × 5 | 402 | 30 | `qa:api` |
| `auth.service.ts` · `project.service.ts` · `questionBank.service.ts` | 315 | 20 | `qa:api`, indirectly |
| `external.service.ts` | 142 | 8 | `probe:sources`, live generation |
| `derivationInputs.service.ts` | 132 | 3 | **nothing** |
| `chart.service.ts` | 247 | 3 | **nothing** |
| `generation.service.ts` · `docx.service.ts` · `prompts/figures.ts` | 819 | 18 | `qa:generation` |
| `prompts/context.ts` | 244 | 9 | `budget.test` length only |
| `scripts/` × 8 | 1,307 | 0 | they *are* harnesses |
| `client/src/**` × 22 | 2,170 | ~50 | Playwright only |

### Untested exports inside tested modules

| Module | Untested export |
|---|---|
| `answer.service` | `saveAnswer`, `saveAnswers`, `getAnswers`, `getAnswersForPhase` — only `toColumns` is covered |
| `calculation.service` | `annualRecurringRevenue` (no direct assertion); `inputsFromAnswers` (end-to-end only) |
| `sources.service` | **`parseOverpassCount`, `parseWikidataCount`** — the only two parsers that run in production; all 11 fetchers (by design); **`gatherSupplementary`** (also uncalled) |
| `llm.service` | `budgetSnapshot` (no production caller); `critiqueAnswers`'s **enabled** path |
| `benchmark` · `derivation` · `gate` · `competitorTerms` | — all exports covered |

### The five gaps worth acting on

1. **`chart.service.ts` — 247 lines, zero tests.** Two recorded bugs lived here and were found by
   eye. `niceCeiling` and `compact` are pure but not exported.
2. **`figures.ts` + `docx.service.ts` — 425 lines, zero offline tests.** ADR-015 argues these must
   be exactly right; their only coverage needs a live model call.
3. **`parseOverpassCount` / `parseWikidataCount`** — the two production parsers, untested, while
   nine non-production ones have 30 tests between them.
4. **`derivationInputs.service.ts` — zero tests.** `band()`, `horizonMonths()` and `num()` are
   pure and could be tested offline.
5. **The client's commit/dedupe/re-sync logic.** The range-dedupe bug was invisible to 256 tests
   and would be invisible to 260 — no unit test can reach `client/src`.

---

## 5. What the suite is good at, and what it is not

Four bugs reached production past a green suite, all sharing a shape:

| Bug | Why the suite missed it |
|---|---|
| A range field that could never save | `client/src` has no unit tests at all |
| A B2B licence given a 1.05-month lifetime | every formula was correct; the *input* was the wrong kind of number |
| Two chart defects | no test renders the image |
| Documents silently from the fallback provider | nothing failed — visible only in the provenance |

> *"A test suite is very good at catching things that throw and much worse at catching things
> that merely lie."*

Two findings in this audit are of the same class and still open: **D22** (the budget guard on a
light fixture) and **D17** (the `unvalidated_fields` conflation that makes `GRD-MARKER-SURVIVES`
mean something other than it reports).

**Where the suite is strong:** the guardrail-first ordering in `calculation.service.test.ts`, the
intent-not-absence rewrites in `derivation.service.test.ts`, `fakeDb`'s throw-on-unknown-SQL, and
the corpus tests in `benchmark.service.test.ts` and `answer.service.test.ts` that would fail if
the *data* drifted rather than the code.
