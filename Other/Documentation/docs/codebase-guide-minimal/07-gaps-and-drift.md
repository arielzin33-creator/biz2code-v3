# 07 — Gaps, debt and documentation drift (minimal)

Severity: **High** = affects output correctness or a stated guarantee · **Medium** = misleads a
reader or maintainer · **Low** = cosmetic or inert.

---

## A. The repository-level finding

### A1. This checkout is comment-stripped

Zero files in `server/` or `client/src` contain the `PURPOSE / WHY / DEPENDS / ADR` header block.
49 of 85 TS/TSX files begin with **no comment at all** — 47 with exactly two blank lines, and
`gate.service.ts` with seven.

| | Files | Lines | Comment lines |
|---|---:|---:|---:|
| `biz2code-v3.0-clean` (this repo) | 85 | 11,798 | **172** |
| sibling `../../biz2code` | 85 | 14,616 | **1,309** |

**~87 % of comment lines removed; 2,818 lines shorter.** SQL and Markdown untouched, `.mjs` missed
— hence `eslint.config.mjs` as the one surviving specimen.

- *"Roughly nine percent of the server is comments"* describes 1,309/14,616. Here: **1.5 %**.
- Master Plan §3's *"87 TypeScript files, roughly 15,100 lines"* — file count matches exactly;
  the line count describes the un-stripped source. Measured here: **11,861**.
- Every `WHY` is gone — and it is invisible from inside this checkout.

**The sibling is not a substitute.** A character-level, string-aware comparison found **76 of 85
files identical** and **9 genuinely different**: `sources.service.ts` (15,194 vs 17,534 chars),
`config/env.ts`, `QuestionField.tsx`, `useDocuments.ts`, `probe-sources.ts`,
`qa-generation-probe.ts`, `extended-qa.spec.ts`, `journey.spec.ts`, `qa-api-probe.ts`. It also
contains four files this repo lacks: `checkpoint-day{2,3,4,5}.ts`.

---

## B. Master Plan §10's limitations, re-verified

| # | Claim | Status |
|---|---|---|
| 1 | *"43 of 194 metrics are sourced"* | **Still true** |
| 2 | *"`install_to_paid_pct` is 0/16 — blocks a consumer projection outright"* | **Still true, worse than stated** — the key is `store_conversion_pct`: 0 of 16, **and absent from the cross-vertical file**, so no fallback and no alias. `project()` short-circuits on it, so every consumer SOM, revenue figure and verdict is unvalidated |
| 3 | *"The unvalidated marker depends on the model's cooperation"* | **Still true — and the QA assessment wrongly closed it.** See D17 |
| 4 | *"Benchmark selection ignores the business model"* | **Still true** — `context.ts:238` renders the 9 calculation keys, never `DERIVATION_BENCHMARK_KEYS`. A B2B run shows consumer CPI and retention and **hides** the two figures its projection rests on |
| 5 | *"The competitor search is noisy"* | **Still true** — dedupe by `trackName` only; nothing filters by publisher. `competitorSearchTerms` itself is correct |
| 6 | *"Platform share has no source"* | **True, with a sharper cause** — not "unsourced at runtime" but **hard-coded** `null` at `derivationInputs.service.ts:121-122`. The applying branch is reachable only from tests, and `DERIVATION_QUESTIONS.platforms` is never read |
| 7 | *"Local only. One user, no roles"* | **Still true** |
| 8 | *"The guardrail constrains what the model may cite, not how well it writes"* | Not falsifiable by inspection |

### The Master Plan's "Known debt"

| Item | Status |
|---|---|
| `checkpoint:day3/4/5` | **Gone** — files and npm scripts do not exist (D3) |
| `qa-api-probe` | **Fixed** — `API-044`/`API-045` repointed at `p4q2` |
| `rehearse` | **Still broken** — saves an answer to `p2q3`, throwing `AppError(404)` |
| *(not listed)* | **`calculation.service.ts` also still references all three** — and it is application code (D7) |

Two of the three named items are resolved; a fourth, in the production calculation layer, was
never named.

---

## C. WORK_PLAN's deviations, re-verified

**C1. *"Revise regenerates all three documents."*** Still true — `generateAll` always iterates the
full `GENERATION_ORDER`; no partial path, no reference to `feeds` anywhere. The supporting claim
*"every question carries a `feeds` array, so the mechanism exists"* is accurate about the **data**
and not the code.

**C2. The "done" checklist**

| Item | Status |
|---|---|
| *"Unit tests pass — 260/260"* | **✓** |
| *"`npm run lint` (0 errors)"* | **✓** — 0 errors, 29 warnings |
| *"13 branches, 28 commits, every merge `--no-ff`"* | **Unverifiable** — no `.git` directory |
| *"74 of 74 source files carry a header comment, zero TODOs"* | **Half true** — zero TODOs confirmed; **36 of 85** files begin with a header, all single-line |
| *"a CI workflow running…"* | **✓** — all seven steps present |
| *"`checkpoint:day2` — 63/63… `day5` — 59/59"* | **Unverifiable** — the scripts do not exist |

**C3. Day-5 bugs — both fixed.** `if (project.isFetching) return;` at `PhasePage.tsx:32`;
`repeat(auto-fit, minmax(150px, 1fr))` at `PhaseStepper.tsx:28`.

**C4. Master Plan §7 corrections**

| Correction | Verified |
|---|---|
| *"A range field that could never save"* | **Fixed** — the `isRange` branch in `commit` |
| *"Two chart bugs"* | **Fixed** — the rotation and `niceCeiling`'s round-the-step |
| *"ARPU was measuring the wrong denominator"* | **Fixed in code, not in the test** — the test is still named `arpu_effective = net / reachable` |
| *"The prompt is a budgeted resource"* | **Guarded, but the guard does not hold** — D22 |
| *"A metric with no definition is worse than a missing one"* | `store_conversion_pct` now has a `description`; still 0/16 |

---

## D. The discrepancy register — 24 findings

| # | Finding | Sev |
|---|---|---|
| **D1** | The Coding Guide and *How this app was built* live at `../../Other/Guides/*.docx`, outside the repository. `FILE_INDEX.md` and the Master Plan reference conventions only those documents define | Low |
| **D2** | **Documentation paths do not match the tree, both directions.** Docs are at `Other/Documentation/docs/`, not `docs/`. All three QA probes write to `resolve(ROOT, 'docs', …)` and call `mkdirSync(…, {recursive:true})`, silently creating a second tree at the repo root — so the committed evidence cannot be refreshed by running the probes | Med |
| **D3** | **The four HTTP checkpoint scripts do not exist.** Referenced by WORK_PLAN (×4 with pass counts), Master Plan §8, FILE_INDEX, ARCHITECTURE §8, the build guide. **An entire documented verification layer is absent** — including the type-mirror drift check WORK_PLAN credits it with | **High** |
| **D4** | `ARCHITECTURE.md` §6's backend tree is wrong in three places: `config/constants.ts` does not exist · `data/` is at the repo root, not under `server/` · there are three migrations, not one | Med |
| **D5** | **The question count is stated as 24 in four places; it is 23.** WORK_PLAN, README, INSTALL and the seed file's `demoProtocol` say 24; `ProjectsPage.tsx:118` says "16 of its 21"; the Master Plan and the QA assessment say 23 ✓. The pre-filled figure is **18** | Med |
| **D6** | **`_schema.json` forbids the `tertiary` tier 31 metrics use.** Its enum has three values; both real validators accept four. Nothing runs the JSON Schema, so it is latent. `ARCHITECTURE.md` separately claims **five** tiers including `assumption`, which appears in zero benchmark files | Med |
| **D7** | **Retired question ids wired into the calculation layer** — see below | **High** |
| **D8** | **ADR-012's "arbitrary 0.6 ratio" is still in the verdict** — `band()` survives, and the adoption verdict is judged with no floor, so 0.6 grades half the verdict. The band replaced it for revenue only | Med |
| **D9** | **Generation time is stated as four different values:** seed `demoProtocol` "about 70 s" · WORK_PLAN 68.6 s · ARCHITECTURE 120-200 s · `useDocuments.ts` 180 · `rehearse.ts` "~70 s" · measured **126-192 s**. Only the UI value was corrected | Low |
| **D10** | **The formula count is 11, 12, 13 or 16** — ADR-008/file header/test/WORK_PLAN say 11 (the test block containing 9 tests); Master Plan and the Coding Guide say 12; `question-bank.json` lists 16; the source exports **13** + 3 comparisons | Med |
| **D11** | ADR-004 says five tables; `001_init.sql` creates six, and `migrate.ts` a seventh | Low |
| **D12** | **`FILE_INDEX.md` omits ~20 files and lists 4 that do not exist.** Missing: `derivation.service`, `derivationInputs.service`, `sources.service`, `chart.service`, `prompts/figures`, `prompts/budget.test`, `middleware/origin`, `middleware/async`, all three `components/ui/`, `styles/tokens.css`, `tests/extended-qa.spec`, and every script except `rehearse`. Listed but absent: the four checkpoints. Its premise — *"the full rationale sits in the header of the file itself"* — is void here | Med |
| **D13** | `INSTALL.md` says 255 unit tests; `eslint.config.mjs` says 165; `harness.txt` records 154 in 6 files. There are **260** | Low |
| **D14** | Master Plan's *"roughly 15,100 lines"* describes the un-stripped source; here it is **11,861** | Low |
| **D15** | Master Plan §11 names five companion documents; **Coach Instructions** and **How We Work** do not exist | Low |
| **D16** | **Eight of twelve approved sources cannot reach a document** — see below | **High** |
| **D17** | **`unvalidated` means two different things** — see below | **High** |
| **D18** | **The pre-ADR-014 instruction survives** — see below | **High** |
| **D19** | **The revenue band reaches every prompt as `[object Object]`** — see below | **High** |
| **D20** | **Two of `UnvalidatedBadge`'s three kinds can never render.** Its only caller passes `Deliverable.unvalidated` reasons, which are exactly three strings, none containing `PROXY`/`DISAGREE`/`CONFLICT`. The proxy and conflict caveats **are** computed — they flow into the prompt and the Key Figures **Basis** column, not into `Deliverable.unvalidated` | Med |
| **D21** | **`db:seed` pre-caches 4 of the 9 keys the pipeline needs** — see below | **High** |
| **D22** | **The budget guard passes on a fixture ~500 tokens lighter than a real run** — see below | **High** |
| **D23** | **The cross-vertical benchmark file is never validated by CI.** `validate_benchmarks.py` iterates the taxonomy's 16 verticals; `_cross_vertical_default` is not among them. So the 28-metric fallback file — the LTV:CAC floor, the app-store commission, the three Android vitals thresholds, both B2B benchmarks — is checked only at boot. It also has **no `coverage` block**, so its 2 PROXY metrics and 1 conflict raise no warning. The two validators also discover files differently (TS scans the directory, Python iterates the taxonomy) | Med |
| **D24** | **`seed-project.json`'s demo protocol contradicts the file it lives in** — `clearedOnLoad` includes retired `p2q3` and disagrees with both `purpose` and the `clearOnDemo` flags the code reads; `steps[2]` and `steps[4]` reference retired questions; `purpose` says "19 of the 24" (it is 18 of 23). `clearedOnLoad` is **dead** — but it is the list a reader following the protocol would use | Med |

### D7 — Retired ids in the calculation layer

```ts
export const ECONOMIC_QUESTIONS = {
  reachableMarket:        'p2q3',   // retired by ADR-012
  conversionPct:          'p4q3',   // retired
  expectedLifetimeMonths: 'p4q6',   // retired
  …
};
```

| Path | Line | Effect |
|---|---|---|
| `payingUsers(reachableMarket, conversionPct)` | 372 | never called — `derivedPayers` is always supplied |
| `cacEstimate(fromBenchmark(cpi), conversionPct)` | 380 | never called — `derivedCac` is always supplied |
| `assumption(input.expectedLifetimeMonths, …)` | 383-384 | unreachable — the value is always `null` |

1. **The prompt narrates a derived figure as an answer** —
   `fig('Expected customer lifetime (the founder answered this)', calc.expectedLifetimeMonths)`.
2. **`lifetimeDivergence`'s prose says *"You expect a paying customer to stay N months"*** for a
   figure the app derived.
3. **The lifetime comparison now compares two derived figures** — the derivation's implied
   lifetime against the calculation layer's. For B2B they use different benchmarks and diverge
   sharply, presenting a large gap between two figures neither of which the founder supplied.

This is ADR-012's failure mode inverted: narrating a derivation as the founder's assumption.

### D16 — Eight of twelve sources cannot reach a document

`gatherSupplementary()` — which would fetch REST Countries, FX, data.gov.il, Wikidata entities,
Crossref and Google Books — **has no caller** (grep finds only the definition).

| Reaches a document | Reachable only from `probe-sources.ts` |
|---|---|
| `worldbank`, `itunes`, `overpass`, `wikidata` (Israel only) | `restcountries`, `eurostat`, `oecd`, `unsd`, `datagovil`, `crossref`, `googlebooks`, `openexchangerates` |

The allow-list is not artificially narrow — it is exactly as wide as the pipeline.
ARCHITECTURE §2's system-context diagram does not describe the current call graph, nor does
ADR-009's amendment, which reads as though widening the set widened what may be cited.

**Related:** the QA follow-up kept the `restcountries` fetcher *"because `countryFacts` gates the
`datagovil` lookup"* — but `REST_COUNTRIES_KEY = null` makes `countryFacts` return `null`
unconditionally, so `isIsrael` is always false and `israeliDatasets` can never be called. The gate
was severed as thoroughly as deletion would have severed it. `probe:sources` still reports
`datagovil` reachable because it calls the fetcher directly.

### D17 — `unvalidated` means two different things

| Field | Where | Deterministic? |
|---|---|---|
| `Resolved.unvalidated` | `benchmark.service.ts:124` — `value === null \|\| confidence === 'placeholder'` | **Yes** |
| `GenerationOutcome.unvalidated` | `generation.service.ts:203-213` | **No** |

```ts
} else if (modelFlagged.has(field.key)) {
  reason = 'The model reported that it could not fully source this field from the approved data.';
}
```

`modelFlagged` comes from `content.unvalidated_fields` — the model's own JSON key.
`Resolved.unvalidated` **never flows into** `GenerationOutcome.unvalidated`.

The QA assessment calls `GRD-MARKER-SURVIVES` a *"test-design false positive"* because
*"`unvalidated` is computed deterministically in `benchmark.service.ts:124`"* — reasoning that
applies to the wrong field. The same incorrect comment is embedded at `qa-generation-probe.ts:98-104`.

**ADR-014's own assessment is the accurate one:** *"judgement can be manipulated… That is a real
regression, recorded rather than hidden."* The QA assessment closed an item ADR-014 correctly left
open.

### D18 — The pre-ADR-014 instruction survives

`prompts/documents.ts:46-50`:

```
    If every figure you used came from the supplied context, return an empty array.
    The key names above whose content you
      could not fully source. Include a key here whenever you had to write around
      a missing figure. An empty array claims everything is sourced, so use it
      only when that is true.
```

An orphaned fragment beginning mid-sentence, whose operative instruction is precisely what lines
37-40 forbid. The model receives both rules in one block, four lines apart.

**Related:** the MRD's `market_audience_sizing` still instructs the model to write *"the reachable
market **the founder stated**"* — a figure ADR-012 retired.

### D19 — The revenue band as `[object Object]`

```ts
const readAnswer = (a: AnswerRow): string => {
  if (a.value_json) return Array.isArray(a.value_json) ? a.value_json.join(', ') : String(a.value_json);
  …
};
```

`p4q8`'s `value_json` is `{min, max}` — not an array — so every prompt's ANSWERS section shows:

```
  Q: What monthly revenue would make this worth doing?
  A: [object Object]
```

The same `String()`-on-an-object trap as the range-save bug; that one was fixed in
`QuestionField`, this one was not.

**Masked, not harmless** — the band's real values reach the model via `renderDerivation`'s verdict
prose and the Key Figures table, so the document is still correct. But ANSWERS is the section the
MRD and PRD are instructed to ground their claims in.

### D21 — 4 of 9 cache keys seeded

| # | Cache key | Seeded? | Needed by |
|---|---|---|---|
| 1 | `worldbank / country/israel` | **no** | `resolveCountry` |
| 2 | `worldbank / countries` | **no** | `countryList` |
| 3-4 | `worldbank / ISR/SP.POP.TOTL`, `ISR/IT.NET.USER.ZS` | ✓ | `gatherExternal` |
| 5-6 | `itunes / Google Maps\|Waze /IL` | ✓ | `gatherExternal` |
| 7 | `worldbank / ISR/SP.URB.TOTL.IN.ZS` | **no** | `resolveSegments` |
| 8 | `overpass / IL/shop=department_store,shop=mall` | **no** | **TAM** |
| 9 | `wikidata / count/Q11315/Q801` | **no** | the venue range |

Cold and offline: #1 and #2 miss → `resolveCountry` returns `null` → `wbCountry = 'WLD'` → the
pipeline requests `WLD/SP.POP.TOTL`, also uncached. **The seeded `ISR/…` rows are never reached.**
And #8 missing makes `tamVenues` unvalidated, so the seed project's headline $195,300 ceiling
cannot be produced at all.

ARCHITECTURE §8's *"all five external lookups were served from cache"* is consistent with a
**warm** database, and counts five because it counts only two hosts. `rehearse.ts`'s preflight
compares against `seed.externalCache` only, reports `4/4`, and cannot see the gap.

### D22 — The budget guard

`budget.test.ts:76-81` supplies `worldBank: []` and `itunes: []`, so `renderExternal` emits two
one-line fallbacks instead of ~2,000 characters.

```
fixture   (0 apps, 0 WB rows):  mrd 6940 · prd 7448 · bp 7461 · bp+prior 7603
realistic (5 apps, 2 WB rows):  mrd 7442 · prd 7950 · bp 7964 · bp+prior 8105
                                                ↑ over 7900     ↑ over 7900   ↑ OVER 8000
```

Five iTunes apps is the cap `renderExternal` itself applies; two World Bank rows is exactly what
`gatherExternal` fetches. **This is a normal seed-project run, not a worst case.**

ADR-016 says the test *"builds each template against a realistic worst case"* and quotes
7,221 / 7,728 / 7,880 — stale in both directions.

**Second gap:** the fourth test asserts `<= CEILING` (8000), not `<= CEILING - MIN_HEADROOM`
(7900). **Also drifted:** WORK_PLAN Day 4 records output sizes 2000/2400/3000; the code declares
2000 / 2200 / 2000.

---

## E. Gaps neither document records

| # | Finding | Sev |
|---|---|---|
| **E1** | **`fetched_at` is written and never read.** Migration 002 added an index for staleness queries; `getCached` selects `payload` alone. No TTL, no refresh rule — a cached figure is served indefinitely, and the index supports no query | Med |
| **E2** | **`feeds` is authored on all 23 questions and read by nothing.** `question-bank.json`'s own `rules.revise` describes a mechanism built on it | Med |
| **E3** | **`required` is the gate's only input and is not validated.** A question authored without the key is falsy, becomes optional silently, and can never block a gate. Same for `order` (presence and uniqueness) and `numeric.min <= numeric.max` | Med |
| **E4** | **There is no orphan validator**, contrary to ADR-006. An orphaned `answers` row would be ignored by `canApprove` and would print its raw id in the prompt | Med |
| **E5** | **`revisePhase`'s two statements are not in a transaction.** A crash between them leaves a project marked `complete` with a `revising` phase. `approvePhase` uses one for the equivalent change | Low |
| **E6** | **Nine parsers that never run have 30 tests; the two that do run have none** — `parseOverpassCount` and `parseWikidataCount` | Med |
| **E7** | **`chart.service.ts` — 247 lines, zero tests, two historical bugs**, both found by looking at the rendered image. `niceCeiling` and `compact` are pure but not exported | Med |
| **E8** | **The Wikidata venue count is hard-coded to Israel** — `iso2.toUpperCase() === 'IL' ? notableMallCount('Q801') : …`. For every other country the two-source range collapses to a single Overpass figure | Med |
| **E9** | **Segments are fetched for B2B projects and then discarded** — one wasted uncached call per B2B generation. Only the first two labels are used; a third is dropped with no caveat | Low |
| **E10** | **The derivation's benchmarks are absent from the provenance ledger.** `derivation.benchmarksUsed` exists and is never read, so a B2B ledger lists nine consumer benchmarks it did not use and omits the two its projection rests on | Med |
| **E11** | **`critiqueAnswers` is unreachable regardless of its flag** — no route or service calls it. ADR-011 predicted the rot; the one test only asserts the refusal | Low |
| **E12** | **Dead declarations** — see below | Low |
| **E13** | **Vitest coverage is configured and never collected.** Running it would also scope out `prompts/`, `middleware/` and `scripts/` | Low |
| **E14** | **Two ignored build artefacts are checked in** under `Other/Build Artifacts/` — moving them there placed them outside `.gitignore`'s effect | Low |
| **E15** | **Node is pinned to three different values** — `.nvmrc` 20 · `engines >=20` · CI 22 | Low |
| **E16** | **The Basis explanation hard-codes a benchmark value** — *"the sourced viability floor of 1.5"* is a literal, while the verdict two rows below reads `ltv_cac_min_threshold_ratio` from the corpus | Low |

### E12 — Dead declarations

| Declaration | Where | Note |
|---|---|---|
| `keys.answers` | `useProject.ts:12` | no query uses it |
| `ApiError#isRefusedByGate` | `api.ts:18` | no caller |
| `GenerateOptions.label` | `llm.service.ts:257` | passed by both call sites, never read |
| `budgetSnapshot` | `llm.service.ts:89` | no production caller |
| `citationFor` | `sources.service.ts:64` | no production caller |
| `DERIVATION_QUESTIONS.platforms` | `derivationInputs.service.ts:12` | declared, never referenced |
| `MAX_TERMS` (exported) | `competitorTerms.ts:9` | read only by the test |
| `maxSelections` | `question-bank.json` | not in the `Question` type, never enforced |
| `inDemoSet` | `question-bank.json` → `Question` | shipped to the client; no component reads it |
| `PhaseMeta.primaryDocument` | `question-bank.json` | *purpose not evident from source* |
| `@` path alias | `vite.config.ts` + `tsconfig.json` | configured twice, used in zero imports |
| `'The Claude based answer/**'` | `eslint.config.mjs` ignores | directory does not exist |
| `projects.status = 'archived'` | `001_init.sql` CHECK | no code path ever writes it |
| Three self-referencing aliases | `FALLBACK_ALIASES` | skipped by `if (alias === metricKey) continue` |

---

## F. The shortlist

| # | Finding | Why it matters |
|---|---|---|
| **1** | **D7** — retired ids in `calculation.service` | The prompt tells the model the founder answered a figure the app derived. ADR-012's failure mode, inverted |
| **2** | **D22** — the budget guard on a light fixture | A normal seed run measures 8,105 tokens against an 8,000 ceiling. The regression ADR-016 exists to catch is live |
| **3** | **D17** — two fields named `unvalidated` | The QA assessment closed an item ADR-014 correctly left open, on reasoning that applies to the wrong field |
| **4** | **D18** — the pre-ADR-014 instruction survives | The prompt carries two contradictory rules about the marker, four lines apart |
| **5** | **D16** — 8 of 12 sources cannot reach a document | The twelve-source claim describes the registry, not the pipeline |
| **6** | **D19** — the revenue band as `[object Object]` | The founder's objective is illegible in the section the MRD and PRD are told to ground claims in |
| **7** | **D21** — 4 of 9 cache keys seeded | A cold offline demo cannot produce the seed project's headline verdict |
| **8** | **A1** — the comment strip | Every `WHY` is gone, and it is invisible from inside this checkout |
