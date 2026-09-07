# 06 — Testing inventory

Phase 7. Every test file, what it covers, and — from the Phase 3 inventories — every exported
function with no test.

---

## 1. The verified totals

```bash
npm test
```

```
 ✓ services/benchmark.service.test.ts    (25 tests)   13ms
 ✓ services/calculation.service.test.ts  (48 tests)   27ms
 ✓ services/answer.service.test.ts       (21 tests)   12ms
 ✓ services/gate.service.test.ts         (20 tests)   17ms
 ✓ services/derivation.service.test.ts   (61 tests)  141ms
 ✓ services/llm.service.test.ts          (30 tests)  261ms
 ✓ middleware/error.test.ts              (11 tests)   13ms
 ✓ services/competitorTerms.test.ts      (10 tests)    8ms
 ✓ prompts/budget.test.ts                 (4 tests)    7ms
 ✓ services/sources.service.test.ts      (30 tests)   20ms

 Test Files  10 passed (10)
      Tests  260 passed (260)
   Duration  3.44s
```

**260 tests in 10 files. Sum verified:** 25+48+21+20+61+30+11+10+4+30 = **260**.

Offline and with no database — the whole suite ran in 3.44 s with Postgres stopped.

| Claim | Source | Verified |
|---|---|---|
| 260 unit tests | Master Plan §8, WORK_PLAN, QA-2026-08-24 | **✓** |
| 255 unit tests | [INSTALL.md](../../../../INSTALL.md) §7 | ✗ — it is 260 |
| 165 unit tests | [eslint.config.mjs](../../../../eslint.config.mjs) header | ✗ — stale |
| 154 tests, 6 files | [evidence/harness.txt](../qa/evidence/harness.txt) | stale evidence from 2026-08-22 |

### The four layers

| Layer | Command | Count | Needs | In CI? |
|---|---|---|---|---|
| **Unit** (Vitest) | `npm test` | **260** in 10 files | nothing | ✓ |
| **HTTP** (in-process probes) | `qa:api` + `qa:resilience` | **77** + **17** | Postgres | ✓ |
| **Adversarial** (live model) | `qa:generation` | **26** | Postgres + LLM quota | ✗ |
| **Browser** (Playwright) | `test:ui` | **23** in 2 files | Chromium | ✗ |
| **Live sources** | `probe:sources` | **11** | network | ✗ |
| **Data contract** | `validate:data` | 16 verticals | python3 | ✓ |

**Total automated checks: 414** (260 + 77 + 17 + 26 + 23 + 11).

**Note on the HTTP layer.** ARCHITECTURE §8 and the build guide **[sibling]** describe it as
*"Four HTTP checkpoints (243 assertions)"* run by `npm run checkpoint:day2..5`. **Those four
scripts do not exist in this repository** — see [07-gaps-and-drift.md](07-gaps-and-drift.md) D3.
The HTTP layer today is the two QA probes, 94 checks.

---

## 2. Unit tests, file by file

### `services/derivation.service.test.ts` — 488 lines, **61 tests**

The largest suite. Twelve `describe` blocks, one per exported function plus three integration
blocks.

| Block | Tests | Covers |
|---|---|---|
| `tamPeople` | 4 | the product, the caveats, both missing-input refusals |
| `samPeople` | 7 | percent, complement, **headcount replacing the base**, the independence warning, a missing segment figure, unsourced platform share, sourced platform share, unvalidated passthrough |
| `installsPerMonth` | 4 | the division, a zero budget, an unsourced CPI, a zero CPI |
| `monthlySurvival` | 4 | churn preferred, the D30 proxy admitted, neither sourced, 100 % churn refused |
| `project` | 4 | accumulation and decay, commission applied, **convergence**, a blocked input named |
| `judge` | 5 | supported / ambitious / unsupported, an unvalidated projection, no objective |
| `levers` | 4 | nothing when met, all three back-solves, not-back-solvable, "more time will not help" |
| `derive` against the real files | 6 | TAM/SAM sizing, **the purity test**, a verdict always returned, blame the benchmark, horizon honoured, horizon clamped |
| `marketModelFor` | 2 | B2B routed, everything else routed |
| `tamVenues` | 5 | generous count used, second count carried, no false disagreement, one source only, neither source |
| `marketCeilingRevenue` | 5 | the ceiling, commission deducted, unsourced commission ignored, "nobody achieves 100 %", missing inputs |
| `derive` on a B2B licence | 9 | venues not people, no segments or platform, no commission, ceiling refusal, **ceiling outranks a projection**, ceiling not fired inside the market, B2B wording, no conversion step, **churn never substituted by app retention** |
| the consumer ceiling | 1 | a consumer objective larger than the market |

**The test that carries the product's claim** (line 299):

```ts
it('never lets an objective influence the projection it is judged against', () => {
  const modest = derive(inputs({ objectiveRevenue: 1 }));
  const wild   = derive(inputs({ objectiveRevenue: 100_000_000 }));
  expect(modest.derivedMonthlyRevenue.value).toEqual(wild.derivedMonthlyRevenue.value);
});
```

Verified load-bearing in [02c-services-numbers.md](02c-services-numbers.md) §2.8 — the three
objective fields are read only after the projection completes.

**Six tests assert *intent*, not absence** — the rewrite Coding Guide §7.3 **[sibling]**
describes. `it('takes licence renewal from B2B churn, never from app retention')` asserts survival
is **0.955 from B2B churn**, not merely that it is unvalidated. That form survives the data
arriving; the earlier form did not.

### `services/calculation.service.test.ts` — 357 lines, **48 tests**

Guardrails first, formulas last — the file's stated ordering rule.

| Block | Tests | Notable |
|---|---|---|
| no NaN, no Infinity, ever | 6 | zero price, zero customers, zero CAC, zero conversion, `0/0`, **and a sweep driving every formula with 0, -0 and ±1e308** |
| a missing input poisons honestly | 5 | propagation, **the reason names the input**, a whole chain, an unanswered question, a placeholder benchmark |
| confidence inheritance | 6 | weakest tier, assumption ranked below tertiary, mixed inherits the guess, benchmarks-only keeps its tier, wholly-assumed caveat, **partly-assumed caveat** |
| the eleven formulas | 9 | one per formula group |
| store commission | 5 | charged, a genuine zero, refuses to guess, unanswered, "standard rate assumed" |
| the implied-lifetime cross-check | 4 | churn preferred, D30 fallback, infinite refused, neither sourced |
| comparisons | 5 | ARPU >2×, ARPU close, no ARPU benchmark, the 1.5 floor, **never asserts the unsourced 3:1** |
| reproducibility | 8 | identical across runs, the seed end to end, the floor cleared, the divergence flagged, proxy warnings propagated, ARPU unavailable, every formula returned for an unknown vertical, every question unanswered |

**The pathological sweep** (line 56) is the strongest single test in the suite —
`it('no formula returns a non-finite value for any pathological input')` drives every formula with
0, -0 and ±1e308 and asserts nothing non-finite escapes.

**Two naming defects.**

`describe('the eleven formulas')` contains 9 tests and the file exports **13** formula functions
([02c](02c-services-numbers.md) §1.5).

`it('arpu_effective = net / reachable')` passes `num(250000, 'people')` as the denominator. The
parameter is `payingCustomers`, and Master Plan §7 records the pre-v3.0 denominator as a defect —
*"ARPU was measuring the wrong denominator."* The arithmetic assertion passes either way, so the
test cannot catch a regression to the old behaviour.

### `services/sources.service.test.ts` — 299 lines, **30 tests**

Nine parser blocks plus the registry.

| Block | Tests |
|---|---|
| the source registry | 3 — publisher + resolvable URL for all 10, exactly two need a key, citation format |
| `parseCountryFacts` | 4 — identity/population/currency, the **M49 code** the UN API needs, malformed → null, no currency block |
| `parseEurostat` | 4 — latest not first, time index as an array, non-numeric holes skipped, no values |
| `parseOecd` | 3 — latest + period, the un-nested envelope, no series |
| `parseUnsd` | 3 — latest when unsorted, nulls dropped not coerced, nothing usable |
| `parseWikidata` | 3 — QID from the URI, no description, no matches → null |
| `parseCkan` | 3 — resolvable URL from the slug, **truncation before a prompt**, no match |
| `parseOxr` | 2 — the quote currency, absent currency |
| `parseCrossref` | 2 — title array flattened, at most three authors; no results |
| `parseGoogleBooks` | 3 — year from a partial date, unparseable date, no results |

**Every test is a fixture test.** No network. That is the split Coding Guide §3.2 **[sibling]**
describes and the reason `npm test` runs offline.

**Two parsers are missing.** `parseOverpassCount` and `parseWikidataCount` have no tests — and
they are **the only two whose fetchers reach the pipeline**. The suite covers nine parsers that
never run in production and skips the two that do.

### `services/llm.service.test.ts` — 308 lines, **30 tests**

| Block | Tests | Notable |
|---|---|---|
| the contract | 3 | never throws; **names what it tried**; survives non-JSON |
| the fallback ladder | 7 | primary stops there, one retry on malformed, drop to 20b, cross to Gemini, **413 skips the retry**, **429 skips the retry**, a timeout is a timeout |
| what counts as malformed | 5 | fences stripped, truncation rejected, missing key rejected, an array rejected, empty rejected |
| the guardrail preamble | 4 | lists exactly the sources given, **says what to do instead**, forbids recomputation, requires caveats carried |
| *(remaining)* | 11 | pacing, budget, `critiqueAnswers` disabled |

Fetch is mocked; `resetPacing()` and `__setPacingForTests(0)` neutralise the 2.5 s pacing so 30
tests run in 261 ms.

`it('names what it tried, so the document can say more than "the model failed"')` asserts the
`attempts[]` ledger — which is what makes a silent Gemini escalation diagnosable.

### `services/benchmark.service.test.ts` — 195 lines, **25 tests**

| Block | Tests |
|---|---|
| the contract: resolve always answers | 4 — never null, never throws, always explains, **shaped exactly like a real one** |
| resolution order | 6 — own figure preferred, cross-vertical fallback, fallback labelled, alias reported, **unknown vertical does not fall back**, placeholder does not block the aggregate |
| the unvalidated path | 5 — placeholder reported, **exactly one caveat**, `isUnvalidated` agrees, the 3:1 stays unvalidated, the 1.5 floor IS sourced |
| the six warnings Day 0 recorded | 6 — conflicts surfaced, every conflicting value carried, disagreement stated, the four proxy verticals, a proxy marked, **the demo vertical's two proxies** |
| the honesty contract at boot | 3 — every taxonomy vertical loaded, no sourced metric without a publisher, **no placeholder carries a value** |
| `resolveMany` | 1 |

**These tests assert facts about the corpus, not only about the code.** `it('flags the proxy
metrics in the four verticals Day 0 named')` and `it('the demo vertical carries proxies on both
figures the economics depend on')` would fail if the data changed — which is the point.

### `services/answer.service.test.ts` — 146 lines, **21 tests**

Five type blocks plus `the bank is the authority`.

Highlights: `it('refuses a boolean, which Number() would otherwise coerce to 0 or 1')` ·
`it('is case-sensitive, because the value is used as a key downstream')` ·
`it('deduplicates — the same option twice is a client bug, not a new answer')` ·
`it('every question in the bank can be answered')`.

That last one is a **corpus test**: it iterates the real bank and constructs a valid value for
each type, so adding a question with a type `toColumns` cannot handle fails here. It is the
coverage check the Coding Guide's recipe 8.2 step 8 **[sibling]** names.

**Only `toColumns` is covered.** `saveAnswer`, `saveAnswers`, `getAnswers` and
`getAnswersForPhase` have no direct test.

### `services/gate.service.test.ts` — 198 lines, **20 tests**

Runs against [server/test/fakeDb.ts](../../../../server/test/fakeDb.ts) (132 lines), not Postgres.

| Block | Tests |
|---|---|
| `canApprove` — completeness | 3 |
| `approvePhase` — the invariant | 5 |
| `revisePhase` | 4 |
| revise then re-approve — the demo path | 3 |
| `refreshPhaseStatus` | 4 |
| the fake database itself | 1 |

**`it('covers every statement the gate issues')`** is the meta-test: `fakeDb.query` throws
`fakeDb has no rule for: <sql>` on unrecognised SQL (line 122), so a query added to the gate fails
loudly rather than silently returning no rows.

**Answers are built from the real bank**, not hard-coded ids — so retiring a question would
surface here.

**One thing `fakeDb` cannot do:** its `transaction` is `fn(query)` (line 131) — no `BEGIN`, no
`ROLLBACK`. So no unit test can verify that `approvePhase`'s four statements roll back together.
That guarantee is covered only by `RACE-DOUBLE-APPROVE` in the resilience probe.

### `middleware/error.test.ts` — 101 lines, **11 tests**

The only middleware with unit coverage. Three blocks: `AppError`, foreign errors that know their
own status (labelled `DEF-01` from the QA assessment), and *anything else is a 500*.

Sharpest: `it('does NOT trust a foreign 5xx')` and `it('does not log a client error as a server
fault')`.

### `services/competitorTerms.test.ts` — 60 lines, **10 tests**

Covers the one exported function completely: parenthetical asides, splitting on `,`/`and`/`or`,
"nothing" as a non-answer, an unanswered question, descriptions dropped, over-long fragments,
case-insensitive dedupe, the 3-term cap, trailing punctuation, **and determinism**.

Determinism matters because the output becomes a cache key that `fetch-seed-data.ts` must
reproduce exactly.

### `prompts/budget.test.ts` — 113 lines, **4 tests**

Three per-template tests at `<= 7900`, plus one for the Business Plan with priors at `<= 8000`.
All pass.

**The fixture understates a real prompt.** It supplies `worldBank: []` and `itunes: []`
([budget.test.ts:76-81](../../../../server/prompts/budget.test.ts)), so `renderExternal` emits two
one-line fallbacks instead of ~2,000 characters. Measured both ways:

```
fixture (0 apps, 0 WB rows):  mrd 6940 · prd 7448 · bp 7461 · bp+prior 7603
realistic (5 apps, 2 WB rows): mrd 7442 · prd 7950 · bp 7964 · bp+prior 8105   ← over the 8000 ceiling
```

The fourth test also asserts `<= CEILING` rather than `<= CEILING - MIN_HEADROOM`, so the
100-token alarm margin is not applied to the case most likely to breach. Full detail in
[01-architecture.md](01-architecture.md) §1.2 under ADR-016.

---

## 3. Browser tests — 2 files, 497 lines, **23 tests**

Both use `test.describe.serial` — the tests share one account and one project, and run in order.

### `client/tests/journey.spec.ts` — 221 lines, **11 tests**

| # | Test |
|---|---|
| 1 | a visitor can create an account |
| 2 | the session survives a reload |
| 3 | the example project opens on phase 1 |
| 4 | **the stepper shows four phases on one row**, with later ones locked |
| 5 | the gate refuses an incomplete phase, and says which questions are missing |
| 6 | **answering enables the gate, and approving moves forward — not back** |
| 7 | an approved phase is locked until it is revised |
| 8 | the remaining three gates pass, and the project completes |
| 9 | the documents page offers generation and warns how long it takes |
| 10 | generation produces downloadable documents with visible badges — `test.setTimeout(300_000)` |
| 11 | signing out closes the protected pages |

**Tests 4 and 6 are the two regression tests for the bugs WORK_PLAN Day 5 records** — the
3-then-1 stepper wrap and the approve-then-bounce-back redirect. Both were found in a browser and
nothing else could catch them.

### `client/tests/extended-qa.spec.ts` — 276 lines, **12 tests**

`QA-01` … `QA-12`: auth validation, session persistence, seed creation, **responsive stepper at
multiple viewports**, each of the four phases, the revision flow, live generation
(`setTimeout(300_000)`), blank-project validation, and sign-out + route guards.

**Three QA-assessment defects were fixed in these files, all verified present:**

| Defect | Fix | Verified |
|---|---|---|
| 5 — a heading that never rendered | `getByRole('heading', {name: 'biz2code'})` repointed | the brand is an `<img alt>`; each page has its own `<h1>` |
| 6 — the helper could not drive half the demo set | `answerDemoQuestions` gained multiselect and range branches | both `p2q6` and `p4q8` are now drivable |
| 7 — generation outran the per-test timeout | `test.setTimeout(300_000)` in both generation tests | `grep -n "setTimeout(300_000)"` → one per file |

**One stale title remains.** `QA-06: Phase 2 External APIs, Reachable Market & Approval` names
*Reachable Market* — the concept ADR-012 retired. The test body was repointed (defect 3); the
title was not.

**Coverage note.** These 23 tests are the **only** automated coverage of `client/src` — all 22
files, 2,170 lines. There is no client unit-test runner
([05-build-and-tooling.md](05-build-and-tooling.md) §2).

---

## 4. Exports with no test — the full list

Compiled from the per-file inventories in [02a](02a-server-core.md) through
[03b](03b-frontend-state.md).

### Entirely untested modules (no test file exists)

| Module | Lines | Exports | Covered by |
|---|---|---|---|
| `server/index.ts` | 22 | 0 | — |
| `server/app.ts` | 80 | 1 | `qa:api` |
| `server/config/env.ts` | 32 | 1 | transitively |
| `server/db/pool.ts` | 6 | 1 | — |
| `server/db/query.ts` | 33 | 3 | the probes |
| `server/middleware/` × 6 (not `error.ts`) | 84 | 8 | `qa:api` |
| `server/routes/` × 5 | 76 | 5 | `qa:api` |
| `server/controllers/` × 5 | 242 | 17 | `qa:api` |
| `server/services/auth.service.ts` | 96 | 8 | `qa:api` |
| `server/services/project.service.ts` | 119 | 6 | `qa:api` |
| `server/services/questionBank.service.ts` | 100 | 6 | indirectly |
| `server/services/external.service.ts` | 142 | 8 | `probe:sources`, live generation |
| `server/services/derivationInputs.service.ts` | 132 | 3 | **nothing** |
| `server/services/generation.service.ts` | 394 | 10 | `qa:generation` |
| `server/services/docx.service.ts` | 260 | 7 | `qa:generation` |
| `server/services/chart.service.ts` | 247 | 3 | **nothing** |
| `server/prompts/context.ts` | 244 | 9 | `budget.test` length only |
| `server/prompts/figures.ts` | 165 | 1 | `qa:generation` |
| `server/scripts/` × 8 | 1,307 | 0 | they *are* harnesses |
| `client/src/**` × 22 | 2,170 | ~50 | Playwright only |

### Individually untested exports inside tested modules

| Module | Untested export | Note |
|---|---|---|
| `answer.service` | `saveAnswer`, `saveAnswers`, `getAnswers`, `getAnswersForPhase` | only `toColumns` is covered |
| `calculation.service` | `annualRecurringRevenue` | no direct assertion |
| `calculation.service` | `inputsFromAnswers` | end-to-end only |
| `sources.service` | **`parseOverpassCount`, `parseWikidataCount`** | the only two parsers that run in production |
| `sources.service` | all 11 fetchers | by design — they need a network |
| `sources.service` | **`gatherSupplementary`** | also has no production caller |
| `llm.service` | `budgetSnapshot` | no production caller either |
| `llm.service` | `critiqueAnswers`'s **enabled** path | ADR-011 predicted the rot; only the disabled path is tested |
| `benchmark.service` | — | all 13 exports covered |
| `derivation.service` | — | all 22 exports covered |
| `gate.service` | — | all 4 covered |
| `competitorTerms` | — | covered |

### The five gaps worth acting on

1. **`chart.service.ts` — 247 lines, zero tests.** Two of the project's recorded bugs lived here
   and were found by eye. `niceCeiling` and `compact` are pure; neither is exported, so neither
   can be tested as written.
2. **`figures.ts` + `docx.service.ts` — 425 lines, zero offline tests.** ADR-015's argument is
   that these must be exactly right; their only coverage needs a live model call.
3. **`parseOverpassCount` / `parseWikidataCount`.** The two production parsers, untested, while
   nine non-production ones have 30 tests between them.
4. **`derivationInputs.service.ts` — zero tests.** `band()`, `horizonMonths()` and `num()` are
   pure and could be tested offline; the module decides which country and which venue query the
   derivation sees.
5. **The client's commit/dedupe/re-sync logic.** Master Plan §7 records that the range-dedupe bug
   *"was invisible to 256 tests"*. It would be invisible to 260, because no unit test can reach
   `client/src`.

---

## 5. What the suite is good at, and what it is not

The build guide **[sibling]** §8.2 lists four bugs that reached production past a green suite,
and all four share a shape:

| Bug | Why the suite missed it |
|---|---|
| A range field that could never save | `client/src` has no unit tests at all |
| A B2B licence given a 1.05-month lifetime | every formula was correct; the *input* was the wrong kind of number |
| Two chart defects | no test renders the image |
| Documents silently from the fallback provider | nothing failed — it was visible only in the provenance |

> *"A test suite is very good at catching things that throw and much worse at catching things
> that merely lie."*

Two findings in this audit are of the same class and are still open: the budget guard passing on
an unrealistically light fixture ([01](01-architecture.md) §1.2), and the `unvalidated_fields`
conflation that makes `GRD-MARKER-SURVIVES` mean something other than it reports
([02e](02e-services-generation.md) §1.5).

**Where the suite is genuinely strong:** the guardrail-first ordering in
`calculation.service.test.ts`, the intent-not-absence rewrites in `derivation.service.test.ts`,
`fakeDb`'s throw-on-unknown-SQL, and the corpus tests in `benchmark.service.test.ts` and
`answer.service.test.ts` that would fail if the *data* drifted rather than the code.

---

*Next: [07-gaps-and-drift.md](07-gaps-and-drift.md).*
