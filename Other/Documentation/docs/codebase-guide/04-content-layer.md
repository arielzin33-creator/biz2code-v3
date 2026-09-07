# 04 — The content layer

Phase 5. `data/` at the repository root: **22 JSON files, 7,753 lines**, one Python validator (82
lines), two Markdown documents (242 lines).

```bash
find data -name "*.json" | wc -l            # → 22
find data -name "*.json" -print0 | xargs -0 wc -l | tail -1   # → 7753 total
```

ADR-006 puts these files in the repository rather than the database. This section traces what is
in them and — more importantly — which of their rules are actually enforced by code.

---

## 1. `data/question-bank.json` — 895 lines

### 1.1 Top-level structure

Nine keys. **The loader reads four.**

| Key | Type | Read by code? | Where |
|---|---|---|---|
| `version` | `"2.0"` | declared in the `Bank` interface, never read | — |
| `lastReviewed` | `"2026-08-24"` | **no** | — |
| `rules` | 7 named prose rules | **no** | documentation only |
| `phases` | 4 objects | **yes** | `questionBank.load()`, `PHASE_COUNT`, `getPhases` |
| `questions` | **23** objects | **yes** | the whole gate |
| `demoSet` | `description, questionIds, coverage, remainingAnswers` | **no** | mirrored by hand in `seed-project.json`'s `clearOnDemo` |
| `derivedFields` | `business_plan` 12, `mrd` 6, `prd` 8 | **no** | mirrored by hand in `prompts/documents.ts` |
| `calculationLayer` | `description, inputs, formulas, guardrails, derivations, comparisons` | **no** | mirrored by hand in `calculation.service.ts` |
| `derivationLayer` | `description, chain, segments, guardrails` | **`segments` only** | `getSegmentFilters()` → `derivationInputs.resolveSegments` |

**Five of the nine keys are documentation that no code reads.** `rules`, `demoSet`,
`derivedFields`, `calculationLayer` and all of `derivationLayer` except `segments` are a
specification of the implementation, maintained beside it, with nothing checking that the two
agree. That is why the formula count differs between the file (16 entries under
`calculationLayer.formulas`) and the service (13 functions) — see
[02c-services-numbers.md](02c-services-numbers.md) §1.5.

### 1.2 Per-question field schema

Union of every key across all 23 questions
(`node -e "[...new Set(b.questions.flatMap(q=>Object.keys(q)))]"`):

| Field | Type | Required by the loader? | Read by code? | Notes |
|---|---|---|---|---|
| `questionId` | `string` | **yes** — `fail('a question has no questionId')`, and uniqueness is checked | yes | `p<phase>q<n>` |
| `phaseId` | `string` | **yes** — must exist in `phases` | yes | |
| `order` | `number` | no | yes — sorts `byPhase` | **not validated**: absence or a duplicate is silent |
| `text` | `string` | no | yes | rendered as the label and in the prompt |
| `type` | 5-member union | implicitly, via the two conditional checks | yes | `text \| select \| multiselect \| number \| range` |
| `required` | `boolean` | no | **yes — this is the gate's input** | **not validated**: a missing key is falsy, so the question silently cannot block a gate |
| `inDemoSet` | `boolean` | no | **no** | shipped to the client in `Question`; no component reads it |
| `helpText` | `string \| null` | no | yes — rendered under the label | |
| `feeds` | `string[]` | no | **no** | present on all 23; **nothing reads it** |
| `options` | `string[]` | **yes for `select`/`multiselect`** | yes — `toColumns` validates against it | |
| `placeholder` | `string` | no | yes — text inputs only | |
| `numeric` | `{unit, min, max}` | **yes for `number`/`range`** | yes — `toColumns` and the input `min`/`max` | `min <= max` is **not** checked |
| `maxSelections` | `number` | no | **no** | present on some multiselects; **not in the `Question` interface** and never enforced |

**Two of these are worth stating plainly.**

`required` is the single input to `canApprove`, and the loader does not check that it is present.
A question authored without the key becomes optional silently. Nothing would surface it.

`feeds` is the mechanism `question-bank.json`'s own `rules.revise` describes —
*"Editing an individual answer re-runs generation for the affected fields only"* — and
`grep -rn "\.feeds" server client` finds only the type declarations. The array is inert. WORK_PLAN
Day 6 is accurate that *"the mechanism exists"* in the data; it does not exist in code.

`maxSelections` is a third case: authored, not typed, not enforced. A founder can select every
option on any multiselect.

### 1.3 The 23 questions

| Phase | Name | Questions | Types |
|---|---|---|---|
| p1 — Idea & Strategic Goal | 5 | `p1q1` text · `p1q2` select · `p1q3` select · `p1q4` multiselect · `p1q5` text | |
| p2 — Market & Audience | 5 | `p2q1` text · `p2q2` text · `p2q4` text · `p2q5` text · `p2q6` multiselect | **`p2q3` absent** |
| p3 — Product & Features | 5 | `p3q1`-`p3q4` + `p3q5` | `p3q5` is the **only** `required: false` question |
| p4 — Your Objectives | 8 | `p4q1` select · `p4q2` number · `p4q4` number · `p4q5` multiselect · `p4q7` number · `p4q8` **range** · `p4q9` number · `p4q10` select | **`p4q3`, `p4q6` absent** |

**22 required, 1 optional.** The three gaps in the numbering are ADR-012's retired questions,
and the ADR's rule that *"Their ids are never reused"* is honoured — nothing occupies `p2q3`,
`p4q3` or `p4q6`.

`p4q8` is the only `range`. Its `numeric.max` is `1_000_000_000`, and its `helpText` states the
band's meaning in the founder's own terms.

**Verified counts:**

```bash
node -e "const b=require('./data/question-bank.json');
         console.log(b.questions.length,
                     b.questions.filter(q=>q.required).length,
                     [...new Set(b.questions.map(q=>q.type))].join('|'))"
# → 23 22 text|select|multiselect|number|range
```

Docs claiming 24 (WORK_PLAN, README, INSTALL, `seed-project.json`'s own `demoProtocol`) are
wrong; the Master Plan's 23 is right. See [07-gaps-and-drift.md](07-gaps-and-drift.md) D5.

### 1.4 Boot-time validation — what runs and what does not

[questionBank.service.ts:49-69](../../../../server/services/questionBank.service.ts) is the only
validator. It is 21 lines and runs at import, so a bad bank kills the process before `listen`.

**Enforced (7 checks):** non-empty `phases`; non-empty `questions`; `questionId` present;
`questionId` unique; `phaseId` resolvable; `select`/`multiselect` has non-empty `options`;
`number`/`range` declares `numeric`.

**Not enforced (7 gaps):** `order` present or unique · `required` present · `text` present ·
`type` is a known member (an unknown type passes the loader and fails later in `toColumns` with
a 500) · `numeric.min <= numeric.max` · `feeds` entries name real document fields · `options`
values are unique.

**There is no cross-file validator.** ADR-006 says *"No FK enforcement between
`answers.question_id` and the bank; the validator must cover it"* and *"the validator flags
orphans."* No such validator exists:
[validate_benchmarks.py](../../../../data/benchmarks/validate_benchmarks.py) never opens
`question-bank.json`, and nothing else does either. An orphaned `answers` row would sit in the
database indefinitely; `canApprove` would ignore it, and `renderAnswers` would print its raw id
instead of a question (`getQuestion` throws, and the `catch` at
[context.ts:44](../../../../server/prompts/context.ts) falls back to the id).

---

## 2. `data/seed-project.json` — 2,483 lines

### 2.1 Structure

| Key | Read by code? | By what |
|---|---|---|
| `version`, `lastReviewed` | no | — |
| `project` | **yes** — `name`, `verticalId`, `businessModel`, `isSeed` | `project.service.createFromSeed` |
| `demoProtocol` | **`steps` and `talkingPoints` only**, and only by `rehearse.ts`'s type declaration | — |
| `answers` | **yes** — 23 entries | `createFromSeed`, `rehearse`, `qa-generation-probe` |
| `externalCache` | **yes** — 4 entries | `scripts/seed.ts` |

### 2.2 The answers

23 entries, one per bank question, all ids resolving:

```bash
node -e "const s=require('./data/seed-project.json'), b=require('./data/question-bank.json');
         const bank=new Set(b.questions.map(q=>q.questionId));
         const ids=s.answers.map(a=>a.questionId);
         console.log(ids.length, ids.filter(x=>!bank.has(x)), [...bank].filter(x=>!ids.includes(x)))"
# → 23 [] []
```

Five carry `clearOnDemo: true` — `p1q1, p1q2, p2q6, p3q1, p4q8` — matching the bank's
`demoSet.questionIds` exactly. **18 are pre-filled.**

The example project: *IndoorWay — indoor navigation for retail venues*, `navigation_local`, sold
to shopping centres in Israel at $450/month, $6,500/month opex, $1,500/month acquisition, a
revenue band of $8,000-$270,000, an adoption target of 150, a 12-month horizon.

### 2.3 `demoProtocol` contradicts the file it lives in

| Field | Value | Status |
|---|---|---|
| `purpose` | *"19 of the 24 answers pre-filled; 5 typed live on stage (p1q1, p1q2, p2q6, p3q1, p4q8)"* | The **five ids are right**; "19 of the 24" is wrong (18 of 23) |
| `clearedOnLoad` | `["p1q1","p1q2","p2q3","p3q1","p4q2"]` | **Wrong, and self-contradictory** — includes retired `p2q3`, and disagrees with the `purpose` string two lines above it |
| `steps[2]` | *"Phase 2: type p2q3 (reachable market size). Approve."* | References a question that no longer exists |
| `steps[4]` | *"Say the 24-month customer lifetime (p4q6) out loud"* | References a retired question |
| `steps[5]` | *"About 70 seconds in total"* | Measured at 126-192 s |

**`clearedOnLoad` is dead.** `createFromSeed` filters on the per-answer `clearOnDemo` boolean
([project.service.ts:102](../../../../server/services/project.service.ts)), never on this array.
No code reads `clearedOnLoad`. So the wrong list is inert — but it is the list a reader following
the demo protocol would use.

`rehearse.ts` declares `demoProtocol: { steps, talkingPoints }` in its type
([rehearse.ts:28](../../../../server/scripts/rehearse.ts)) and then never reads either.

### 2.4 `externalCache` — 4 entries, and the cold-offline gap

```
worldbank | ISR/SP.POP.TOTL
worldbank | ISR/IT.NET.USER.ZS
itunes    | Google Maps/IL
itunes    | Waze/IL
```

Each entry is `{source, cacheKey, payload, note}`, and `scripts/seed.ts` loads only those whose
`payload._status === 'FETCHED'` ([seed.ts:49](../../../../server/scripts/seed.ts)).

**The iTunes payload is unwrapped on the way in** ([seed.ts:56-58](../../../../server/scripts/seed.ts)):

```ts
const payload = entry.source === 'itunes' && Array.isArray(entry.payload.results)
  ? entry.payload.results : entry.payload;
```

because `fetch-seed-data.ts` stores the API envelope `{resultCount, results}` while
`itunesSearch` caches the bare array. WORK_PLAN Day 6 item 3 records the shape mismatch; this is
the reconciliation.

**Now the gap.** Tracing every cache key the seed project's pipeline actually requests:

| # | Source | Cache key | Seeded? | Needed by |
|---|---|---|---|---|
| 1 | `worldbank` | `country/israel` | **no** | `resolveCountry` |
| 2 | `worldbank` | `countries` | **no** | `countryList`, if #1 misses |
| 3 | `worldbank` | `ISR/SP.POP.TOTL` | ✓ | `gatherExternal` |
| 4 | `worldbank` | `ISR/IT.NET.USER.ZS` | ✓ | `gatherExternal` |
| 5 | `itunes` | `Google Maps/IL` | ✓ | `gatherExternal` |
| 6 | `itunes` | `Waze/IL` | ✓ | `gatherExternal` |
| 7 | `worldbank` | `ISR/SP.URB.TOTL.IN.ZS` | **no** | `resolveSegments` (p2q6 = "People living in cities") |
| 8 | `overpass` | `IL/shop=department_store,shop=mall` | **no** | `countVenues` → **TAM** |
| 9 | `wikidata` | `count/Q11315/Q801` | **no** | `countVenues` → the venue range |

**Four of nine are seeded.** On a genuinely cold machine with the network blocked:

- #1 and #2 miss → `resolveCountry` returns `null` → `wbCountry = 'WLD'` → the pipeline asks for
  `WLD/SP.POP.TOTL`, which is **also not cached**, so even the seeded rows are not reached. The
  keys are `ISR/…`, and the request becomes `WLD/…`.
- #8 misses → `tamVenues` returns unvalidated → **the whole B2B chain stops at TAM**, and the seed
  project's headline verdict (`$195,300` ceiling) cannot be produced.

ARCHITECTURE §8 states *"with network access to both hosts blocked mid-generation, all five
external lookups were served from cache."* That is consistent with a **warm** database — one
where a prior online run cached `country/israel`, `countries` and the venue counts. It is not
what `npm run db:seed` alone produces, and it counts five lookups because it counts only the
World Bank and iTunes hosts, not Overpass or Wikidata.

Tracked as **D21** in [07-gaps-and-drift.md](07-gaps-and-drift.md).

`rehearse.ts`'s preflight compares the database against `seed.externalCache` only
([rehearse.ts:54](../../../../server/scripts/rehearse.ts)), so it reports `4/4` pre-cached and
raises no flag.

---

## 3. `data/benchmarks/` — 20 JSON files + 1 validator + 2 docs

### 3.1 File inventory

| File | Lines | Purpose | Read by code? |
|---|---|---|---|
| `taxonomy.json` | 189 | 16 verticals + sectors, business models, platforms | **Only by the Python validator.** No TypeScript reads it |
| `benchmarks.index.json` | 187 | Catalogue with per-vertical counts + tier definitions | **No** — explicitly excluded by the loader's filter |
| `_schema.json` | 88 | JSON Schema draft-07 | **No reader anywhere** |
| `benchmarks.<vertical>.json` × 16 | 187-244 each | The corpus | **yes** — `benchmark.service.load()` |
| `benchmarks._cross_vertical_default.json` | 464 | 28 aggregate metrics | **yes** — the fallback |
| `SOURCES.md` | 76 | The contract, in prose | no |
| `DATA_SOURCES.md` | 166 | The 12-source catalogue | no |
| `validate_benchmarks.py` | 82 | CI enforcement | `npm run validate:data` |

**`benchmarks.index.json` is excluded by name** at
[benchmark.service.ts:86](../../../../server/services/benchmark.service.ts):

```ts
.filter((f) => f.startsWith('benchmarks.') && f.endsWith('.json') && f !== 'benchmarks.index.json')
```

— a hard-coded exception, because the index shares the naming prefix but is not a corpus file. It
carries its own copies of every vertical's counts, maintained by hand, read by nothing.

### 3.2 The metric schema — every field

| Field | Type | Required | Enforced by | Read by |
|---|---|---|---|---|
| `value` | `number \| null` | **yes** | both validators | `fromBenchmark`, `isSourced` |
| `rangeLow` / `rangeHigh` | `number \| null` | no | neither | `renderBenchmarks` only, as `(range L–H)` |
| `unit` | `string` | **yes** | both | `Computed.unit`, `figures.format` |
| `confidence` | `primary \| secondary \| tertiary \| placeholder` | **yes** | both | `weakest()` propagation |
| `source.publisher` | `string \| null` | **yes when not placeholder** | both | `allowedCitations`, `renderBenchmarks` |
| `source.via` / `.url` / `.tier` / `.retrieved` | `string \| null` | no | neither | `url` reaches the allow-list; the rest are documentation |
| `note` | `string \| null` | no | neither | **`PROXY` prefix is load-bearing** — `proxyFlag` |
| `conflicts` | `Conflict[] \| null` | no | neither | `caveats` renders the disagreement |

Example of a fully populated metric —
[benchmarks.navigation_local.json](../../../../data/benchmarks/benchmarks.navigation_local.json):

```json
"retention_d30_pct": {
  "value": 4.5, "rangeLow": 3, "rangeHigh": 6, "unit": "percent",
  "confidence": "secondary",
  "source": { "publisher": "UXCam (compiled from AppsFlyer State of App Marketing 2025 …)",
              "via": "uxcam.com", "url": "https://…", "tier": "secondary",
              "retrieved": "2026-08-10" },
  "note": "PROXY: no navigation-specific published benchmark found. Nearest analogue is the
           Travel & Local / utilities band. Treat as a proxy, not a measurement.",
  "conflicts": null
}
```

**`note` starting with `PROXY` is a convention, not a schema rule.** `proxyFlag`
([benchmark.service.ts:117](../../../../server/services/benchmark.service.ts)) does
`(m.note ?? '').trimStart().toUpperCase().startsWith('PROXY')`. Neither validator checks it, and
the file's `coverage.metricsProxy` counter is maintained by hand. A proxy noted as
*"Borrowed from…"* without the prefix would render as a measurement.

### 3.3 The honesty contract — where each rule is enforced

`SOURCES.md` states six rules. Traced to their enforcement:

| # | Rule | `validate_benchmarks.py` (CI) | `benchmark.service.validateMetric` (boot) | `_schema.json` |
|---|---|---|---|---|
| 1 | `value`, `unit`, `confidence`, `source` all present | ✓ | ✓ | ✓ (`required`) |
| 2 | `confidence` in the enum | ✓ 4 values | ✓ 4 values | ✗ **3 values — omits `tertiary`** |
| 3 | placeholder ⇒ `value === null` | ✓ | ✓ | ✓ (`if/then`) |
| 4 | non-placeholder ⇒ value present **and** `source.publisher` set | ✓ | ✓ | ✗ |
| 5 | percent within 0-100 | ✓ | ✓ | ✗ |
| 6 | every taxonomy vertical has a file | ✓ | ✗ (checks only that the fallback exists) | ✗ |

**Rule 3 is the load-bearing one** — the build guide **[sibling]** calls it *"the single rule that
prevents the reference set decaying into invention."* It is enforced twice, in two languages, at
two moments. Verified as genuinely duplicated code, not shared.

### 3.4 Three defects in the contract's own artefacts

**(a) `_schema.json` forbids a tier the corpus uses.** Its enum is
`["primary", "secondary", "placeholder"]`; **31 metrics carry `tertiary`**:

```bash
grep -ho '"confidence": *"[a-z]*"' data/benchmarks/benchmarks.*.json | sort | uniq -c
#  153 "confidence": "placeholder"
#    3 "confidence": "primary"
#   35 "confidence": "secondary"
#   31 "confidence": "tertiary"
```

`SOURCES.md` §"The contract" repeats the three-tier list, and its "Confidence tiers" section
describes only three. `benchmarks.index.json` and both real validators use four. Nothing runs
`_schema.json` — the corpus files reference it with `"$schema"` but no tool resolves it — so this
is latent, not breaking.

**(b) The cross-vertical file is never checked by CI.** `validate_benchmarks.py` iterates
`taxonomy["verticals"]`, and `_cross_vertical_default` is **not** in it:

```bash
node -e "console.log(Object.keys(require('./data/benchmarks/taxonomy.json').verticals)
                     .includes('_cross_vertical_default'))"
# → false
```

So the 28-metric file that supplies the fallback for **every** unsourced metric — including the
LTV:CAC viability floor, the app-store commission, the Android vitals thresholds and both B2B
benchmarks — is validated only at boot, never in CI. It also has **no `coverage` block**, unlike
all 16 vertical files, so its 2 PROXY metrics and 1 conflict raise no warning.

**(c) `SOURCES.md`'s coverage figures are stale.** It says *"21 of 23 cross-vertical metrics
sourced"*; the file holds **26 of 28**. The vertical figure (*"43 of 194"*) is correct.

### 3.5 Verified corpus census

| Figure | Value | Command |
|---|---|---|
| Vertical files | 16 | directory scan |
| Cross-vertical files | 1 | |
| Vertical metrics | **194** | sum over 16 files |
| Vertical metrics sourced | **43** (22.2 %) | `value !== null` |
| Cross-vertical metrics | **28** | |
| Cross-vertical sourced | **26** (92.9 %) | |
| Tier census | placeholder 153 · secondary 35 · tertiary 31 · primary 3 | |
| Verticals with PROXY metrics | 4 — `navigation_local` (2), `b2b_saas`, `food_delivery`, `real_estate` | |
| Verticals with conflicts | 2 — `fintech`, `social_media` | |
| Verticals with zero sourced metrics | **0** | |
| `store_conversion_pct` sourced | **0 of 16** | |
| Hand-maintained `coverage` counters accurate | **16 of 16** | recomputed and compared |

**`store_conversion_pct` at 0/16 is the gap Master Plan §10 names as *"the one that blocks a
consumer projection outright."*** Confirmed structurally, not just numerically: the key is absent
from the cross-vertical file, so `resolve()` finds no fallback and no alias, and
`project()` short-circuits on it — every consumer project's SOM, revenue and verdict are
unvalidated. The metric is also the one Master Plan §7 identifies as having been undefined:
page-view-to-install (~25 %) versus install-to-paid (~1-3 %), a 25× difference.

### 3.6 The three primary-tier metrics

Only three metrics in the entire corpus are `primary`, and all three are in the cross-vertical
file: `crash_rate_user_perceived_max_pct` (1.09 %), `anr_rate_user_perceived_max_pct` (0.47 %),
`crash_rate_per_device_max_pct` (8 %). These are ADR-014's addition — the published Google Play
vitals thresholds, added so the PRD's technical-health field validates on data rather than on a
prompt instruction. They are resolved into `BENCHMARK_KEYS`, shipped to the prompt, and feed no
formula.

### 3.7 Conflicts — recorded, not resolved

Three metrics carry a `conflicts` array:

| File | Metric | Chosen | Conflicts recorded |
|---|---|---|---|
| `fintech` | `retention_d30_pct` | 2 (Adjust 2026) | 12 (vmobify), 11.6 (Plotline/Sendbird — noted as tracing to a 2023 *subscription* cohort) |
| `social_media` | `retention_d30_pct` | — | published 5-22 % |
| `_cross_vertical_default` | `b2b_logo_churn_monthly_pct` | 4.5 (SMB tier) | 3.5 all-segment median, same publisher; enterprise medians under 0.5 % |

`caveats()` turns the array into one sentence — *"Published sources disagree: 12 (vmobify);
11.6 (Plotline/Sendbird). The figure shown is one reported value, not a consensus."* — which
reaches the prompt through `renderBenchmarks` and the Key Figures **Basis** column through
`figures.basis`.

**The cross-vertical conflict never reaches a warning.** Because that file is outside the
taxonomy, `validate_benchmarks.py` never sees it, and its `b2b_logo_churn_monthly_pct` conflict
produces no CI warning — while the two vertical conflicts do. The conflict *does* still reach the
document, through `caveats()`.

### 3.8 `validate_benchmarks.py` — 82 lines

| Section | Lines | Behaviour |
|---|---|---|
| Docstring | 3-14 | States the six rules verbatim |
| `load` / taxonomy read | 20-27 | |
| Per-vertical loop | 29-31 | Missing file → error |
| Per-metric checks | 33-63 | Rules 1-5 |
| Coverage warnings | 65-79 | Reads the **hand-maintained** `coverage` block |
| Exit | 81-82 | `sys.exit(1 if errors else 0)` |

**Current output**, verified:

```
$ npm run validate:data
checked 16 verticals
  WARN  fintech: 1 metric(s) have CONFLICTING published sources …
  WARN  navigation_local: 2 PROXY metric(s) …
  WARN  food_delivery: 1 PROXY metric(s) …
  WARN  social_media: 1 metric(s) have CONFLICTING published sources …
  WARN  b2b_saas: 1 PROXY metric(s) …
  WARN  real_estate: 1 PROXY metric(s) …

0 errors, 6 warnings
```

**0 errors, 6 warnings** — matching WORK_PLAN Day 0 and the QA assessment exactly.

**The warnings are derived from the `coverage` block, not from the metrics.** Lines 65-78 read
`doc.get("coverage", {})` and compare `metricsSourced`, `metricsProxy` and `metricsWithConflicts`.
So a PROXY metric added without incrementing the counter produces no warning. I recomputed all
four counters from the metrics for every file: **all 16 agree**. They are accurate today, and
they are accurate by discipline rather than by construction.

**Requires `python3`.** [package.json](../../../../package.json) runs
`python3 data/benchmarks/validate_benchmarks.py`. On a Windows machine without a `python3` alias
the script fails; [INSTALL.md](../../../../INSTALL.md) lists it under *"Optional extras"* with
*"needs python3"*.

---

## 4. What is authored twice

The content layer's cost is that several facts are stated in two places with nothing reconciling
them.

| Fact | Place 1 | Place 2 | Agree today? |
|---|---|---|---|
| Which 5 questions are the demo set | bank `demoSet.questionIds` | seed `clearOnDemo` flags | **yes** |
| Which 5 questions are cleared | seed `clearOnDemo` | seed `demoProtocol.clearedOnLoad` | **no** |
| The document field list | bank `derivedFields` (26) | `prompts/documents.ts` (25 + Key Figures) | consistent in count |
| The formula list | bank `calculationLayer.formulas` (16) | `calculation.service.ts` (13) | **no** |
| Per-vertical metric counts | each file's `coverage` | `benchmarks.index.json` | not checked |
| Confidence tiers | `_schema.json` (3) | both validators + `index.json` (4) | **no** |
| The business model | seed `project.businessModel` = `b2b_licensing` | seed answer `p4q1` = `Sold to businesses (B2B licence)` | **no** — see [01-architecture.md](01-architecture.md) §2.8 |

---

*Next: [05-build-and-tooling.md](05-build-and-tooling.md).*
