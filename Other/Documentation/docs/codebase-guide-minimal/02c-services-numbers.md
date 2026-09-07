# 02c — Services: the numbers (minimal)

Three files, **1,210 lines, 56 exports**: `calculation.service.ts` (412, 31),
`derivation.service.ts` (666, 22), `derivationInputs.service.ts` (132, 3).
The deterministic core — everything here runs before the trust boundary.

---

# 1. `calculation.service.ts` — 412 lines

## 1.1 Types

| Name | Definition |
|---|---|
| `ComputedConfidence` | `primary \| secondary \| tertiary \| placeholder \| assumption` — **five tiers**. `assumption` exists only here, never in a benchmark file |
| `Computed` | `{ value, unit, confidence, unvalidated, unvalidatedReason, inputs: string[], usedBenchmark, caveats: string[] }` |
| `Comparison` | `{ verdict: 'above'\|'below'\|'within'\|'unavailable', detail, unvalidated }` |
| `CalculationInputs` | 6 answer-derived fields + 3 optional `derived*` overrides |
| `CalculationResult` | 14 `Computed` fields + `comparisons` + `benchmarksUsed` |
| `AnswerLike` | Structural subset of `AnswerRow` |

`value` is `null` **only** when `unvalidated` is true. `usedBenchmark` is **not** derivable from
`confidence` — a benchmark mixed with an answer yields `assumption`, which alone cannot say
whether a published figure contributed.

## 1.2 Constructors — the only ways to make a `Computed`

| Name | Behaviour |
|---|---|
| `weakest(...tiers)` | The weakest by `TIERS` order; seeds with `'primary'` |
| `computed` *(private)* | Returns `unavailable(...)` if `!Number.isFinite(value)`. Reachable **only** through `combine` |
| `unavailable(reason, unit, inputs?)` | `value: null`, `unvalidated: true`, `caveats: [reason]` |
| `assumption(value, unit, label)` | Tier `assumption`, `usedBenchmark: false`. `null`/non-finite → `unavailable("<label> was not answered.")` |
| `fromBenchmark(m: Resolved)` | Tier from the metric, `usedBenchmark: true`, `caveats: benchmarkCaveats(m)` |

The `assumption` label convention is `"<questionId> <field_name>"`, e.g. `'p4q2 price_per_month'`
— it becomes a provenance entry and appears in messages the founder reads.

## 1.3 The chokepoint — `combine`

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

**Three guarantees:** poisoning is honest and named (the *first* broken input's own reason
propagates, so a five-deep chain still names the missing benchmark) · confidence never launders ·
Infinity cannot escape.

`mergeCaveats` filters both assumption strings out first, or a chain of assumption-tier figures
would accumulate the same sentence repeatedly.

**`divide`** exists because `combine` alone cannot express a domain-specific zero: `x / 0` is
`Infinity`, which `computed` would report generically. `divide` intercepts and supplies an
actionable sentence, e.g. *"Not applicable for a zero-price model."*

## 1.4 The thirteen formulas

| # | Name | Formula | Special handling |
|---|---|---|---|
| 1 | `payingUsers(reachableMarket, conversionPct)` | `m × (c/100)` | — |
| 2 | `grossMonthlyRevenue(paying, price)` | `p × price` | — |
| 3 | `storeCommission(gross, businessModel, commissionPct)` | `g × (pct/100)` | Three-way branch, below |
| 4 | `netMonthlyRevenue(gross, commission)` | `g − c` | — |
| 5 | `annualRecurringRevenue(net)` | `n × 12` | No direct test |
| 6 | `monthlyTco(opex, commission)` | `o + c` | — |
| 7 | `monthlyProfit(net, opex)` | `n − o` | May be negative |
| 8 | `arpuEffective(net, payingCustomers)` | `net / payers` | `divide`, zero-guarded |
| 9 | `cacEstimate(cpi, conversionPct)` | `cpi / (pct/100)` | Explicit `=== 0` guard before `combine` |
| 10 | `ltvEstimate(price, lifetimeMonths)` | `price × months` | — |
| 11 | `benchmarkImpliedLifetimeMonths(churn, retentionD30)` | `100/churn`, else `100/(100−retention)` | **Prefers churn**; refuses 0% churn and 100% retention |
| 12 | `ltvCacRatio(ltv, cac)` | `ltv / cac` | `divide` |
| 13 | `paybackPeriodMonths(cac, price)` | `cac / price` | `divide` |

**`storeCommission`'s four branches** — the only formula reading a raw string:

| Business model | Result |
|---|---|
| `null` | `unavailable('The business model was not answered.')` |
| `NOT_STORE_DISTRIBUTED` — Advertising, Commission on transactions, **B2B licence** | A genuine `0`, tier `assumption`, caveat naming the model. Not unvalidated |
| `STORE_DISTRIBUTED` — Subscription, Freemium, In-app purchases, One-time purchase | `combine` + a caveat that the *standard* rate was assumed |
| Anything else | `unavailable('…cannot be determined for "X"')` |

Both option sets are **hard-coded string literals copied from p4q1**, not derived from the bank.
Editing p4q1's option text would silently drop both into "cannot be determined".

**Naming defect in the test suite:** `arpuEffective`'s test is named `arpu_effective = net /
reachable` and passes `num(250000, 'people')` as the denominator. The arithmetic assertion is
correct, but the name and fixture still describe the pre-v3.0 denominator, so the test cannot
catch a regression to the old behaviour.

## 1.5 The three comparisons

| Name | `unavailable` when | Thresholds |
|---|---|---|
| `arpuDivergence(arpu, benchmarkArpu)` | either unvalidated; benchmark 0 | `> 2×` above, `< 0.5×` below |
| `lifetimeDivergence(answered, implied)` | either unvalidated; implied 0 | `> 2×` above, `< 0.5×` below |
| `ltvCacVerdict(ratio, floor)` | either unvalidated | `ratio >= floor` above |

`arpuDivergence` divides the benchmark by 12 first — `arpu_12mo_blended_usd` is annual,
`arpuEffective` is monthly — and says so in the detail string.

`lifetimeDivergence`'s prose opens *"You expect a paying customer to stay N months."* — no longer
accurate; see §1.7.

## 1.6 Orchestration

| Name | Notes |
|---|---|
| `BENCHMARK_KEYS` | `readonly [9 strings]`, `as const` |
| `ECONOMIC_QUESTIONS` | 6 field→questionId; **three ids no longer exist** |
| `toNumber` *(private)* | `''` → `null`, **not `0`** |
| `inputsFromAnswers(verticalId, answers)` | Never throws |
| `calculate(input)` | 14 figures + 3 comparisons + the benchmark map. Reads the module-scope benchmark Map, no I/O. Never throws. **50 tests** |

```ts
const b = Object.fromEntries(
  BENCHMARK_KEYS.map((k) => [k, resolveBenchmark(input.verticalId, k)]),
) as Record<(typeof BENCHMARK_KEYS)[number], Resolved>;
```

The nine keys: `app_store_commission_standard_pct`, `cpi_usd`, `churn_monthly_pct`,
`retention_d30_pct`, `arpu_12mo_blended_usd`, `ltv_cac_min_threshold_ratio`,
`crash_rate_user_perceived_max_pct`, `anr_rate_user_perceived_max_pct`,
`crash_rate_per_device_max_pct`. The last three (Android vitals) are resolved and shipped to the
prompt but **never enter a formula**.

`toNumber`'s blank-string guard matters: `Number('')` is `0`, so without it a blank answer would
become a real zero.

## 1.7 What ADR-012 left behind — three unreachable paths

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

`p2q3`, `p4q3`, `p4q6` are absent from the bank, so `inputsFromAnswers` always returns `null`
for all three.

| Line | Expression | Effect in production |
|---|---|---|
| 367 | `reachableMarket = assumption(null, …)` | always unavailable |
| 369 | `conversionPct = assumption(null, …)` | always unavailable |
| 372 | `paying = input.derivedPayers ?? payingUsers(...)` | `derivedPayers` is always supplied → **`payingUsers` never called** |
| 380 | `cac = input.derivedCac ?? cacEstimate(...)` | **`cacEstimate`'s production path is dead** |
| 383-385 | `lifetime = expectedLifetimeMonths !== null ? assumption(...) : (derivedLifetimeMonths ?? implied)` | first branch **unreachable** |

**Consequences**

1. `payingUsers`, the `cacEstimate(cpi, conversionPct)` call, and
   `assumption('p4q6 expected_lifetime_months')` are live only in 5 unit tests.
2. **The "two views" lifetime comparison now compares two derived figures.**
   `calc.expectedLifetimeMonths` = the derivation's implied lifetime (from `monthlySurvival`);
   `calc.benchmarkImpliedLifetimeMonths` = the calculation layer's (from
   `churn_monthly_pct`/`retention_d30_pct`). For consumer projects both derive from the same
   benchmarks (ratio ≈1, `within`). For **B2B** they diverge sharply — the comparison reports a
   large divergence between two figures **neither of which the founder supplied**.
3. **The prompt narrates a derived figure as an answer:**
   `fig('Expected customer lifetime (the founder answered this)', calc.expectedLifetimeMonths)`
   (`context.ts:91`), plus `lifetimeDivergence`'s *"You expect…"*. Both are false — the precise
   failure ADR-012 was written to eliminate.
4. `rehearse.ts:100` prints it as answered too.

Tracked as **D7**.

## 1.8 `calculate`'s data flow

```
              BENCHMARK_KEYS ──► benchmark.resolve × 9 ──► b
p4q2 price ──► assumption ──┐                              │
p4q4 opex  ──► assumption ──┤                              │
p4q1 model (raw string) ────┤                              ▼
  derivedPayers ────► paying ──► gross ──► commission(model, b.app_store_commission)
                        │          │            │
                        │          ├──────────► net ──► ARR
                        │          │            ├────► profit
                        │          │            └────► arpuEffective(net, paying)
                        │          └─► tco(opex, commission)
  derivedCac ───────► cac ────────────────────► ltvCacRatio(ltv, cac)
                                                └──► paybackPeriodMonths(cac, price)
  derivedLifetimeMonths ─► lifetime ──► ltv(price, lifetime)
  b.churn / b.retention_d30 ──► impliedLifetime ──┐
                                                   ├─► comparisons.lifetime
  lifetime ────────────────────────────────────────┘
```

---

# 2. `derivation.service.ts` — 666 lines, 22 exports

TAM → SAM → SOM, a month-by-month projection, and the verdict. **Pure** — no network, no DB.

## 2.1 Types

`SegmentFactor` (`label, kind, indicator, value, year`) · `MarketModel` ·
`VenueCounts` (`low, lowSource, high, highSource`) · `DerivationInputs` (16 fields, all plain
data — **no handle to anything**, the purity contract) · `ProjectionPoint` (`month, payers,
netRevenue`) · `VerdictCode` (`supported | ambitious | unsupported | undeterminable`) ·
`ObjectiveVerdict` · `Lever` · `DerivationResult` (17 fields).

## 2.2 The branch point

```ts
export const B2B_MODEL = 'Sold to businesses (B2B licence)';
export const marketModelFor = (businessModel: string | null): MarketModel =>
  businessModel === B2B_MODEL ? 'b2b_licence' : 'consumer_installs';
```

**A null business model routes to the consumer funnel**, not to an error — deliberate. In
practice p4q1 is `required: true`, so phase 4 cannot be approved without it.

## 2.3 The funnel — consumer branch

| Name | Formula / output | Failure mode |
|---|---|---|
| `tamPeople(input)` | `pop × (internet%/100)` people | `unavailable` naming `worldbank:SP.POP.TOTL` or `IT.NET.USER.ZS` |
| `samPeople(tam, input)` | Narrowed people | Unvalidated TAM passes through; `unavailable` when a segment has no figure |
| `installsPerMonth(input, cpi, model?)` | installs or venues per month | Four outcomes, below |
| `monthlySurvival(churn, retentionD30)` | fraction 0..1 | `unavailable` when neither sourced; refuses 100% churn |
| `noConversionStep()` *(private)* | a hard `100` percent, tier `primary` | cannot fail |

**`samPeople`'s three segment kinds**

| `kind` | Effect |
|---|---|
| `none` | Skipped |
| `percent_of_population` | `running × (v/100)` |
| `complement_of_percent` | `running × ((100−v)/100)` — how "Men" is derived from the female-population indicator |
| `absolute_count` | **Replaces** the base entirely, tier `primary` — multiplying a population by a headcount is meaningless, so it substitutes and says so |

Two segments combined emit an independence warning. **Platform share is never applied** —
`derivationInputs` hard-codes `platformSharePct: null`, so only the `null` branch runs in
production; the applying branch (134-141) is reachable only from tests.

**`installsPerMonth`'s four outcomes** — wording switches on `model` (`installs/month` vs
`venues/month`, `cost-per-install` vs `cost to acquire one business customer`):

| Condition | Result |
|---|---|
| budget `null` | `unavailable('The monthly acquisition budget was not answered.')` |
| budget `0` | A genuine `0`, tier `assumption`, caveat about unforecastable organic growth |
| `cpi` unvalidated | `unavailable` naming both `p4q7` and the cpi's inputs |
| `cpi.value === 0` | `unavailable('A cost-per-install of zero would imply unlimited installs.')` |
| otherwise | `budget / cpi` |

## 2.4 The funnel — B2B branch

| Name | Output | Notes |
|---|---|---|
| `tamVenues(input)` | The **high** count, tier `secondary` | `const high = v.high ?? v.low` — the generous count deliberately, so a conclusion drawn against it cannot be argued down. Both counts carried in caveats when they differ |
| `marketCeilingRevenue(market, price, commissionPct)` | `market × price × (1 − commission)` | **Ignores an unvalidated commission** (`keep = 1`) — that only widens the bound, the conservative direction for a refusal |

The ceiling's own caveat: *"This is what the market yields at 100% share — every customer in it,
none lost, from month one. No business achieves it. It is an upper bound, not a forecast."*

## 2.5 The projection

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

`payers(m) = payers(m−1) × s + perMonth` converges to `perMonth / (1 − s)` — which is why twelve
rows of numbers do not communicate the curve flattening (ADR-015). `blocked` returns the
`Computed` itself, not a boolean, so `derive` can propagate that input's own reason.

## 2.6 The verdict

| Name | Behaviour |
|---|---|
| `band(ratio)` *(private)* | `>= 1` supported, `>= 0.6` ambitious, else unsupported |
| `judge(what, unit, objective, derived, horizon, floor?)` | `undeterminable` on a null objective, unvalidated derived figure, or objective of 0 |
| `levers(...)` | 0-3 levers; a single "Not back-solvable" lever when derived is unavailable |
| `overallVerdict(...)` *(private)* | The headline |

```ts
const code: VerdictCode = floor !== null && floor > 0
  ? (derived.value >= objective ? 'supported'
     : derived.value >= floor   ? 'ambitious' : 'unsupported')
  : band(ratio);
```

With a floor, "ambitious" means *clears your walk-away figure, misses your target*. **Without a
floor it falls back to the 0.6 band ADR-012 says was replaced** — and the adoption verdict
(`judge('user', 'people', input.objectiveUsers, somPayers, horizon)`, line 561) passes no floor.
Tracked as **D8**.

**`levers`' three back-solves**

| Lever | Emitted when | Arithmetic | Honesty caveat |
|---|---|---|---|
| Budget | `acquisitionBudget > 0` | `budget × (objective / derived)` | *"assumes cost-per-install does not rise as you buy more of it, which in practice it does"* |
| Price | payers > 0 and commission known | `objective / (payers × (1 − comm/100))` | *"Check this against what comparable apps charge"* |
| Time | **always** | Scans a 60-month projection for the first month reaching the objective | *"Cohort decay eventually cancels new arrivals"* |

The Time lever is why `derive` runs the projection **twice** — once to `horizon`, once to
`PROJECTION_CEILING = 60`.

**`overallVerdict`'s precedence**

1. **The ceiling outranks everything** — `objectiveRevenue > marketCeiling` → *"Do not proceed"*,
   no forecast consulted
2. Both objectives undeterminable → *"No verdict — the evidence is missing"*, framed as
   *"a gap in the benchmark data, not a finding about your idea"*
3. Otherwise the **worst** code wins, with a `diagnosis` sentence when the two disagree
4. The floor line is appended whenever a floor exists

The B2B wording swap is one line: `'every business in it'` vs `'every customer in it'`.

## 2.7 `derive` — the orchestrator

`DERIVATION_BENCHMARK_KEYS` (7): `cpi_usd`, `store_conversion_pct`, `churn_monthly_pct`,
`retention_d30_pct`, `app_store_commission_standard_pct`, `b2b_cac_usd`,
`b2b_logo_churn_monthly_pct`. `derive` reads the benchmark Map only, never throws. **61 tests** —
the largest suite in the project.

**The B2B substitution is explicit, not implicit:**

```ts
const survival = isB2B
  ? monthlySurvival(fromBenchmark(b.b2b_logo_churn_monthly_pct), unavailable(
      'App retention benchmarks count installs still opening an app. They do not describe whether '
      + 'a business renews a licence, so they are not substituted here.',
      'percent', ['p4q1 business_model']))
  : monthlySurvival(fromBenchmark(b.churn_monthly_pct), fromBenchmark(b.retention_d30_pct));
```

- **`marketBound`** — when the budget would buy more customers than the market contains,
  `somPayers` is **not clamped**; a caveat says *"reported unclamped so the mismatch is visible."*
- **`impliedLifetimeMonths`** = `1 / (1 − survival)`, refused at `survival >= 1`. This is what is
  handed to `calculate` as `derivedLifetimeMonths`.
- **`costPerPayingCustomer`** — B2B: it *is* the acquisition cost (`b2b_cac_usd`), because a
  signed venue already pays. Consumer: `cpi / (storeConv / 100)`, zero-guarded.
- **`horizon`** is clamped: `Math.max(1, input.horizonMonths ?? 12)`.

## 2.8 The purity test

```ts
it('never lets an objective influence the projection it is judged against', () => {
  const modest = derive(inputs({ objectiveRevenue: 1 }));
  const wild   = derive(inputs({ objectiveRevenue: 100_000_000 }));
  expect(modest.derivedMonthlyRevenue.value).toEqual(wild.derivedMonthlyRevenue.value);
});
```

**Genuinely load-bearing.** `objectiveRevenue`, `objectiveFloor` and `objectiveUsers` are read at
only four points, all *after* the projection completes: the ceiling check (538), the three
`judge` calls (559-564), and `levers` (581-583).

---

# 3. `derivationInputs.service.ts` — 132 lines, 3 exports

Fetches everything `derive()` needs so `derive()` can stay pure. The file exists because of a
purity constraint, not tidiness.

| Name | Notes |
|---|---|
| `DERIVATION_QUESTIONS` | 8 entries |
| `num` *(private)* | `''` → `null` |
| `horizonMonths` *(private)* | `"12 months"` → `12` via `/\d+/`; `null` when no digits |
| `band` *(private)* | `value_json` → `{min, max}`; `{null, null}` for a non-object |
| `resolveSegments` *(private)* | **Network** — 1 World Bank call per segment, up to 2 |
| `countVenues` *(private)* | **Network** — Overpass + Wikidata, both `.catch(() => null)` |
| `buildDerivationInputs` | **Network** via the helpers. Never throws — every fetch caught. **No test** |

## 3.1 Five verified observations

1. **`DERIVATION_QUESTIONS.platforms` is dead** — declared as `'p1q4'`, never referenced again.
   The founder's platform answer has no effect on any number.
2. **`platformSharePct` and `platformShareSource` are hard-coded `null`** (121-122). Not
   "unsourced at runtime" — never populated. The single line behind the platform-share limitation.
3. **The Wikidata venue count is Israel-only:**
   `iso2.toUpperCase() === 'IL' ? notableMallCount('Q801').catch(() => null) : Promise.resolve(null)`.
   For any other country the two-source range collapses to the single Overpass figure.
4. **Segments are fetched even when unusable** — `resolveSegments` runs unconditionally *before*
   the B2B check, but B2B sets `sam = tam` and never calls `samPeople`. One wasted uncached
   network call per B2B generation.
5. **Only the first two segment labels are used** — `labels.slice(0, 2)`. A founder selecting
   three groups has the third silently dropped, with no caveat.

## 3.2 The band, mapped to two fields

```ts
const revenue = band(byId.get(q.objectiveRevenue)?.value_json);
objectiveRevenue: revenue.max,     // the target
objectiveFloor:   revenue.min,     // the walk-away figure
```

One question (`p4q8`) becomes two derivation inputs. `judge` receives `objectiveFloor` for
revenue and **nothing for users** — which is where the 0.6 band survives.

---

## Coverage

| File | Lines | Exports | Tests | Gaps |
|---|---:|---:|---:|---|
| `calculation.service.ts` | 412 | 31 | **48** | `annualRecurringRevenue` no direct test; `inputsFromAnswers` end-to-end only |
| `derivation.service.ts` | 666 | 22 | **61** | none of substance |
| `derivationInputs.service.ts` | 132 | 3 | **0** | Entirely untested — the largest untested surface in the numbers layer, and the module deciding which country and venue query the derivation sees. `band()`, `horizonMonths()` and `num()` are pure and could be tested offline |
