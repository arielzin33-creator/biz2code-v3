# 04 — The content layer (minimal)

`data/` at the repository root: **22 JSON files, 7,753 lines**, one Python validator (82 lines),
two Markdown documents (242 lines).

---

# 1. `data/question-bank.json` — 895 lines

## 1.1 Nine top-level keys — the loader reads four

| Key | Read by code? | Where |
|---|---|---|
| `version` `"2.0"` | declared in `Bank`, never read | — |
| `lastReviewed` | **no** | — |
| `rules` (7 prose rules) | **no** | documentation only |
| `phases` (4) | **yes** | `load()`, `PHASE_COUNT`, `getPhases` |
| `questions` (**23**) | **yes** | the whole gate |
| `demoSet` | **no** | mirrored by hand in `seed-project.json`'s `clearOnDemo` |
| `derivedFields` (bp 12, mrd 6, prd 8) | **no** | mirrored by hand in `prompts/documents.ts` |
| `calculationLayer` | **no** | mirrored by hand in `calculation.service.ts` |
| `derivationLayer` | **`segments` only** | `getSegmentFilters()` → `resolveSegments` |

**Five of the nine keys are documentation no code reads** — a specification maintained beside the
implementation with nothing checking they agree. That is why the file lists 16 formulas and the
service exports 13.

## 1.2 Per-question fields

| Field | Required by loader? | Read by code? | Notes |
|---|---|---|---|
| `questionId` | **yes** + uniqueness | yes | `p<phase>q<n>` |
| `phaseId` | **yes** — must exist | yes | |
| `order` | no | yes — sorts `byPhase` | **Not validated:** absence or a duplicate is silent |
| `text` | no | yes | label + prompt |
| `type` | implicitly | yes | `text \| select \| multiselect \| number \| range` |
| `required` | no | **yes — the gate's input** | **Not validated:** a missing key is falsy, so the question silently cannot block a gate |
| `inDemoSet` | no | **no** | shipped to the client; no component reads it |
| `helpText` | no | yes | rendered under the label |
| `feeds` | no | **no** | present on all 23; nothing reads it |
| `options` | **yes** for select/multiselect | yes — `toColumns` validates | |
| `placeholder` | no | yes | text inputs only |
| `numeric` `{unit,min,max}` | **yes** for number/range | yes | `min <= max` **not** checked |
| `maxSelections` | no | **no** | authored, not in the `Question` interface, never enforced |

## 1.3 The 23 questions

| Phase | Name | Questions |
|---|---|---|
| p1 | Idea & Strategic Goal | `p1q1` text · `p1q2` select · `p1q3` select · `p1q4` multiselect · `p1q5` text |
| p2 | Market & Audience | `p2q1` `p2q2` `p2q4` `p2q5` text · `p2q6` multiselect — **`p2q3` absent** |
| p3 | Product & Features | `p3q1`-`p3q4` + `p3q5` — `p3q5` is the **only** `required: false` |
| p4 | Your Objectives | `p4q1` select · `p4q2` number · `p4q4` number · `p4q5` multiselect · `p4q7` number · `p4q8` **range** · `p4q9` number · `p4q10` select — **`p4q3`, `p4q6` absent** |

**22 required, 1 optional.** The three gaps are ADR-012's retired questions, and their ids are
never reused.

`p4q8` is the only `range`; `numeric.max` is `1_000_000_000`.

Docs claiming 24 (WORK_PLAN, README, INSTALL, the seed file's `demoProtocol`) are wrong; the
Master Plan's 23 is right (**D5**).

## 1.4 Boot-time validation

21 lines, running at import — a bad bank kills the process before `listen`.

**Enforced (7):** non-empty `phases` · non-empty `questions` · `questionId` present ·
`questionId` unique · `phaseId` resolvable · select/multiselect has non-empty `options` ·
number/range declares `numeric`.

**Not enforced (7):** `order` present or unique · `required` present · `text` present ·
`type` is a known member (an unknown type passes here and fails in `toColumns` with a 500) ·
`numeric.min <= numeric.max` · `feeds` entries name real document fields · `options` uniqueness.

**There is no cross-file validator.** ADR-006 promises one that flags orphaned `answers` rows;
`validate_benchmarks.py` never opens `question-bank.json`, and nothing else does. An orphaned row
would sit in the database indefinitely — `canApprove` ignores it, and `renderAnswers` prints its
raw id (`getQuestion` throws, and `context.ts:44` falls back to the id).

---

# 2. `data/seed-project.json` — 2,483 lines

## 2.1 Structure

| Key | Read by code? | By what |
|---|---|---|
| `version`, `lastReviewed` | no | — |
| `project` | **yes** — `name`, `verticalId`, `businessModel`, `isSeed` | `createFromSeed` |
| `demoProtocol` | `steps`/`talkingPoints` only, and only by `rehearse.ts`'s type declaration | — |
| `answers` (23) | **yes** | `createFromSeed`, `rehearse`, `qa-generation-probe` |
| `externalCache` (4) | **yes** | `scripts/seed.ts` |

## 2.2 The answers

23 entries, one per bank question, all ids resolving both ways. Five carry `clearOnDemo: true` —
`p1q1, p1q2, p2q6, p3q1, p4q8` — matching the bank's `demoSet.questionIds`. **18 pre-filled.**

The example: *IndoorWay — indoor navigation for retail venues*, `navigation_local`, sold to
shopping centres in Israel at $450/month, $6,500/month opex, $1,500/month acquisition, a revenue
band of $8,000-$270,000, an adoption target of 150, a 12-month horizon.

## 2.3 `demoProtocol` contradicts the file it lives in

| Field | Value | Status |
|---|---|---|
| `purpose` | *"19 of the 24 answers pre-filled; 5 typed live (p1q1, p1q2, p2q6, p3q1, p4q8)"* | The **five ids are right**; "19 of the 24" is wrong (18 of 23) |
| `clearedOnLoad` | `["p1q1","p1q2","p2q3","p3q1","p4q2"]` | **Wrong and self-contradictory** — includes retired `p2q3`, disagrees with `purpose` two lines above |
| `steps[2]` | *"Phase 2: type p2q3 (reachable market size)"* | A question that no longer exists |
| `steps[4]` | *"Say the 24-month customer lifetime (p4q6) out loud"* | A retired question |
| `steps[5]` | *"About 70 seconds in total"* | Measured at 126-192 s |

**`clearedOnLoad` is dead** — `createFromSeed` filters on the per-answer `clearOnDemo` boolean,
never on this array. The wrong list is inert, but it is the list a reader following the demo
protocol would use.

## 2.4 `externalCache` — 4 entries, and the cold-offline gap

```
worldbank | ISR/SP.POP.TOTL
worldbank | ISR/IT.NET.USER.ZS
itunes    | Google Maps/IL
itunes    | Waze/IL
```

`seed.ts` loads only entries whose `payload._status === 'FETCHED'`, and unwraps the iTunes
envelope:

```ts
const payload = entry.source === 'itunes' && Array.isArray(entry.payload.results)
  ? entry.payload.results : entry.payload;
```

because `fetch-seed-data.ts` stores `{resultCount, results}` while `itunesSearch` caches the bare
array.

**Every cache key the seed pipeline actually requests:**

| # | Source | Cache key | Seeded? | Needed by |
|---|---|---|---|---|
| 1 | `worldbank` | `country/israel` | **no** | `resolveCountry` |
| 2 | `worldbank` | `countries` | **no** | `countryList`, if #1 misses |
| 3 | `worldbank` | `ISR/SP.POP.TOTL` | ✓ | `gatherExternal` |
| 4 | `worldbank` | `ISR/IT.NET.USER.ZS` | ✓ | `gatherExternal` |
| 5 | `itunes` | `Google Maps/IL` | ✓ | `gatherExternal` |
| 6 | `itunes` | `Waze/IL` | ✓ | `gatherExternal` |
| 7 | `worldbank` | `ISR/SP.URB.TOTL.IN.ZS` | **no** | `resolveSegments` (p2q6) |
| 8 | `overpass` | `IL/shop=department_store,shop=mall` | **no** | `countVenues` → **TAM** |
| 9 | `wikidata` | `count/Q11315/Q801` | **no** | `countVenues` → the venue range |

**Four of nine are seeded.** On a cold machine with the network blocked:

- #1 and #2 miss → `resolveCountry` returns `null` → `wbCountry = 'WLD'` → the pipeline requests
  `WLD/SP.POP.TOTL`, **also not cached**. The seeded `ISR/…` rows are never reached.
- #8 misses → `tamVenues` returns unvalidated → **the whole B2B chain stops at TAM**, and the seed
  project's headline verdict ($195,300 ceiling) cannot be produced.

ARCHITECTURE §8's offline claim is consistent with a **warm** database — one where a prior online
run cached `country/israel`, `countries` and the venue counts. It counts five lookups because it
counts only World Bank and iTunes, not Overpass or Wikidata. Tracked as **D21**.

`rehearse.ts`'s preflight compares the database against `seed.externalCache` only, so it reports
`4/4` pre-cached and raises no flag.

---

# 3. `data/benchmarks/` — 20 JSON files + 1 validator + 2 docs

## 3.1 Inventory

| File | Lines | Read by code? |
|---|---:|---|
| `taxonomy.json` | 189 | **Only by the Python validator** — no TypeScript reads it |
| `benchmarks.index.json` | 187 | **No** — explicitly excluded by the loader's filter |
| `_schema.json` | 88 | **No reader anywhere** |
| `benchmarks.<vertical>.json` × 16 | 187-244 each | **yes** |
| `benchmarks._cross_vertical_default.json` | 464 | **yes** — the fallback, 28 metrics |
| `SOURCES.md` | 76 | no |
| `DATA_SOURCES.md` | 166 | no |
| `validate_benchmarks.py` | 82 | `npm run validate:data` |

```ts
.filter((f) => f.startsWith('benchmarks.') && f.endsWith('.json') && f !== 'benchmarks.index.json')
```

A hard-coded exception — the index shares the prefix but is not a corpus file. It carries
hand-maintained copies of every vertical's counts, read by nothing.

## 3.2 The metric schema

| Field | Required | Enforced by | Read by |
|---|---|---|---|
| `value` | **yes** | both validators | `fromBenchmark`, `isSourced` |
| `rangeLow` / `rangeHigh` | no | neither | `renderBenchmarks` only, as `(range L–H)` |
| `unit` | **yes** | both | `Computed.unit`, `figures.format` |
| `confidence` | **yes** | both | `weakest()` propagation |
| `source.publisher` | **yes when not placeholder** | both | `allowedCitations`, `renderBenchmarks` |
| `source.via/.url/.tier/.retrieved` | no | neither | `url` reaches the allow-list |
| `note` | no | neither | **`PROXY` prefix is load-bearing** |
| `conflicts` | no | neither | `caveats` renders the disagreement |

```json
"retention_d30_pct": {
  "value": 4.5, "rangeLow": 3, "rangeHigh": 6, "unit": "percent",
  "confidence": "secondary",
  "source": { "publisher": "UXCam (compiled from AppsFlyer …)", "via": "uxcam.com",
              "url": "https://…", "tier": "secondary", "retrieved": "2026-08-10" },
  "note": "PROXY: no navigation-specific published benchmark found. …",
  "conflicts": null
}
```

**`note` starting with `PROXY` is a convention, not a schema rule** —
`(m.note ?? '').trimStart().toUpperCase().startsWith('PROXY')`. Neither validator checks it, and
`coverage.metricsProxy` is hand-maintained. A proxy noted as *"Borrowed from…"* without the prefix
would render as a measurement.

## 3.3 The honesty contract — where each rule is enforced

| # | Rule | Python (CI) | TypeScript (boot) | `_schema.json` |
|---|---|---|---|---|
| 1 | `value`, `unit`, `confidence`, `source` present | ✓ | ✓ | ✓ |
| 2 | `confidence` in the enum | ✓ 4 | ✓ 4 | ✗ **3 — omits `tertiary`** |
| 3 | placeholder ⇒ `value === null` | ✓ | ✓ | ✓ |
| 4 | non-placeholder ⇒ value **and** publisher | ✓ | ✓ | ✗ |
| 5 | percent within 0-100 | ✓ | ✓ | ✗ |
| 6 | every taxonomy vertical has a file | ✓ | ✗ (fallback only) | ✗ |

**Rule 3 is load-bearing** — the single rule preventing the reference set decaying into
invention. Enforced twice, in two languages, at two moments.

## 3.4 Three defects in the contract's own artefacts

**(a) `_schema.json` forbids a tier the corpus uses.** Its enum is
`["primary","secondary","placeholder"]`, but **31 metrics carry `tertiary`**:

```
 153 "confidence": "placeholder"
   3 "confidence": "primary"
  35 "confidence": "secondary"
  31 "confidence": "tertiary"
```

`SOURCES.md` repeats the three-tier list. Both real validators and `benchmarks.index.json` use
four. Nothing runs `_schema.json`, so this is latent.

**(b) The cross-vertical file is never checked by CI.** `validate_benchmarks.py` iterates
`taxonomy["verticals"]`, and `_cross_vertical_default` is not in it. So the 28-metric file
supplying the fallback for **every** unsourced metric — the LTV:CAC floor, the app-store
commission, the Android vitals thresholds and both B2B benchmarks — is validated only at boot.
It also has **no `coverage` block**, so its 2 PROXY metrics and 1 conflict raise no warning.

**(c) `SOURCES.md`'s coverage figures are stale** — it says *"21 of 23 cross-vertical metrics
sourced"*; the file holds **26 of 28**. The vertical figure (43 of 194) is correct.

## 3.5 Corpus census

| Figure | Value |
|---|---|
| Vertical files / cross-vertical | 16 / 1 |
| Vertical metrics | **194**, **43 sourced** (22.2 %) |
| Cross-vertical metrics | **28**, **26 sourced** (92.9 %) |
| Tier census | placeholder 153 · secondary 35 · tertiary 31 · primary 3 |
| Verticals with PROXY metrics | 4 — `navigation_local` (2), `b2b_saas`, `food_delivery`, `real_estate` |
| Verticals with conflicts | 2 — `fintech`, `social_media` |
| Verticals with zero sourced metrics | **0** |
| `store_conversion_pct` sourced | **0 of 16** |
| Hand-maintained `coverage` counters accurate | **16 of 16** |

**`store_conversion_pct` at 0/16 blocks a consumer projection outright.** The key is absent from
the cross-vertical file too, so `resolve()` finds no fallback and no alias, and `project()`
short-circuits on it — every consumer project's SOM, revenue and verdict are unvalidated. The
metric is also the one recorded as having been undefined: page-view-to-install (~25 %) versus
install-to-paid (~1-3 %), a 25x difference.

## 3.6 The three primary-tier metrics

All three are in the cross-vertical file: `crash_rate_user_perceived_max_pct` (1.09 %),
`anr_rate_user_perceived_max_pct` (0.47 %), `crash_rate_per_device_max_pct` (8 %) — the published
Google Play vitals thresholds ADR-014 added. Resolved into `BENCHMARK_KEYS`, shipped to the
prompt, and feeding **no formula**.

## 3.7 Conflicts — recorded, not resolved

| File | Metric | Chosen | Conflicts recorded |
|---|---|---|---|
| `fintech` | `retention_d30_pct` | 2 (Adjust 2026) | 12 (vmobify), 11.6 (Plotline/Sendbird — traced to a 2023 *subscription* cohort) |
| `social_media` | `retention_d30_pct` | — | published 5-22 % |
| `_cross_vertical_default` | `b2b_logo_churn_monthly_pct` | 4.5 (SMB tier) | 3.5 all-segment median, same publisher; enterprise medians under 0.5 % |

`caveats()` turns the array into one sentence reaching the prompt via `renderBenchmarks` and the
Key Figures **Basis** column via `figures.basis`.

**The cross-vertical conflict never reaches a warning** — that file is outside the taxonomy, so
CI never sees it. The conflict does still reach the document through `caveats()`.

## 3.8 `validate_benchmarks.py` — 82 lines

Docstring (the six rules verbatim) · taxonomy read · per-vertical loop (missing file → error) ·
per-metric checks (rules 1-5) · coverage warnings · `sys.exit(1 if errors else 0)`.

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

**The warnings are derived from the `coverage` block, not from the metrics** — so a PROXY metric
added without incrementing the counter produces no warning. All 16 counters currently agree with
their metrics: accurate by discipline, not by construction.

**Requires `python3`** — on Windows without that alias the script fails; INSTALL lists it under
"Optional extras".

---

# 4. What is authored twice

| Fact | Place 1 | Place 2 | Agree? |
|---|---|---|---|
| Which 5 questions are the demo set | bank `demoSet.questionIds` | seed `clearOnDemo` | **yes** |
| Which 5 questions are cleared | seed `clearOnDemo` | seed `demoProtocol.clearedOnLoad` | **no** |
| The document field list | bank `derivedFields` (26) | `prompts/documents.ts` (25 + Key Figures) | consistent |
| The formula list | bank `calculationLayer.formulas` (16) | `calculation.service.ts` (13) | **no** |
| Per-vertical metric counts | each file's `coverage` | `benchmarks.index.json` | not checked |
| Confidence tiers | `_schema.json` (3) | both validators + `index.json` (4) | **no** |
| The business model | seed `project.businessModel` = `b2b_licensing` | seed answer `p4q1` = `Sold to businesses (B2B licence)` | **no** |
