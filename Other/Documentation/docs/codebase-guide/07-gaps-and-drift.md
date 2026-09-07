# 07 — Gaps, debt and documentation drift

Phase 8. Every limitation the project's own documents claim, re-checked against the code; then
every discrepancy this audit found that neither document records.

**Nothing here is copied.** Each entry names the command or the file:line that establishes it.

---

## Part A — the repository-level finding

### A1. This checkout is comment-stripped

**Verified.** Zero files in `server/` or `client/src` contain the `PURPOSE / WHY / DEPENDS / ADR`
header block the project's documentation describes as universal.

```bash
grep -rl "PURPOSE" --include="*.ts" --include="*.tsx" server client/src | wc -l    # → 0
```

49 of 85 TS/TSX files begin with **no comment at all**; 47 of those begin with exactly two blank
lines and one ([gate.service.ts](../../../../server/services/gate.service.ts)) with seven.

Measured against the sibling checkout at `../../biz2code`, same 85 paths:

| | Files | Lines | Comment lines |
|---|---:|---:|---:|
| `biz2code-v3.0-clean` (this repo) | 85 | 11,798 | **172** |
| `../../biz2code` | 85 | 14,616 | **1,309** |

**~87 % of comment lines removed; 2,818 lines shorter.** SQL and Markdown were untouched
(`001_init.sql` retains its full header), and `.mjs` was missed — which is why
[eslint.config.mjs](../../../../eslint.config.mjs) is the one surviving specimen of the
convention.

**Consequences for anyone reading this repository:**

- The build guide's *"Roughly nine percent of the server is comments"* describes 1,309/14,616.
  Here it is 172/11,798 — **1.5 %**.
- Master Plan §3's *"87 TypeScript files, roughly 15,100 lines"* — the file count matches this
  repo exactly (87 including the two client configs), the line count describes the un-stripped
  source. Measured here: **11,861**.
- Every `WHY` — the field the build guide calls *"the only thing in the file that cannot be
  reconstructed by reading it"* — is gone. That is the single largest loss of information in this
  checkout, and it is invisible from inside it.

**The sibling is not a substitute.** A character-level, string-aware comparison of comment-stripped
code found **76 of 85 files identical** and **9 genuinely different**:
`sources.service.ts` (15,194 vs 17,534 chars), `config/env.ts`, `QuestionField.tsx`,
`useDocuments.ts`, `probe-sources.ts`, `qa-generation-probe.ts`, `extended-qa.spec.ts`,
`journey.spec.ts`, `qa-api-probe.ts`. The sibling is a **different version**, and it additionally
contains four files this repo does not: `server/scripts/checkpoint-day{2,3,4,5}.ts`.

---

## Part B — Master Plan §10's limitations, re-verified

| # | Claim | Status | Evidence |
|---|---|---|---|
| 1 | *"43 of 194 metrics are sourced."* | **Still true** | Recomputed: 194 vertical metrics, 43 with `value !== null` |
| 2 | *"`install_to_paid_pct` is 0/16 — the one gap that blocks a consumer projection outright."* | **Still true, and worse than stated** | The key is `store_conversion_pct`: 0 of 16 sourced, **and absent from the cross-vertical file**, so `resolve()` finds no fallback and no alias. `project()` short-circuits on it ([derivation.service.ts:275-277](../../../../server/services/derivation.service.ts)), so every consumer SOM, revenue figure and verdict is unvalidated |
| 3 | *"The unvalidated marker depends on the model's cooperation… The fix is specified in ADR-014 and not built. Most important outstanding item."* | **Still true — and the QA assessment wrongly closed it** | `GenerationOutcome.unvalidated`'s third condition is `modelFlagged.has(field.key)` from `content.unvalidated_fields` ([generation.service.ts:208](../../../../server/services/generation.service.ts)). See **D17** |
| 4 | *"Benchmark selection ignores the business model. A B2B project in a consumer category still pulls consumer CPI into the prompt, unused."* | **Still true** | [context.ts:238](../../../../server/prompts/context.ts) renders `calculations.benchmarksUsed` — the 9 calculation keys — never `DERIVATION_BENCHMARK_KEYS`. So a B2B run shows consumer CPI and retention and **hides** `b2b_cac_usd` and `b2b_logo_churn_monthly_pct`, the two figures its projection rests on |
| 5 | *"The competitor search is noisy… competitor-derived features cite Google Chrome and Google Earth."* | **Still true** | `gatherExternal` dedupes by `trackName` only ([generation.service.ts:120](../../../../server/services/generation.service.ts)); nothing filters by publisher. `competitorSearchTerms` itself is correct — traced on the seed answer it yields exactly `["Google Maps", "Waze"]` |
| 6 | *"Platform share has no source. StatCounter publishes a CSV, not an API, so SAM is not narrowed by platform — and says so."* | **True, with a sharper cause** | Not "unsourced at runtime" — **hard-coded**: `platformSharePct: null, platformShareSource: null` at [derivationInputs.service.ts:121-122](../../../../server/services/derivationInputs.service.ts). `samPeople`'s platform-share branch (lines 134-141) is therefore reachable only from tests. `DERIVATION_QUESTIONS.platforms: 'p1q4'` is declared and never read, so the founder's platform answer influences no number |
| 7 | *"Local only (ADR-002). One user, no roles."* | **Still true** | No Dockerfile, no deploy config, no `roles` column, no role check |
| 8 | *"The guardrail constrains what the model may cite, not how well it writes."* | Not falsifiable by inspection | — |

### The Master Plan's *"Known debt"* in §8

> *"`checkpoint:day3/4/5`, `rehearse` and `qa-api-probe` still reference the three retired
> question ids and fail. This is the largest outstanding item from the v3.0 cycle."*

Re-checked item by item:

| Item | Status |
|---|---|
| `checkpoint:day3/4/5` | **Gone** — the files and the npm scripts do not exist in this repository (D3) |
| `qa-api-probe` | **Fixed** — `API-044`/`API-045` repointed at `p4q2`; verified at [qa-api-probe.ts:187-190](../../../../server/scripts/qa-api-probe.ts) |
| `rehearse` | **Still broken** — [rehearse.ts:152](../../../../server/scripts/rehearse.ts) saves an answer to `p2q3`, so a full run throws `AppError('Unknown question: p2q3', 404)` and exits non-zero |
| *(not listed)* | **`calculation.service.ts` also still references all three**, and it is application code, not a script (D7) |

The debt is smaller than recorded in one respect and larger in another: two of the three named
items are resolved, and a fourth — in the production calculation layer — was not named.

---

## Part C — WORK_PLAN's deviations, re-verified

### C1. *"Known deviation, carried deliberately: revise regenerates all three documents."*

**Still true.** `generateAll` always iterates the full `GENERATION_ORDER`
([generation.service.ts:281](../../../../server/services/generation.service.ts)); there is no
partial path and no reference to `feeds` anywhere in the codebase.

WORK_PLAN's supporting claim — *"every question carries a `feeds` array, so the mechanism
exists"* — is accurate about the **data** and not about the code. All 23 questions carry `feeds`;
`grep -rn "\.feeds" server client` returns only the two type declarations. The array is inert.

### C2. WORK_PLAN's *"What 'done' looks like"* checklist

| Item | Status |
|---|---|
| *"Unit tests pass — 260/260 at v3.0"* | **✓ verified** — `npm test` → 260 passed |
| *"`npm run lint` (0 errors)"* | **✓ verified** — 0 errors, 29 warnings |
| *"13 branches, 28 commits, every merge `--no-ff`"* | **Unverifiable** — this checkout has no `.git` directory |
| *"74 of 74 source files carry a header comment, zero TODOs"* | **Half true.** Zero TODOs confirmed (`grep -rn "TODO\|FIXME\|HACK\|XXX"` over all source → nothing). Header comments: **36 of 85** files begin with one, and only single-line headers survive. See **A1** |
| *"a CI workflow running typecheck, lint, tests, data contract, build, migrations and two QA probes"* | **✓ verified** — [verify.yml](../../../../.github/workflows/verify.yml), all seven steps present |
| *"`checkpoint:day2` — 63/63… `day5` — 59/59"* | **Unverifiable here** — the scripts do not exist (D3) |

### C3. Day-5 bugs — both fixed

| Bug | Fix | Verified |
|---|---|---|
| *"Approving phase 1 bounced the user back to phase 1."* | `if (project.isFetching) return;` | [PhasePage.tsx:32](../../../../client/src/pages/PhasePage.tsx) |
| *"The stepper wrapped 3-then-1."* | `repeat(auto-fit, minmax(150px, 1fr))` | [PhaseStepper.tsx:28](../../../../client/src/components/PhaseStepper.tsx) |

### C4. Master Plan §7 — the v3.0 corrections

| Correction | Verified |
|---|---|
| *"A range field that could never save."* | **Fixed** — the `isRange` branch in `commit` ([QuestionField.tsx:69-70](../../../../client/src/components/QuestionField.tsx)) compares `min`/`max` numerically before any `String()` fallback |
| *"Two chart bugs."* | **Fixed** — the rotation at [chart.service.ts:112](../../../../server/services/chart.service.ts), and `niceCeiling`'s round-the-step at lines 183-189 |
| *"ARPU was measuring the wrong denominator."* | **Fixed in code, not in the test** — `arpuEffective(net, payingCustomers)`; the test is still named `arpu_effective = net / reachable` |
| *"The prompt is a budgeted resource."* | **Guarded, but the guard does not hold under realistic input** — see **D22** |
| *"A metric with no definition is worse than a missing one."* | `store_conversion_pct` now carries a `description`; still 0/16 sourced |

---

## Part D — the discrepancy register

Twenty-four numbered findings. Severity: **High** = affects output correctness or a stated
guarantee · **Medium** = misleads a reader or a maintainer · **Low** = cosmetic or inert.

---

### D1 — Two named orientation documents are outside the repository — *Low*

The Coding Guide and *How this app was built* live at `../../Other/Guides/*.docx`, not in this
repository. Both are substantial (26,011 and 35,438 characters of extracted text) and both
describe this codebase in detail. `FILE_INDEX.md` and the Master Plan reference conventions that
only those documents define.

---

### D2 — Documentation paths do not match the tree, in both directions — *Medium*

**Docs are at `Other/Documentation/docs/`, not `docs/`.** Master Plan §11 draws a top-level
`docs/`; ADR-006 implies `docs/adr/`; the build guide's §7 table uses `docs/…` throughout.

**And all three QA probes write to the non-existent root path:**

```bash
grep -n "resolve(ROOT, 'docs'" server/scripts/*.ts
# qa-api-probe.ts:11        qa-generation-probe.ts:16        qa-resilience-probe.ts:12
ls -d docs        # → no such directory
```

Each calls `mkdirSync(dirname(OUT), { recursive: true })`, so running a probe silently creates a
second `docs/qa/evidence/` tree at the repository root rather than updating the committed
evidence. The evidence files under `Other/Documentation/docs/qa/evidence/` cannot be refreshed by
running the probes.

---

### D3 — The four HTTP checkpoint scripts do not exist — *High*

`npm run checkpoint:day2` … `day5` and `server/scripts/checkpoint-day{2,3,4,5}.ts` are referenced
by [WORK_PLAN.md](../WORK_PLAN.md) (four times, with pass counts), Master Plan §8 (four times),
[FILE_INDEX.md](../../FILE_INDEX.md) (four entries), ARCHITECTURE §8 (*"Four HTTP checkpoints
(243 assertions)"*) and the build guide §8.

```bash
ls server/scripts/checkpoint-day*.ts   # → no matches
grep -n "checkpoint" package.json server/package.json   # → no matches
```

They exist in `../../biz2code`. **An entire documented verification layer is absent from this
checkout**, and with it the check WORK_PLAN Day 5 credits with catching type-mirror drift:
*"it also asserts every key `client/src/lib/types.ts` declares is present in the response, which
catches drift a typecheck cannot."* Nothing performs that check today.

---

### D4 — `ARCHITECTURE.md` §6's backend tree is wrong in three places — *Medium*

| Shown | Reality |
|---|---|
| `config/constants.ts` | does not exist |
| `data/` nested under `server/` | `data/` is at the repository root |
| `db/migrations/001_init.sql` as the only migration | there are three |

---

### D5 — The question count is stated as 24 in four places; it is 23 — *Medium*

```bash
node -e "console.log(require('./data/question-bank.json').questions.length)"   # → 23
```

| Source | Says |
|---|---|
| [WORK_PLAN.md](../WORK_PLAN.md) revision cycle | *"the 24-question bank loads and gates"* |
| [README.md](../../../../README.md) | *"19 of its 24 answers filled in"* |
| [INSTALL.md](../../../../INSTALL.md) §6 | *"19 of its 24 answers filled in"* |
| [seed-project.json](../../../../data/seed-project.json) `demoProtocol.purpose` | *"19 of the 24 answers pre-filled"* |
| [ProjectsPage.tsx:118](../../../../client/src/pages/ProjectsPage.tsx) | *"16 of its 21 answers"* |
| Master Plan §3 | **23 ✓** |
| [QA-Assessment-2026-08-24](../qa/QA-Assessment-2026-08-24.md) | **23 ✓** |

The pre-filled figure is **18** (23 answers, 5 with `clearOnDemo: true`). Five different
statements, two of which are right about the total and none about the pre-filled count.

---

### D6 — `_schema.json` forbids the `tertiary` tier that 31 metrics use — *Medium*

```bash
grep -ho '"confidence": *"[a-z]*"' data/benchmarks/benchmarks.*.json | sort | uniq -c
#  153 placeholder · 35 secondary · 31 tertiary · 3 primary
```

[`_schema.json`](../../../../data/benchmarks/_schema.json) declares
`"enum": ["primary","secondary","placeholder"]`, and
[SOURCES.md](../../../../data/benchmarks/SOURCES.md) repeats the three-tier list twice. Both real
validators accept four tiers. **Nothing runs the JSON Schema** — the corpus files carry a
`"$schema"` key but no tool resolves it — so this is latent.

`ARCHITECTURE.md` separately claims **five** tiers including `assumption`; `assumption` is a
calculation-layer tier and appears in zero benchmark files.

---

### D7 — Retired question ids are still wired into the calculation layer — *High*

[calculation.service.ts:325-332](../../../../server/services/calculation.service.ts):

```ts
export const ECONOMIC_QUESTIONS = {
  reachableMarket:        'p2q3',   // retired by ADR-012
  conversionPct:          'p4q3',   // retired
  expectedLifetimeMonths: 'p4q6',   // retired
  …
};
```

`inputsFromAnswers` therefore always returns `null` for all three, which makes three code paths
unreachable in production:

| Path | Line | Effect |
|---|---|---|
| `payingUsers(reachableMarket, conversionPct)` | 372 | never called — `derivedPayers` is always supplied |
| `cacEstimate(fromBenchmark(cpi), conversionPct)` | 380 | never called — `derivedCac` is always supplied |
| `assumption(input.expectedLifetimeMonths, …)` | 383-384 | unreachable — the value is always `null` |

**Three visible consequences:**

1. **The prompt narrates a derived figure as an answer.**
   [context.ts:91](../../../../server/prompts/context.ts):
   `fig('Expected customer lifetime (the founder answered this)', calc.expectedLifetimeMonths)`.
   The founder no longer answers it.
2. **`lifetimeDivergence`'s prose says *"You expect a paying customer to stay N months"*** for a
   figure the app derived ([calculation.service.ts:252](../../../../server/services/calculation.service.ts)).
3. **The lifetime comparison now compares two derived figures.** `calc.expectedLifetimeMonths` is
   the *derivation's* implied lifetime; `calc.benchmarkImpliedLifetimeMonths` is the *calculation
   layer's*. For a B2B project they use different benchmarks and diverge sharply — presenting a
   large gap between two figures, neither of which the founder supplied.

This is the exact failure mode ADR-012 exists to prevent: *"the documents then narrated his own
assumptions back at him"* — inverted, into narrating a derivation as his assumption.

---

### D8 — ADR-012's *"arbitrary 0.6 ratio"* is still in the verdict — *Medium*

ADR-012 consequences: *"The band also replaced an arbitrary 0.6 ratio in the verdict."*

[derivation.service.ts:310-314](../../../../server/services/derivation.service.ts):

```ts
function band(ratio: number): VerdictCode {
  if (ratio >= 1)   return 'supported';
  if (ratio >= 0.6) return 'ambitious';
  return 'unsupported';
}
```

`judge` bypasses `band()` only when a floor is supplied (line 329). The **adoption** verdict is
called with none — `judge('user', 'people', input.objectiveUsers, somPayers, horizon)` at line 561
— so 0.6 still grades half the verdict. The band replaced it for revenue only.

---

### D9 — Generation time is stated as four different values — *Low*

| Source | Value |
|---|---|
| [seed-project.json](../../../../data/seed-project.json) `demoProtocol.steps[5]` | *"About 70 seconds"* |
| [WORK_PLAN.md](../WORK_PLAN.md) Day 4 | 68.6 s cold |
| [ARCHITECTURE.md](../ARCHITECTURE.md) §5 | 120-200 s |
| [useDocuments.ts:24](../../../../client/src/hooks/useDocuments.ts) | `GENERATION_SECONDS = 180` |
| [rehearse.ts:124](../../../../server/scripts/rehearse.ts) | *"~70 s cold"* |
| QA measurement | **126-192 s** |

The UI value was corrected; three other statements were not.

---

### D10 — The formula count is 11, 12, 13 or 16 depending on where you look — *Medium*

| Source | Count |
|---|---|
| ADR-008 | eleven |
| [calculation.service.ts:1](../../../../server/services/calculation.service.ts) header | 11 |
| [calculation.service.test.ts:160](../../../../server/services/calculation.service.test.ts) | `describe('the eleven formulas')` — containing 9 tests |
| WORK_PLAN Day 3 | 11 formulas |
| Master Plan §3 | 12 formulas + 3 comparisons |
| Coding Guide §1.4 **[sibling]** | *"Twelve formulas obey three rules"* |
| `question-bank.json` `calculationLayer.formulas` | **16** entries |
| **The source** | **13** figure-producing exports + 3 comparisons |

---

### D11 — ADR-004 says five tables; there are six (seven at runtime) — *Low*

`001_init.sql` creates `users`, `projects`, `phases`, `answers`, `deliverables`,
`external_cache`. [migrate.ts:14-18](../../../../server/scripts/migrate.ts) creates
`schema_migrations`. Master Plan §5 and the build guide §3.3 both correctly say six.

---

### D12 — `FILE_INDEX.md` omits ~20 files and lists 4 that do not exist — *Medium*

**Missing:** `derivation.service.ts`, `derivationInputs.service.ts`, `sources.service.ts`,
`chart.service.ts`, `prompts/figures.ts`, `prompts/budget.test.ts`, `middleware/origin.ts`,
`middleware/async.ts`, all three `components/ui/`, `styles/tokens.css`,
`tests/extended-qa.spec.ts`, and every script except `rehearse` (so `migrate`, `seed`,
`fetch-seed-data`, `probe-sources` and all three QA probes).

**Listed but absent:** `scripts/checkpoint-day{2,3,4,5}.ts`.

**And its premise is void here:** *"The full rationale sits in the header of the file itself"* —
see **A1**.

---

### D13 — `INSTALL.md` says 255 unit tests; there are 260 — *Low*

`eslint.config.mjs`'s header says 165. `evidence/harness.txt` records 154 in 6 files, from
2026-08-22.

---

### D14 — Master Plan's line count describes the un-stripped source — *Low*

*"87 TypeScript files, roughly 15,100 lines."* File count matches this repo exactly (87). Line
count here: **11,861**. See **A1**.

---

### D15 — Master Plan §11 names two companion documents that are not present — *Low*

*"Companion documents in `Other/`: Design System v3.0, Flowchart Spec v3.0, Business Suite
Template v3.0, Coach Instructions, How We Work."* The first three exist; **Coach Instructions**
and **How We Work** do not.

---

### D16 — Eight of the twelve approved sources cannot reach a document — *High*

`gatherSupplementary()` — the function that would fetch REST Countries, FX, data.gov.il, Wikidata
entities, Crossref and Google Books — **has no caller**:

```bash
grep -rn "gatherSupplementary" server client --include="*.ts" --include="*.tsx"
# → server/services/sources.service.ts:466   (the definition, only)
```

Tracing every source id to its call sites:

| Reaches a document | Reachable only from `probe-sources.ts` |
|---|---|
| `worldbank`, `itunes`, `overpass`, `wikidata` (Israel only) | `restcountries`, `eurostat`, `oecd`, `unsd`, `datagovil`, `crossref`, `googlebooks`, `openexchangerates` |

This is consistent with `allowedCitations`
([context.ts:208-225](../../../../server/prompts/context.ts)), which can only ever emit those same
four external sources. The allow-list is not artificially narrow — it is exactly as wide as the
pipeline.

**ARCHITECTURE §2's system-context diagram**, which shows Eurostat, OECD, UNSD, Crossref,
data.gov.il and Google Books feeding the Express process, does not describe the current call
graph. Nor does ADR-009's amendment, which reads as though widening the set widened what may be
cited.

**Related:** the QA follow-up's mitigation did not achieve what it describes. It kept the
`restcountries` fetcher *"because `countryFacts` gates the `datagovil` lookup"* — but setting
`REST_COUNTRIES_KEY = null` makes `countryFacts` return `null` unconditionally
([sources.service.ts:142-143](../../../../server/services/sources.service.ts)), so `isIsrael` is
always false and `israeliDatasets` can never be called from `gatherSupplementary`. The gate was
severed as thoroughly as deletion would have severed it. `probe:sources` still reports `datagovil`
reachable because it calls the fetcher directly.

---

### D17 — `unvalidated` means two different things, and the QA assessment conflated them — *High*

Two unrelated fields share the name:

| Field | Where | Deterministic? |
|---|---|---|
| `Resolved.unvalidated` | [benchmark.service.ts:124](../../../../server/services/benchmark.service.ts) — `metric.value === null \|\| metric.confidence === 'placeholder'` | **Yes** |
| `GenerationOutcome.unvalidated` | [generation.service.ts:203-213](../../../../server/services/generation.service.ts) | **No** |

The second is built from three conditions, the third of which is the model's own JSON key:

```ts
} else if (modelFlagged.has(field.key)) {
  reason = 'The model reported that it could not fully source this field from the approved data.';
}
```

where `modelFlagged` comes from `content.unvalidated_fields` (lines 183-187).

`Resolved.unvalidated` **never flows into** `GenerationOutcome.unvalidated`.

[QA-Assessment-2026-08-24](../qa/QA-Assessment-2026-08-24.md) calls `GRD-MARKER-SURVIVES` a
*"test-design false positive"* on the grounds that *"`unvalidated` is computed deterministically
in `benchmark.service.ts:124` … so the model cannot influence it."* That reasoning applies to the
wrong field. The same incorrect comment is embedded in the probe at
[qa-generation-probe.ts:98-104](../../../../server/scripts/qa-generation-probe.ts).

**ADR-014's own assessment is the accurate one:** *"The new contract asks the model to exercise
judgement, and judgement can be manipulated… That is a real regression, recorded rather than
hidden."* The QA assessment closed an item ADR-014 correctly left open.

---

### D18 — The pre-ADR-014 instruction survives, contradicting the new one four lines above it — *High*

[prompts/documents.ts:46-50](../../../../server/prompts/documents.ts):

```
    If every figure you used came from the supplied context, return an empty array.
    The key names above whose content you
      could not fully source. Include a key here whenever you had to write around
      a missing figure. An empty array claims everything is sourced, so use it
      only when that is true.
```

Lines 47-50 are an orphaned fragment of the old contract. It begins mid-sentence, and its
operative instruction — *"Include a key here whenever you had to write around a missing figure"* —
is precisely what lines 37-40 forbid (*"Do NOT flag a field when you correctly reported that a
figure was unavailable"*).

ADR-014 states *"Every 'mark this field unvalidated' instruction was removed."* The literal
phrase is gone; this instruction, which produces the same behaviour, is not. The model receives
both rules in one block.

**Related, same ADR:** the MRD's `market_audience_sizing` field still instructs the model to write
*"the reachable market **the founder stated**"*
([documents.ts:108](../../../../server/prompts/documents.ts)) — a figure ADR-012 retired.

---

### D19 — The revenue band reaches every prompt as `[object Object]` — *High*

[prompts/context.ts:30](../../../../server/prompts/context.ts):

```ts
const readAnswer = (a: AnswerRow): string => {
  if (a.value_json) return Array.isArray(a.value_json) ? a.value_json.join(', ') : String(a.value_json);
  …
};
```

`p4q8`'s `value_json` is `{min, max}` — not an array — so `String({min:8000, max:270000})`
produces **`[object Object]`**. The ANSWERS section of every prompt shows:

```
  Q: What monthly revenue would make this worth doing?
  A: [object Object]
```

This is the same `String()`-on-an-object trap Master Plan §7 records as the range-save bug. That
one was fixed in `QuestionField`; this one was not.

**Masked, not harmless.** The band's real values reach the model twice by other routes —
`renderDerivation`'s verdict prose and the Key Figures table — so the document is still correct.
But the ANSWERS block is the section the MRD and PRD are instructed to ground their claims in, and
the founder's revenue objective is illegible there.

---

### D20 — Two of `UnvalidatedBadge`'s three kinds can never render — *Medium*

`kindFromReason` ([UnvalidatedBadge.tsx:13-18](../../../../client/src/components/UnvalidatedBadge.tsx))
selects `conflict` on `DISAGREE`/`CONFLICT` and `proxy` on `PROXY`. Its only caller passes
`entry.reason` from `Deliverable.unvalidated`, and those reasons are exactly three strings
([generation.service.ts:205-209](../../../../server/services/generation.service.ts)), none of
which contains any of those words. **`kindFromReason` always returns `'unvalidated'`.**

WORK_PLAN Day 5: *"`UnvalidatedBadge` in three kinds… Flattening them would discard the
distinction the benchmark layer works to preserve."* The component preserves the distinction; the
data reaching it does not carry it. The proxy and conflict caveats **are** computed — they flow
into the prompt and the Key Figures **Basis** column, not into `Deliverable.unvalidated`.

---

### D21 — `npm run db:seed` pre-caches 4 of the 9 keys the pipeline needs — *High*

| # | Cache key | Seeded? | Needed by |
|---|---|---|---|
| 1 | `worldbank / country/israel` | **no** | `resolveCountry` |
| 2 | `worldbank / countries` | **no** | `countryList` |
| 3-4 | `worldbank / ISR/SP.POP.TOTL`, `ISR/IT.NET.USER.ZS` | ✓ | `gatherExternal` |
| 5-6 | `itunes / Google Maps\|Waze /IL` | ✓ | `gatherExternal` |
| 7 | `worldbank / ISR/SP.URB.TOTL.IN.ZS` | **no** | `resolveSegments` |
| 8 | `overpass / IL/shop=department_store,shop=mall` | **no** | **TAM** |
| 9 | `wikidata / count/Q11315/Q801` | **no** | the venue range |

On a cold machine with the network blocked, #1 and #2 miss, so `resolveCountry` returns `null`,
`wbCountry` becomes `'WLD'`, and the pipeline requests `WLD/SP.POP.TOTL` — a key that is also not
cached. **The seeded `ISR/…` rows are never reached.** And #8 missing means `tamVenues` returns
unvalidated, so the seed project's headline result (the `$195,300` ceiling) cannot be produced at
all.

ARCHITECTURE §8's *"all five external lookups were served from cache"* is consistent with a
**warm** database — one where a prior online run cached the country resolution and the venue
counts. It is not what `db:seed` alone produces, and it counts five because it counts only two
hosts.

`rehearse.ts`'s preflight compares against `seed.externalCache` only, so it reports `4/4`
pre-cached and cannot see the gap.

---

### D22 — The prompt budget guard passes on a fixture ~500 tokens lighter than a real run — *High*

[budget.test.ts:76-81](../../../../server/prompts/budget.test.ts) supplies `worldBank: []` and
`itunes: []`, so `renderExternal` emits two one-line "no data retrieved" fallbacks instead of the
~2,000 characters a populated context produces.

Measured with the test's own cost function, `ceil((system.length + user.length) / 4) + maxTokens`:

```
fixture   (0 apps, 0 WB rows):  mrd 6940 · prd 7448 · bp 7461 · bp+prior 7603
realistic (5 apps, 2 WB rows):  mrd 7442 · prd 7950 · bp 7964 · bp+prior 8105
                                                ↑ over 7900     ↑ over 7900   ↑ OVER 8000
```

Five iTunes apps is the cap `renderExternal` itself applies
([context.ts:140](../../../../server/prompts/context.ts)); two World Bank rows is exactly what
`gatherExternal` fetches. **This is a normal seed-project run, not a worst case.**

ADR-016 says the test *"builds each template against a realistic worst case"* and quotes current
costs of 7,221 / 7,728 / 7,880. On the external block it builds a best case, and the quoted figures
are stale in both directions.

**Second, smaller gap:** the fourth test asserts `<= CEILING` (8000), not
`<= CEILING - MIN_HEADROOM` (7900) — so the 100-token alarm margin ADR-016 argues for is not
applied to the one case most likely to breach.

**Also drifted:** WORK_PLAN Day 4 records output sizes *"2000/2400/3000"*; the code declares
2000 / 2200 / 2000.

---

### D23 — The cross-vertical benchmark file is never validated by CI — *Medium*

[validate_benchmarks.py](../../../../data/benchmarks/validate_benchmarks.py) iterates
`taxonomy.json`'s 16 verticals. `_cross_vertical_default` is not among them:

```bash
node -e "console.log(Object.keys(require('./data/benchmarks/taxonomy.json').verticals)
                     .includes('_cross_vertical_default'))"   # → false
```

So the 28-metric file that supplies the fallback for **every** unsourced metric — the LTV:CAC
viability floor, the app-store commission, the three Android vitals thresholds, and both B2B
benchmarks — is checked only at boot by `benchmark.service.load()`, never in CI. It also has **no
`coverage` block**, unlike all 16 vertical files, so its 2 PROXY metrics and 1 conflict raise no
warning.

The two validators also discover files differently — TypeScript scans the directory, Python
iterates the taxonomy — so a corpus file outside the taxonomy is validated only at boot, and a
taxonomy entry with no file fails only in CI.

---

### D24 — `seed-project.json`'s demo protocol contradicts the file it lives in — *Medium*

| Field | Value | Problem |
|---|---|---|
| `clearedOnLoad` | `["p1q1","p1q2","p2q3","p3q1","p4q2"]` | Includes retired `p2q3`; disagrees with the `purpose` string two lines above, and with the `clearOnDemo` flags the code actually reads |
| `steps[2]` | *"Phase 2: type p2q3 (reachable market size)"* | Retired question |
| `steps[4]` | *"Say the 24-month customer lifetime (p4q6) out loud"* | Retired question |
| `purpose` | *"19 of the 24 answers"* | 18 of 23 |

`clearedOnLoad` is **dead** — `createFromSeed` filters on the per-answer `clearOnDemo` boolean and
never reads this array. So the wrong list is inert, but it is the list a reader following the demo
protocol would use.

---

## Part E — gaps this audit found that neither document records

### E1. `fetched_at` is written and never read — *Medium*

```bash
grep -rn "fetched_at" server --include="*.ts"
# → external.service.ts:19, 22   (both writes)
```

Migration 002 added `idx_external_cache_fetched ON external_cache(source, fetched_at)` with the
comment *"`fetched_at` is read to decide whether a cached row is stale enough to refresh.
Unindexed it was a sequential scan over the whole cache on every lookup."* `getCached` selects
`payload` alone. **There is no TTL and no refresh rule**: a cached World Bank figure is served
indefinitely, and the index supports no query in the codebase.

### E2. `feeds` is authored on all 23 questions and read by nothing — *Medium*

`grep -rn "\.feeds" server client` → the two type declarations only. `question-bank.json`'s own
`rules.revise` describes a mechanism built on it. The array is inert.

### E3. `required` is the gate's only input and is not validated — *Medium*

[questionBank.service.ts:58-67](../../../../server/services/questionBank.service.ts) validates
seven things; `required`'s presence is not among them. A question authored without the key is
falsy, becomes optional silently, and can never block a gate. Same for `order` (presence and
uniqueness) and `numeric.min <= numeric.max`.

### E4. There is no orphan validator, contrary to ADR-006 — *Medium*

ADR-006: *"the validator flags orphans"* and *"No FK enforcement between `answers.question_id` and
the bank; the validator must cover it."* No validator opens `question-bank.json` alongside the
database. An orphaned `answers` row would be ignored by `canApprove` and would print its raw id in
the prompt (`getQuestion` throws; the `catch` at [context.ts:44](../../../../server/prompts/context.ts)
falls back to the id).

### E5. `revisePhase`'s two statements are not in a transaction — *Low*

[gate.service.ts:106-116](../../../../server/services/gate.service.ts) issues two `UPDATE`s with
no `BEGIN`. A crash between them leaves a project marked `complete` with a `revising` phase.
`approvePhase` uses a transaction for the equivalent change. `DATA-NO-IMPOSSIBLE-STATE` passes, so
the window has not been observed to open — but the guarantee is by narrowness, not construction.

### E6. Three parsers that never run have 30 tests; the two that do run have none — *Medium*

`parseOverpassCount` and `parseWikidataCount` are the only parsers whose fetchers reach the
pipeline, and the only two without a fixture test.

### E7. `chart.service.ts` — 247 lines, zero tests, two historical bugs — *Medium*

Both recorded chart defects were found by looking at the rendered image. `niceCeiling` and
`compact` are pure and would be trivially testable, but neither is exported.

### E8. The Wikidata venue count is hard-coded to Israel — *Medium*

[derivationInputs.service.ts:72](../../../../server/services/derivationInputs.service.ts):
`iso2.toUpperCase() === 'IL' ? notableMallCount('Q801') : Promise.resolve(null)`. For every other
country ADR-013's two-source range collapses to a single Overpass figure, and `tamVenues`'s
disagreement branch never fires.

### E9. Segments are fetched for B2B projects and then discarded — *Low*

[derivationInputs.service.ts:106-108](../../../../server/services/derivationInputs.service.ts)
runs `resolveSegments` before the B2B check at line 110. For a B2B project `derive` sets
`sam = tam` and never calls `samPeople`, so the World Bank call is made, cached and thrown away —
one wasted uncached call per B2B generation. Only the first two segment labels are used
(`labels.slice(0, 2)`), and a third selection is dropped with no caveat.

### E10. The derivation's benchmarks are absent from the provenance ledger — *Medium*

`Provenance.benchmarksUsed` records `calculations.benchmarksUsed` — the 9 calculation keys.
`derivation.benchmarksUsed` exists on the result object
([derivation.service.ts:584](../../../../server/services/derivation.service.ts)) and is never
read. A B2B run's ledger therefore lists nine consumer benchmarks it did not use and omits the two
its projection rests on. Same root cause as **B4**.

### E11. `critiqueAnswers` is unreachable regardless of its flag — *Low*

ADR-011's scaffold is gated on `LLM_FEEDBACK_ENABLED`, **and** no route or service calls it.
Turning the flag on changes nothing. ADR-011 predicted *"A disabled path risks rotting; it needs
at least one unit test"* — one test exists, and it only asserts the refusal.

### E12. Dead declarations — *Low*

| Declaration | Where | Note |
|---|---|---|
| `keys.answers` | [useProject.ts:12](../../../../client/src/hooks/useProject.ts) | no query uses it |
| `ApiError#isRefusedByGate` | [api.ts:18](../../../../client/src/lib/api.ts) | no caller |
| `GenerateOptions.label` | [llm.service.ts:257](../../../../server/services/llm.service.ts) | passed by both call sites, never read |
| `budgetSnapshot` | [llm.service.ts:89](../../../../server/services/llm.service.ts) | no production caller |
| `citationFor` | [sources.service.ts:64](../../../../server/services/sources.service.ts) | no production caller |
| `DERIVATION_QUESTIONS.platforms` | [derivationInputs.service.ts:12](../../../../server/services/derivationInputs.service.ts) | declared, never referenced |
| `MAX_TERMS` (exported) | [competitorTerms.ts:9](../../../../server/services/competitorTerms.ts) | read only by the test |
| `maxSelections` | `question-bank.json` | not in the `Question` type, never enforced |
| `inDemoSet` | `question-bank.json` → `Question` | shipped to the client; no component reads it |
| `PhaseMeta.primaryDocument` | `question-bank.json` | **purpose not evident from source** — recommend confirming with the author |
| `@` path alias | `vite.config.ts` + `tsconfig.json` | configured twice, used in zero imports |
| `'The Claude based answer/**'` | `eslint.config.mjs` ignores | directory does not exist |
| `projects.status = 'archived'` | `001_init.sql` CHECK | no code path ever writes it |
| Three self-referencing aliases | `FALLBACK_ALIASES` | skipped by `if (alias === metricKey) continue` |

### E13. Vitest coverage is configured and never collected — *Low*

[vitest.config.ts](../../../../server/vitest.config.ts) sets
`coverage: { include: ['services/**'] }`; no script passes `--coverage`. Running it would also
scope out `prompts/`, `middleware/` and `scripts/`.

### E14. Two ignored build artefacts are checked in — *Low*

`Other/Build Artifacts/tsconfig.tsbuildinfo` and
`Other/Build Artifacts/test-results/.last-run.json` both match `.gitignore` patterns; moving them
under `Other/` placed them outside the ignore's effect.

### E15. Node version is pinned to three different values — *Low*

`.nvmrc` → 20 · `engines` → `>=20` · CI → 22. All satisfy the constraint; none agree.

### E16. The UI's Basis explanation hard-codes a benchmark value — *Low*

[figures.ts:105-106](../../../../server/prompts/figures.ts): *"LTV:CAC below the sourced viability
floor of **1.5**"* is a literal, while the verdict two rows below reads
`ltv_cac_min_threshold_ratio` from the corpus. Re-sourcing that metric would make the table
disagree with itself.

---

## Part F — the shortlist

If the register were reduced to what most affects the product's central claim:

| # | Finding | Why it matters |
|---|---|---|
| **1** | **D7** — retired ids wired into `calculation.service` | The prompt tells the model the founder answered a figure the app derived. ADR-012's failure mode, inverted |
| **2** | **D22** — the budget guard passes on a light fixture | A normal seed run measures 8,105 tokens against an 8,000 ceiling. The regression ADR-016 exists to catch is live |
| **3** | **D17** — two fields named `unvalidated` | The QA assessment closed an item ADR-014 correctly left open, on reasoning that applies to the wrong field |
| **4** | **D18** — the pre-ADR-014 instruction survives | The prompt carries two contradictory rules about the marker, four lines apart |
| **5** | **D16** — 8 of 12 sources cannot reach a document | The twelve-source claim is a claim about the registry, not the pipeline |
| **6** | **D19** — the revenue band renders as `[object Object]` | The founder's objective is illegible in the section the MRD and PRD are told to ground claims in |
| **7** | **D21** — 4 of 9 cache keys seeded | A cold offline demo cannot produce the seed project's headline verdict |
| **8** | **A1** — the comment strip | Every `WHY` in the codebase is gone, and it is invisible from inside this checkout |

---

*Back to [00-index.md](00-index.md).*
