# 02c — Services: the numbers

Phase 3, backend, part 3. Three files, **1,210 lines, 56 exports**:
`calculation.service.ts` (412, 31 exports), `derivation.service.ts` (666, 22 exports),
`derivationInputs.service.ts` (132, 3 exports).

This is the deterministic core. Everything here runs before the trust boundary; nothing here
consults a model.

---

## `server/services/calculation.service.ts` — 412 lines

**Purpose.** Define the `Computed` value type, the three constructors that can produce one, the
single combining chokepoint, the economic formulas, three comparisons, and the orchestrator that
runs them all.

**Its own header (present):** `/* Deterministic economics. 11 formulas. The LLM never does
arithmetic. */` — the count in that comment is wrong; see §1.5.

**Related ADR:** ADR-008 (the whole file), ADR-012 (the retired-question fallout).

### 1.1 Types

| Name | Definition | Notes |
|---|---|---|
| `ComputedConfidence` | `Confidence \| 'assumption'` where `Confidence` is `primary \| secondary \| tertiary \| placeholder` — **five tiers** | `assumption` exists only here. It is never a value in a benchmark file |
| `Computed` | `{ value, unit, confidence, unvalidated, unvalidatedReason, inputs: string[], usedBenchmark: boolean, caveats: string[] }` | Every figure in the system is one of these |
| `Comparison` | `{ verdict: 'above'\|'below'\|'within'\|'unavailable', detail: string, unvalidated: boolean }` | Not a number — a judgement about two numbers |
| `CalculationInputs` | 6 answer-derived fields + 3 optional `derived*` overrides | See §1.5 |
| `CalculationResult` | 14 `Computed` fields + `comparisons` + `benchmarksUsed` | Consumed by `prompts/context` and `prompts/figures` |
| `AnswerLike` | `{ question_id, value_text, value_number: string \| number \| null }` | A structural subset of `AnswerRow` so the function can be called with either |

**`Computed` field by field, and why each exists:**

| Field | Type | Why it is separate |
|---|---|---|
| `value` | `number \| null` | `null` **only** when `unvalidated` is true |
| `unit` | `string` | Drives formatting in `figures.ts` and the axis label |
| `confidence` | `ComputedConfidence` | Inherited by `weakest()`, never asserted by hand |
| `unvalidated` | `boolean` | The flag every consumer branches on |
| `unvalidatedReason` | `string \| null` | Must name the *input*, not say "insufficient data" |
| `inputs` | `string[]` | The provenance ledger reads it verbatim ([generation.service.ts:334](../../../../server/services/generation.service.ts)) |
| `usedBenchmark` | `boolean` | **Not derivable from `confidence`.** A benchmark mixed with an answer yields `assumption`, which alone cannot say whether a published figure contributed. Drives the two different assumption caveats |
| `caveats` | `string[]` | Rendered verbatim into the prompt and the Basis column, so a prompt cannot forget one |

### 1.2 Constructors — the only ways to make a `Computed`

| Name | Signature | Inputs | Output | Side effects | Failure mode | Tested? | Called by |
|---|---|---|---|---|---|---|---|
| `weakest` | `(...tiers: ComputedConfidence[]) => ComputedConfidence` | tiers | the weakest, by `TIERS` index order | none | seeds with `'primary'`, so `weakest()` with no args returns `'primary'` | `it('takes the weakest tier')`, `it('ranks an assumption below a published tertiary figure but above nothing')` | `combine` |
| `computed` **(private)** | `(value, unit, confidence, inputs, usedBenchmark, caveats?) => Computed` | a real number | a sourced figure | none | **returns `unavailable(...)` if `!Number.isFinite(value)`** | via `it('no formula returns a non-finite value for any pathological input')` | `combine` only |
| `unavailable` | `(reason, unit, inputs?) => Computed` | a reason | `value: null`, `unvalidated: true`, `caveats: [reason]` | none | cannot fail | 12+ tests | everywhere |
| `assumption` | `(value: number \| null, unit, label) => Computed` | an answered value | tier `assumption`, `usedBenchmark: false` | none | **`null` or non-finite → `unavailable(\`${label} was not answered.\`)`** | `it('an unanswered question is unavailable, not zero')` | `calculate`, `derive`, `installsPerMonth` |
| `fromBenchmark` | `(m: Resolved) => Computed` | a resolved metric | tier from the metric, `usedBenchmark: true`, `caveats: benchmarkCaveats(m)` | none | unvalidated metric → `unavailable(...)` with the metric's own reason | `it('a placeholder benchmark becomes an unavailable input')` | `calculate`, `derive` |

`computed` is the only private one, and it is reachable **only** through `combine` — so the
`Number.isFinite` guard cannot be bypassed by a formula author.

The `assumption` label convention is `"<questionId> <field_name>"`, e.g. `'p4q2 price_per_month'`.
That string becomes a provenance entry and appears in error messages the founder reads.

### 1.3 The chokepoint

| Name | Signature | Inputs | Output | Side effects | Failure mode | Tested? |
|---|---|---|---|---|---|---|
| `mergeInputs` *(private)* | `(...cs: Computed[]) => string[]` | — | de-duplicated union | none | — | indirectly |
| `mergeCaveats` *(private)* | `(...cs: Computed[]) => string[]` | — | de-duplicated union, **with both assumption caveats filtered out** | none | — | `it('a mixed figure is flagged as partly assumed, not wholly')` |
| `combine` | `(inputs: Computed[], unit: string, fn: (values: number[]) => number) => Computed` | inputs + arithmetic | one `Computed` | none | short-circuits to `unavailable` if **any** input is unvalidated | 50 tests depend on it |
| `divide` *(private)* | `(numerator, denominator, unit, zeroReason) => Computed` | — | `combine`, guarded | none | `denominator.value === 0` → `unavailable(zeroReason)` | 4 division-by-zero tests |

**`combine` in full** — three guarantees in twenty lines:

```ts
const broken = inputs.find((c) => c.unvalidated || c.value === null);
if (broken) return unavailable(broken.unvalidatedReason ?? 'An input was unavailable.',
                               unit, mergeInputs(...inputs));

const confidence    = weakest(...inputs.map((c) => c.confidence));
const usedBenchmark = inputs.some((c) => c.usedBenchmark);
const result = computed(fn(values), unit, confidence,
                        mergeInputs(...inputs), usedBenchmark, mergeCaveats(...inputs));

if (confidence === 'assumption' && !result.unvalidated)
  result.caveats = [usedBenchmark ? ASSUMPTION_CAVEAT_PARTLY : ASSUMPTION_CAVEAT_WHOLLY,
                    ...result.caveats];
```

1. **Poisoning is honest and named.** The reason propagated is the *first* broken input's own
   reason, so a five-deep chain still says which benchmark is missing. Asserted by
   `it('names the input that caused it, not a generic message')` and
   `it('carries the failure through a whole chain')`.
2. **Confidence never launders.** `weakest` is applied unconditionally.
3. **Infinity cannot escape.** `computed` checks `Number.isFinite`.

The assumption-caveat re-prepend (lines 99-103) is why `mergeCaveats` filters both assumption
strings out first: without the filter, a chain of assumption-tier figures would accumulate the
same sentence repeatedly — the ADR-016 caveat-duplication failure in miniature.

**`divide` exists because `combine` alone cannot express a domain-specific zero.** `x / 0` is
`Infinity`, which `computed` would turn into a generic *"did not produce a finite number"*.
`divide` intercepts first and supplies a sentence the founder can act on, e.g.
*"Not applicable for a zero-price model: with no price there is nothing to pay the acquisition
cost back."*

### 1.4 The formulas — all thirteen

Each returns a `Computed`. Every one routes through `combine` or `divide`; none performs raw
arithmetic on `.value`.

| # | Name | Signature | Formula | Special handling | Tested? |
|---|---|---|---|---|---|
| 1 | `payingUsers` | `(reachableMarket, conversionPct) => Computed` | `m × (c / 100)` | — | `it('paying_users = reachable * conversion%')` |
| 2 | `grossMonthlyRevenue` | `(paying, pricePerMonth) => Computed` | `p × price` | — | ✓ |
| 3 | `storeCommission` | `(gross, businessModel: string \| null, commissionPct) => Computed` | `g × (pct / 100)` | **Three-way branch** — see below | 5 tests |
| 4 | `netMonthlyRevenue` | `(gross, commission) => Computed` | `g − c` | — | ✓ |
| 5 | `annualRecurringRevenue` | `(net) => Computed` | `n × 12` | Single-input `combine` | no direct test |
| 6 | `monthlyTco` | `(monthlyOpex, commission) => Computed` | `o + c` | — | ✓ |
| 7 | `monthlyProfit` | `(net, monthlyOpex) => Computed` | `n − o` | May be negative — asserted | ✓ |
| 8 | `arpuEffective` | `(net, payingCustomers) => Computed` | `net / payers` | `divide`, zero → *"There are no paying customers…"* | ✓ (see the naming note below) |
| 9 | `cacEstimate` | `(cpiBenchmark, conversionPct) => Computed` | `cpi / (pct / 100)` | Explicit `conversionPct === 0` guard **before** `combine` | ✓ |
| 10 | `ltvEstimate` | `(pricePerMonth, lifetimeMonths) => Computed` | `price × months` | — | ✓ |
| 11 | `benchmarkImpliedLifetimeMonths` | `(churnMonthlyPct, retentionD30Pct) => Computed` | `100 / churn`, else `100 / (100 − retention)` | **Prefers churn**; refuses 0% churn and 100% retention | 4 tests |
| 12 | `ltvCacRatio` | `(ltv, cac) => Computed` | `ltv / cac` | `divide`, zero → undefined ratio | ✓ |
| 13 | `paybackPeriodMonths` | `(cac, pricePerMonth) => Computed` | `cac / price` | `divide`, zero → *"Not applicable for a zero-price model"* | ✓ |

**`storeCommission`'s three outcomes** (lines 134-159) — this is the only formula that reads a
raw string rather than a `Computed`:

| Business model | Branch | Result |
|---|---|---|
| `null` (unanswered) | line 137 | `unavailable('The business model was not answered.')` |
| In `NOT_STORE_DISTRIBUTED` — Advertising, Commission on transactions, **Sold to businesses (B2B licence)** | 140-146 | **A genuine `0`**, tier `assumption`, with a caveat naming the model. Not unvalidated |
| In `STORE_DISTRIBUTED` — Subscription, Freemium, In-app purchases, One-time purchase | 153-158 | `combine`, plus a caveat that the *standard* rate was assumed rather than the small-business rate |
| Anything else | 148-151 | `unavailable('Whether app-store commission applies cannot be determined for "X"')` |

The fourth branch is the interesting one: the two option sets are hard-coded string literals
copied from p4q1's options. **They are not derived from the bank.** If p4q1's option text were
edited, both sets would silently fall through to *"cannot be determined"* — the failure would be
honest, but it would be a failure. Test:
`it('refuses to guess when the model is undecided')`.

**`benchmarkImpliedLifetimeMonths` prefers a real churn figure** (lines 192-197) and only falls
back to reading D30 retention as a monthly survival rate. That fallback is the one the project
repeatedly identifies as a proxy — it counts installs still opening an app, not customers still
paying.

**A naming defect in the test suite.** `arpuEffective`'s second parameter is `payingCustomers`,
and `calculate` passes `paying` (line 379). The test is named
`it('arpu_effective = net / reachable')` and passes `num(250000, 'people')` as the denominator
([calculation.service.test.ts:180-182](../../../../server/services/calculation.service.test.ts)).
The arithmetic assertion is correct (300000 / 250000 = 1.2) but the name and the fixture still
describe the pre-v3.0 denominator that Master Plan §7 records as wrong. The test passes either
way, so it cannot catch a regression to the old behaviour.

### 1.5 The comparisons — three

| Name | Signature | Returns `unavailable` when | Thresholds | Tested? |
|---|---|---|---|---|
| `arpuDivergence` | `(arpu, benchmarkArpu) => Comparison` | either is unvalidated; benchmark is 0 | `> 2×` → above, `< 0.5×` → below | 3 tests |
| `lifetimeDivergence` | `(answered, implied) => Comparison` | either is unvalidated; implied is 0 | `> 2×` → above, `< 0.5×` → below | 1 test + the seed end-to-end test |
| `ltvCacVerdict` | `(ratio, floor) => Comparison` | either is unvalidated | `ratio >= floor` → above | 2 tests, incl. `it('never asserts the unsourced 3:1 target')` |

`arpuDivergence` divides the benchmark by 12 first (line 231) because
`arpu_12mo_blended_usd` is an annual figure and `arpuEffective` is monthly — and it says so in
the detail string, so the model narrating it cannot present incomparable units.

**`lifetimeDivergence`'s prose is now inaccurate for the default path.** Its detail string
(lines 252-256) opens *"You expect a paying customer to stay N months."* Since ADR-012 retired
`p4q6`, the `answered` argument is no longer an answer — see §1.7.

### 1.6 Orchestration

| Name | Signature | Inputs | Output | Side effects | Failure mode | Tested? |
|---|---|---|---|---|---|---|
| `BENCHMARK_KEYS` | `readonly [9 strings]` | — | the keys `calculate` resolves | — | — | used by `it('surfaces the proxy warning on every figure')` |
| `ECONOMIC_QUESTIONS` | `const` map of 6 field→questionId | — | — | — | — | **three of its six ids no longer exist** |
| `toNumber` *(private)* | `(raw: string \| number \| null \| undefined) => number \| null` | pg NUMERIC | a finite number or `null` | none | `''` → `null`, **not `0`** | via the seed test |
| `inputsFromAnswers` | `(verticalId, answers: AnswerLike[]) => CalculationInputs` | — | inputs | none | never throws | `it('computes the seed project end to end')` |
| `calculate` | `(input: CalculationInputs) => CalculationResult` | — | 14 figures + 3 comparisons + the benchmark map | **reads the benchmark Map** (module scope, no I/O) | never throws | 50 tests |

`BENCHMARK_KEYS` is `as const`, and `calculate` builds its lookup from it (lines 363-365):

```ts
const b = Object.fromEntries(
  BENCHMARK_KEYS.map((k) => [k, resolveBenchmark(input.verticalId, k)]),
) as Record<(typeof BENCHMARK_KEYS)[number], Resolved>;
```

Adding a key gives you the typed property and the provenance entry together — the pattern the
Coding Guide §1.5 **[sibling]** describes.

The nine keys are: `app_store_commission_standard_pct`, `cpi_usd`, `churn_monthly_pct`,
`retention_d30_pct`, `arpu_12mo_blended_usd`, `ltv_cac_min_threshold_ratio`,
`crash_rate_user_perceived_max_pct`, `anr_rate_user_perceived_max_pct`,
`crash_rate_per_device_max_pct`.

The last three are the Android vitals thresholds ADR-014 added so the PRD's technical-health
field validates on data rather than on an instruction. They are resolved and shipped to the
prompt but never enter a formula.

**`toNumber`'s blank-string guard** (line 343) is the trap Coding Guide §2.3 **[sibling]** names:
`Number('')` is `0`, so without `if (raw.trim() === '') return null` a blank answer would become
a real zero and *"revenue of nothing looks like revenue that was calculated."*

### 1.7 What ADR-012 left behind — three unreachable paths

This is the most consequential finding in the numbers layer.

`ECONOMIC_QUESTIONS` ([calculation.service.ts:325-332](../../../../server/services/calculation.service.ts))
still maps three fields to question ids that were retired by ADR-012 and no longer exist in the
bank:

```ts
export const ECONOMIC_QUESTIONS = {
  reachableMarket:        'p2q3',   // retired
  businessModel:          'p4q1',
  pricePerMonth:          'p4q2',
  conversionPct:          'p4q3',   // retired
  monthlyOpex:            'p4q4',
  expectedLifetimeMonths: 'p4q6',   // retired
} as const;
```

**Verified:**

```bash
node -e "const b=require('./data/question-bank.json');
         const ids=new Set(b.questions.map(q=>q.questionId));
         console.log(['p2q3','p4q3','p4q6'].map(i=>i+':'+ids.has(i)).join(' '))"
# → p2q3:false p4q3:false p4q6:false
```

So `inputsFromAnswers` always returns `reachableMarket: null`, `conversionPct: null`,
`expectedLifetimeMonths: null`. Tracing that through `calculate`:

| Line | Expression | Effect in production |
|---|---|---|
| 367 | `reachableMarket = assumption(null, …)` | always `unavailable('p2q3 reachable_market was not answered.')` |
| 369 | `conversionPct = assumption(null, …)` | always unavailable |
| 372 | `paying = input.derivedPayers ?? payingUsers(reachableMarket, conversionPct)` | `generation.service` **always** supplies `derivedPayers`, so **`payingUsers` is never called in production** |
| 380 | `cac = input.derivedCac ?? cacEstimate(fromBenchmark(b.cpi_usd), conversionPct)` | `derivedCac` is always supplied → **`cacEstimate`'s production path is dead** |
| 383-385 | `lifetime = input.expectedLifetimeMonths !== null ? assumption(...) : (input.derivedLifetimeMonths ?? impliedLifetime)` | the first branch is **unreachable** — `expectedLifetimeMonths` is always `null` |

**Consequences, in order of severity.**

1. **Two formulas and one branch are live only in tests.** `payingUsers`, the
   `cacEstimate(cpi, conversionPct)` call, and `assumption('p4q6 expected_lifetime_months')` are
   exercised by 5 unit tests and by nothing else. They are correct code with no production
   caller.

2. **The "two views" comparison for lifetime now compares two derived figures.**
   `generation.service` passes `derivedLifetimeMonths: derivation.impliedLifetimeMonths`
   ([generation.service.ts:263](../../../../server/services/generation.service.ts)), so:

   - `calc.expectedLifetimeMonths` = the **derivation's** implied lifetime (from `monthlySurvival`)
   - `calc.benchmarkImpliedLifetimeMonths` = the **calculation layer's** implied lifetime (from
     `churn_monthly_pct` / `retention_d30_pct`)
   - `comparisons.lifetime = lifetimeDivergence(lifetime, impliedLifetime)` compares the two.

   For a consumer project both derive from the same benchmarks, so the ratio is ≈1 and the
   comparison reports `within`. For a **B2B** project they diverge sharply: the derivation uses
   `b2b_logo_churn_monthly_pct`, the calculation layer uses app retention. The comparison then
   reports a large divergence between two figures, **neither of which the founder supplied**.

3. **The prompt narrates a derived figure as an answer.**
   [prompts/context.ts:91](../../../../server/prompts/context.ts):

   ```ts
   fig('Expected customer lifetime (the founder answered this)', calc.expectedLifetimeMonths),
   ```

   and `lifetimeDivergence`'s detail string opens *"You expect a paying customer to stay N
   months."* Both statements are now false. The model is being told the founder asserted a
   figure the app derived — the precise failure mode ADR-012 was written to eliminate.

4. **`rehearse.ts` prints it as answered too** —
   [rehearse.ts:100](../../../../server/scripts/rehearse.ts):
   `line('assumed customer lifetime', \`${calc.expectedLifetimeMonths.value} months (answered)\`)`.

This is tracked as **D7** in [07-gaps-and-drift.md](07-gaps-and-drift.md).

### 1.8 `calculate`'s data flow

```
              BENCHMARK_KEYS ──► benchmark.resolve × 9 ──► b
                                                           │
p4q2 price ──► assumption ──┐                              │
p4q4 opex  ──► assumption ──┤                              │
p4q1 model (raw string) ────┤                              │
                            ▼                              ▼
  derivedPayers ────► paying ──► gross ──► commission(model, b.app_store_commission)
                        │          │            │
                        │          ├──────────► net ──► ARR
                        │          │            ├────► profit
                        │          │            └────► arpuEffective(net, paying)
                        │          └─► tco(opex, commission)
                        │
  derivedCac ───────► cac ────────────────────► ltvCacRatio(ltv, cac)
                                                └──► paybackPeriodMonths(cac, price)
  derivedLifetimeMonths ─► lifetime ──► ltv(price, lifetime)

  b.churn / b.retention_d30 ──► impliedLifetime ──┐
                                                   ├─► comparisons.lifetime
  lifetime ────────────────────────────────────────┘
  arpu, b.arpu_12mo_blended ──► comparisons.arpu
  ratio, b.ltv_cac_min_threshold ──► comparisons.ltvCac
```

Fourteen `Computed` values out, plus `comparisons` and `benchmarksUsed`.

---

## `server/services/derivation.service.ts` — 666 lines, 22 exports

**Purpose.** Size the market from published sources, project it forward month by month, and
judge the founder's objectives against the result. **Pure** — no network, no database.

**Its own header (present):** `/* TAM -> SAM -> SOM, a month-by-month projection, and the
verdict that compares the founder's objectives against all of it. */`

**Related ADR:** ADR-012, ADR-013, ADR-015 (the chart consumes `points`).

### 2.1 Types

| Name | Shape | Notes |
|---|---|---|
| `SegmentFactor` | `label, kind, indicator, value, year` | Built by `derivationInputs`; `kind` matches the bank's `derivationLayer.segments` |
| `MarketModel` | `'consumer_installs' \| 'b2b_licence'` | The branch point |
| `VenueCounts` | `low, lowSource, high, highSource` | Two sources, both carried |
| `DerivationInputs` | 16 fields, all plain data | **No handle to anything** — this is the purity contract |
| `ProjectionPoint` | `{ month, payers, netRevenue }` | Feeds the chart |
| `VerdictCode` | `'supported' \| 'ambitious' \| 'unsupported' \| 'undeterminable'` | |
| `ObjectiveVerdict` | `code, objective, derived, ratio, detail, unvalidated` | |
| `Lever` | `{ name, detail, unvalidated }` | Back-solved changes |
| `DerivationResult` | 17 fields | |

### 2.2 The branch point

| Name | Signature | Value | Tested? |
|---|---|---|---|
| `B2B_MODEL` | `const string` | `'Sold to businesses (B2B licence)'` — must match p4q1's option **exactly** | via `marketModelFor` tests |
| `marketModelFor` | `(businessModel: string \| null) => MarketModel` | `=== B2B_MODEL ? 'b2b_licence' : 'consumer_installs'` | 2 tests, incl. `it('routes everything else, including an undecided model, to the consumer funnel')` |

**A null business model routes to the consumer funnel**, not to an error. That is a deliberate
default, asserted by the test above — but it means a project whose p4q1 is unanswered gets a
consumer market size rather than a refusal. In practice p4q1 is `required: true`, so phase 4
cannot be approved without it.

### 2.3 The funnel — consumer branch

| Name | Signature | Inputs | Output | Side effects | Failure mode | Tested? |
|---|---|---|---|---|---|---|
| `tamPeople` | `(input) => Computed` | population, internetPct | `pop × (internet% / 100)` people | **none — pure** | `unavailable` naming `worldbank:SP.POP.TOTL` or `IT.NET.USER.ZS` | 4 tests |
| `samPeople` | `(tam, input) => Computed` | segments, platformShare | narrowed people | none | passes an unvalidated TAM straight through; `unavailable` when a segment has no figure | 7 tests |
| `installsPerMonth` | `(input, cpi, model?) => Computed` | budget, cpi | installs or venues per month | none | 4 distinct outcomes — see below | 4 tests |
| `monthlySurvival` | `(churn, retentionD30) => Computed` | two benchmarks | a fraction 0..1 | none | `unavailable` when neither is sourced; refuses 100% churn | 4 tests |
| `noConversionStep` *(private)* | `() => Computed` | — | a hard `100` percent, tier `primary` | none | cannot fail | via the B2B suite |

**`samPeople`'s three segment kinds** (lines 85-118):

| `kind` | Effect | Caveat emitted |
|---|---|---|
| `none` | skipped entirely | — |
| `percent_of_population` | `running × (v / 100)` | *"Narrowed to 'X' — N% of the population in YYYY, World Bank."* |
| `complement_of_percent` | `running × ((100 − v) / 100)` | as above, with the complement — this is how "Men" is derived from the female-population indicator |
| `absolute_count` | **replaces** the base entirely, tier `primary` | *"This is a headcount, so it replaces the population base rather than scaling it."* |

The `absolute_count` branch is the one that would otherwise be silently wrong: multiplying a
population by a headcount is meaningless, so the code substitutes rather than scales, and says
so.

**Two segments combined get an independence warning** (lines 120-125) — *"Multiplying their
shares assumes the two are independent of one another, which is an approximation — the real
overlap is not published."* Only fires when more than one non-`none` segment applied. Asserted by
`it('states the independence assumption when two segments are combined')`.

**Platform share is never applied.** Lines 127-132 handle `platformSharePct === null` by adding a
caveat and returning. `derivationInputs` hard-codes `platformSharePct: null`
([derivationInputs.service.ts:121](../../../../server/services/derivationInputs.service.ts)), so
**the `null` branch is the only one that runs in production**. Lines 134-141 — the branch that
applies platform share — are reachable only from tests
(`it('applies platform share when it is sourced')`). This confirms Master Plan §10's
*"Platform share has no source"*, and locates it precisely: it is not a missing benchmark, it is
a hard-coded `null` in the input builder.

**`installsPerMonth`'s four outcomes** (lines 144-177), each with model-aware wording:

| Condition | Result |
|---|---|
| `acquisitionBudget === null` | `unavailable('The monthly acquisition budget was not answered.')` |
| `acquisitionBudget === 0` | **a genuine `0`**, tier `assumption`, with a caveat explaining that organic growth is real but unforecastable |
| `cpi` unvalidated | `unavailable` naming both `p4q7` and the cpi's own inputs |
| `cpi.value === 0` | `unavailable('A cost-per-install of zero would imply unlimited installs.')` |
| otherwise | `budget / cpi` |

The unit and nouns switch on `model`: `installs/month` vs `venues/month`, `cost-per-install` vs
`cost to acquire one business customer`. ADR-013's *"Wording follows the model"* — verified.
Asserted by `it('speaks about business customers, not installs, when a figure is missing')`.

### 2.4 The funnel — B2B branch

| Name | Signature | Output | Failure mode | Tested? |
|---|---|---|---|---|
| `tamVenues` | `(input) => Computed` | the **high** count, tier `secondary` | `unavailable` naming `overpass`, `wikidata` when both are null | 5 tests |
| `marketCeilingRevenue` | `(market, pricePerMonth, commissionPct) => Computed` | `market × price × (1 − commission)` | `unavailable` if market or price is unvalidated; **ignores an unvalidated commission** (treats `keep = 1`) | 5 tests |

**`tamVenues` uses the generous count deliberately** (line 212): `const high = v.high ?? v.low`.
ADR-013's reason — *"a conclusion drawn against it cannot be argued down by saying the count was
too conservative"* — and it is asserted by name:
`it('reports the generous count so a conclusion drawn against it cannot be argued down')`.

Both counts are carried in the caveats when they differ (lines 219-224), producing the
"treat the market as a range of 57-434 venues" sentence.

**`marketCeilingRevenue` deliberately degrades rather than blocks** (lines 243-244): an
unvalidated commission means `keep = 1`, i.e. **no** commission deducted, which can only make the
ceiling *larger*. Since the ceiling is used to refuse an objective, a larger ceiling is the
conservative direction. Asserted by
`it('ignores an unsourced commission rather than blocking, since that only widens the bound')`.

The ceiling's own caveat is the honest one: *"This is what the market yields at 100% share —
every customer in it, none lost, from month one. No business achieves it. It is an upper bound,
not a forecast."*

### 2.5 The projection

| Name | Signature | Output | Complexity | Tested? |
|---|---|---|---|---|
| `project` | `(installs, storeConversionPct, survival, pricePerMonth, commissionPct, months) => { points, blocked }` | `ProjectionPoint[]` + the blocking input | `O(months)` | 4 tests |

```ts
for (const c of [installs, storeConversionPct, survival, pricePerMonth, commissionPct])
  if (c.unvalidated || c.value === null) return { points: [], blocked: c };

const perMonth = installs.value * (storeConversionPct.value / 100);
let payers = 0;
for (let m = 1; m <= months; m += 1) {
  payers = payers * s + perMonth;                    // cohorts accumulate, decaying
  points.push({ month: m, payers, netRevenue: payers * price * keep });
}
```

**The recurrence is the finding.** `payers(m) = payers(m-1) × s + perMonth` converges to
`perMonth / (1 − s)`, which is why ADR-015 says twelve rows of numbers do not communicate the
curve flattening. Asserted by `it('converges rather than growing without limit')`.

**`blocked` returns the `Computed` itself**, not a boolean, so `derive` can propagate that
input's own reason rather than saying "the projection failed".

### 2.6 The verdict

| Name | Signature | Output | Failure mode | Tested? |
|---|---|---|---|---|
| `undeterminable` *(private)* | `(detail, objective?) => ObjectiveVerdict` | code `undeterminable` | — | ✓ |
| `band` *(private)* | `(ratio: number) => VerdictCode` | `>= 1` supported, `>= 0.6` ambitious, else unsupported | — | via `judge` |
| `judge` | `(what, unit, objective, derived, horizon, floor?) => ObjectiveVerdict` | a verdict + prose | `undeterminable` on a null objective, an unvalidated derived figure, or an objective of 0 | 5 tests |
| `levers` | `(objectiveRevenue, derivedRevenue, acquisitionBudget, payersAtHorizon, pricePerMonth, commissionPct, points, horizon) => Lever[]` | 0-3 levers | returns a single "Not back-solvable" lever when the derived figure is unavailable | 4 tests |
| `overallVerdict` *(private)* | `(revenue, users, floor, ceiling) => {code, headline, detail}` | the headline | — | 3 tests via `derive` |

**`judge`'s two grading modes** (lines 329-332):

```ts
const code: VerdictCode = floor !== null && floor > 0
  ? (derived.value >= objective ? 'supported'
     : derived.value >= floor   ? 'ambitious' : 'unsupported')
  : band(ratio);
```

With a floor, "ambitious" means *clears your walk-away figure, misses your target* — the
founder's own standard, exactly as ADR-012 argues. Without a floor it falls back to `band()`'s
**0.6 ratio**, which ADR-012 says was replaced. It was not: `judge('user', 'people',
input.objectiveUsers, somPayers, horizon)` at line 561 passes **no floor**, so the adoption
verdict is still graded on the arbitrary 0.6. See [07-gaps-and-drift.md](07-gaps-and-drift.md)
D8.

**`levers`' three back-solves** (lines 389-425), all conditional:

| Lever | Emitted when | Arithmetic | Honesty caveat included |
|---|---|---|---|
| Budget | `acquisitionBudget > 0` | `budget × (objective / derived)` | *"assumes cost-per-install does not rise as you buy more of it, which in practice it does"* |
| Price | payers > 0 and commission known | `objective / (payers × (1 − comm/100))` | *"Check this against what comparable apps charge"* |
| Time | **always** | scans a 60-month projection for the first month reaching the objective | *"Cohort decay eventually cancels new arrivals, so more time alone does not close this gap"* |

The Time lever is why `derive` runs the projection **twice** — once to `horizon` and once to
`PROJECTION_CEILING = 60` (lines 505-506). The long run is used only for this lookup.

**`overallVerdict`'s precedence** (lines 595-665), in order:

1. **The ceiling outranks everything.** If `objectiveRevenue > marketCeiling`, the verdict is
   *"Do not proceed — the objective is larger than the market"* and no forecast is consulted.
   Asserted by `it('lets the ceiling outrank a working projection')`.
2. Both objectives undeterminable → *"No verdict — the evidence is missing"*, with the explicit
   framing *"This is a gap in the benchmark data, not a finding about your idea."*
3. Otherwise the **worst** of the two codes wins, and a `diagnosis` sentence is appended when the
   two disagree — pointing at price when reach is fine and revenue is not, and at budget when the
   reverse holds.
4. The floor line is appended whenever a floor exists.

The B2B wording swap is one line (600): `'every business in it'` vs `'every customer in it'`.

### 2.7 `derive` — the orchestrator

| Name | Signature | Inputs | Output | Side effects | Failure mode | Tested? |
|---|---|---|---|---|---|---|
| `DERIVATION_BENCHMARK_KEYS` | `readonly [7 strings]` | — | — | — | — | — |
| `derive` | `(input: DerivationInputs) => DerivationResult` | plain data | 17 fields | **reads the benchmark Map only** | never throws | **61 tests** — the largest suite in the project |

Seven benchmark keys: `cpi_usd`, `store_conversion_pct`, `churn_monthly_pct`,
`retention_d30_pct`, `app_store_commission_standard_pct`, `b2b_cac_usd`,
`b2b_logo_churn_monthly_pct`.

**The B2B substitution is explicit, not implicit** (lines 498-503):

```ts
const survival = isB2B
  ? monthlySurvival(fromBenchmark(b.b2b_logo_churn_monthly_pct), unavailable(
      'App retention benchmarks count installs still opening an app. They do not describe whether '
      + 'a business renews a licence, so they are not substituted here.',
      'percent', ['p4q1 business_model']))
  : monthlySurvival(fromBenchmark(b.churn_monthly_pct), fromBenchmark(b.retention_d30_pct));
```

The second argument in the B2B case is a *constructed refusal*, so if B2B churn is unsourced the
result is unvalidated with a sentence explaining why app retention was not used instead of
silently substituting it. This is the fix ADR-013 describes for the 1.05-month lifetime, and it
is asserted by `it('takes licence renewal from B2B churn, never from app retention')`.

**`marketBound` — reporting unclamped** (lines 529-534). When the budget would buy more customers
than the market contains, `somPayers` is **not clamped**; a caveat is added instead:
*"The figure is reported unclamped so the mismatch is visible."*

**`impliedLifetimeMonths` derives from survival, not from a benchmark directly** (lines 540-547):
`1 / (1 − survival)`, with a refusal at `survival >= 1`. This is the value handed to
`calculate` as `derivedLifetimeMonths`.

**`costPerPayingCustomer` branches** (lines 549-557): for B2B it *is* the acquisition cost
(`cpi`, i.e. `b2b_cac_usd`) because a signed venue already pays. For consumer it is
`cpi / (storeConv / 100)`, guarded against a zero conversion rate.

**`horizon` is clamped** (line 476): `Math.max(1, input.horizonMonths ?? 12)`. Asserted by
`it('clamps a nonsensical horizon to at least one month')`.

### 2.8 The purity test

[derivation.service.test.ts:299](../../../../server/services/derivation.service.test.ts):

```ts
it('never lets an objective influence the projection it is judged against', () => {
  const modest = derive(inputs({ objectiveRevenue: 1 }));
  const wild   = derive(inputs({ objectiveRevenue: 100_000_000 }));
  expect(modest.derivedMonthlyRevenue.value).toEqual(wild.derivedMonthlyRevenue.value);
});
```

**Verified as genuinely load-bearing.** `objectiveRevenue`, `objectiveFloor` and `objectiveUsers`
are read at only four points in `derive`, all *after* the projection is complete: the ceiling
check (538), the three `judge` calls (559-564), and `levers` (581-583). No projection input
reads any of them. This is the product's central claim, and the code supports it.

---

## `server/services/derivationInputs.service.ts` — 132 lines, 3 exports

**Purpose.** Fetch everything `derive()` needs, so that `derive()` can stay pure. The file exists
because of a purity constraint, not for tidiness — Coding Guide §1.8 and rule 2 of §6
**[sibling]**.

**Its own header (present):** `/* Assembles DerivationInputs from the answers and the approved
sources. */`

| Name | Signature | Inputs | Output | Side effects | Failure mode | Tested? | Calls |
|---|---|---|---|---|---|---|---|
| `DERIVATION_QUESTIONS` | `const` map, 8 entries | — | — | — | — | no test | — |
| `num` *(private)* | `(raw) => number \| null` | pg NUMERIC | number or null | none | `''` → null | — | — |
| `horizonMonths` *(private)* | `(text) => number \| null` | `"12 months"` | `12` | none | `null` when no digits | no test | regex `/\d+/` |
| `band` *(private)* | `(value: unknown) => { min, max }` | `value_json` | two bounds | none | `{null, null}` for a non-object | no test | `num` |
| `resolveSegments` *(private)* | `(labels, countryIso3) => Promise<SegmentFactor[]>` | labels + ISO3 | up to 2 factors | **network** (1 World Bank call per segment) | a failed call yields `value: null`, which `samPeople` reports honestly | no test | `getSegmentFilters`, `worldBankIndicator` |
| `countVenues` *(private)* | `(iso2) => Promise<VenueCounts \| null>` | ISO2 | two counts | **network** (Overpass + Wikidata) | both `.catch(() => null)`; returns `null` if both fail | no test | `retailVenueCount`, `notableMallCount` |
| `ExternalForDerivation` | interface | — | — | — | — | — | — |
| `buildDerivationInputs` | `(verticalId, answers, external) => Promise<DerivationInputs>` | — | the pure input object | **network** via the two helpers | never throws — every fetch is caught | **no test** | all of the above |

### 3.1 Five verified observations

**1. `DERIVATION_QUESTIONS.platforms` is dead.** Declared at line 12 as `'p1q4'`; never
referenced again in the file. `p1q4` (platform selection) reaches no derivation input — which is
consistent with `platformSharePct` being hard-coded `null`, but means the founder's platform
answer has no effect on any number.

**2. `platformSharePct` and `platformShareSource` are hard-coded `null`** (lines 121-122). Not
"unsourced at runtime" — never populated. This is the single line behind Master Plan §10's
platform-share limitation.

**3. The Wikidata venue count is Israel-only** (line 72):

```ts
iso2.toUpperCase() === 'IL' ? notableMallCount('Q801').catch(() => null) : Promise.resolve(null),
```

`Q801` is the Wikidata id for Israel, hard-coded alongside the ISO check. For any other country
the two-source range ADR-013 promises collapses to the single Overpass figure, and `tamVenues`'s
`low !== high` branch never fires.

**4. Segments are fetched even when they cannot be used.** Lines 106-108 run `resolveSegments`
unconditionally, before the B2B check at line 110. For a B2B project `derive` sets `sam = tam`
and never calls `samPeople` — so the World Bank call for `SP.URB.TOTL.IN.ZS` on the seed project
is made, cached and discarded. One wasted uncached network call per B2B generation.

**5. Only the first two segment labels are used** (line 49): `labels.slice(0, 2)`. p2q6 is a
multiselect; a founder selecting three groups has the third silently dropped, with no caveat.
`samPeople`'s independence warning names only the segments that were applied, so the omission is
invisible in the output.

### 3.2 The band, mapped to two fields

```ts
const revenue = band(byId.get(q.objectiveRevenue)?.value_json);
…
objectiveRevenue: revenue.max,     // the target
objectiveFloor:   revenue.min,     // the walk-away figure
```

One question (`p4q8`) becomes two derivation inputs — the design ADR-012 argues for. Note that
`judge` receives `objectiveFloor` for revenue and nothing for users, which is where the 0.6 band
survives (§2.6).

---

## Coverage summary for this section

| File | Lines | Exports | Unit tests | Notable gaps |
|---|---|---|---|---|
| `calculation.service.ts` | 412 | 31 | **48** | `annualRecurringRevenue` has no direct test; `inputsFromAnswers` is covered only end-to-end |
| `derivation.service.ts` | 666 | 22 | **61** | none of substance — every exported function has at least one test |
| `derivationInputs.service.ts` | 132 | 3 | **0** | `buildDerivationInputs`, `resolveSegments`, `countVenues`, `band`, `horizonMonths` are entirely untested. This is the largest untested surface in the numbers layer, and it is the module that decides which country and which venue query the derivation sees |

`derivationInputs.service.ts` having zero tests is the notable one: it is impure by design, so
the project's offline-test rule excludes it — but `band()`, `horizonMonths()` and `num()` are
pure and could be tested without a network.

---

*Next: [02d-services-data-sources.md](02d-services-data-sources.md).*
