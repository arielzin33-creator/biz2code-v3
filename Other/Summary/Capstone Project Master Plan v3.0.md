# Capstone Project Master Plan v3.0

biz2code — a linear gatekeeper for business-validated development.

Status: built and verified. Date: 2026-08-24. Supersedes v2.0 and the v1.0 documents in `Old/`.
Repository: https://github.com/arielzin33-creator/biz2code (private)

## 1. What this document is

v1.0 was a plan written before the build, for a seven-phase pipeline called AAAEE. v2.0 rewrote
it to describe what was actually built. v3.0 records a different kind of change: v2.0 shipped a
working gate and pipeline, but running it showed the questions were wrong, and everything
downstream inherited the error. This version describes the product after that was fixed.

Where the plan and the build diverge, the divergence is stated with its reason.

## 2. The thesis

General-purpose LLMs cannot reliably infer which analysis a business idea requires. Ask one for
a business plan and it produces a fluent document whose figures are invented, whose gaps are
invisible, and whose numbers change on the next run.

biz2code constrains the model into a fixed, human-approved sequence and permits it to cite only
a curated benchmark file and an approved set of public APIs. Anything it cannot source renders
`unvalidated` rather than invented.

v3.0 sharpens the thesis: constraining what a model may cite is not enough if the human supplies
the numbers, because then the document is only as good as the guess it was given. The gate has
to be independent of the founder as well as of the model. The product is the verdict, not the
documents.

## 3. What shipped

- Four phases, each ending in one human-approved gate.
- 23 questions, fixed in `question-bank.json`, never model-generated.
- They ask for objectives and decisions only, never a market estimate.
- Three documents — MRD, PRD, Business Plan — as `.docx`.
- 26 document sections: 25 written by the model, 1 built in code (Key Figures and the chart).
- A derivation layer: TAM → SAM → SOM, month-by-month projection, dual verdicts, back-solved
  levers.
- A calculation layer: 12 formulas in TypeScript, plus 3 comparisons.
- A benchmark corpus of 16 verticals and 194 metrics, 43 of them sourced; 26 of 28 cross-vertical.
- 12 external sources, 10 keyless and 2 needing a free key. Every one is cached.
- 87 TypeScript files, roughly 15,100 lines.
- 260 unit tests, 4 HTTP checkpoints, 1 browser journey, 1 live source probe.
- 16 ADRs.
- One field of 25 renders unvalidated on a full run.

## 4. What changed in v3.0

**The user was being asked to do the app's job.** Three questions requested measurements he
could not have: reachable market size, conversion rate, customer lifetime. `paying_users` was
`reachable_market × conversion_pct` — a guess multiplied by a guess. There was nothing
independent to validate against. All three are retired; the bank now asks for objectives (the
revenue band, the adoption target, the horizon) and decisions (price, budgets, business model,
platforms, target group). The market is derived. (ADR-012)

**A product sold to buildings does not address a population.** The seed project licenses indoor
navigation to shopping centres at $450/month. The consumer funnel gave it a market of 8.2
million people for something sellable to a few hundred premises, and a customer lifetime of
1.05 months by reading app 30-day retention as a contract renewal rate. `p4q1` now selects the
model; a B2B licence sizes its market by counting venues — 434 from OpenStreetMap, 57 from
Wikidata, reported as a range because they count different things. (ADR-013)

**`unvalidated` meant four things.** Four fields were flagged because the prompt told the model
to; others inherited the marker from figures they merely mentioned. It now marks exactly one
thing: a figure was stated for which no source was supplied. Seventeen of twenty-three fields
fell to one of twenty-five. (ADR-014)

**The summary had to stop being prose.** A model that rounds 5,306 to "about 5,300" under a
heading saying Key Figures has broken the only promise that section makes. Six Word tables and
a bar chart are now built in code and never pass through the model. (ADR-015)

## 5. Architecture

```
Browser (React 18 + Vite)                    Express + TypeScript
  pages / components / hooks / context   →   routes → controllers → services → data
  React Query owns server state                              ↓
  Auth: JWT in an httpOnly cookie                      PostgreSQL (raw pg)
                                                             ↓
                                         gate.service.ts — the only writer of phase state
                                                             ↓
                    derivation.service.ts — TAM/SAM/SOM, projection, verdict   ← new in v3.0
                                                             ↓
                    calculation.service.ts — 12 formulas, no model involvement
                                                             ↓
                              benchmark.service.ts — the citable-source allow-list
                                                             ↓
                    figures.ts — Key Figures tables + chart, rendered in code   ← new in v3.0
                                                             ↓
                              llm.service.ts → Groq (Gemini fallback) → docx.service.ts
```

Six tables: `users`, `projects`, `phases`, `answers`, `deliverables`, `external_cache`. `phases`
is the gate. `deliverables` holds one row per version — revision never overwrites.
`external_cache.source` carries a `CHECK` constraint that is the approved-source list: an
unapproved source cannot be cached, and so cannot reach a document.

## 6. The six decisions that define the product

1. **Questions are fixed, never generated** (ADR-003). A gate that invents its own criteria is
   not a gate. All 23 live in a JSON file in the repository.
2. **The founder states goals; the app derives the market** (ADR-012). An objective is never an
   input to a projection, only compared against one. Tested: two runs differing only in the
   stated objective produce identical projections.
3. **Arithmetic is computed, never generated** (ADR-008, ADR-015). Division by zero returns null
   with an explanation, never Infinity. Every value inherits the confidence of its weakest
   input.
4. **The model may cite only an allow-list** (ADR-009). Built at runtime from what the project
   actually resolved, so it can never name a source the prompt did not carry.
5. **Revision creates; it never destroys** (ADR-007). `MRD_v1.docx` survives `MRD_v2.docx`. The
   version history is the evidence that gates were passed.
6. **`unvalidated` marks absent data and nothing else** (ADR-014). One meaning, or the badge is
   worthless.

## 7. What the build changed about the design

From the v2.0 cycle: the models named in the plan no longer exist; the quota is a token budget,
not a request budget; one model must write all three documents; the market queried was the world
aggregate rather than the founder's; two bugs survived every automated test and died in a
browser.

New in v3.0:

- **Customer lifetime should never have been asked.** v2.0 concluded it had to be because no
  vertical published a churn figure. That was true of app verticals, and the seed project is not
  one. Deriving it per business model gives a B2B licence 22 months from published logo churn
  instead of 1.05 from app retention.
- **A metric with no definition is worse than a missing one.** `store_conversion_pct` was null
  in all sixteen verticals with no `description` anywhere. The industry uses "store conversion"
  for page-view to install (~25%); the funnel needs install to paying customer (~1–3%). Sourcing
  the wrong one would have overstated paying customers by roughly 25×.
- **ARPU was measuring the wrong denominator.** Net revenue ÷ reachable market is revenue per
  person who might one day buy, and is not comparable to the ARPU benchmarks it was measured
  against.
- **The prompt is a budgeted resource.** One 320-character caveat propagated into eight derived
  figures — 2,500 characters of the same sentence — and pushed every call past Groq's ceiling,
  so all three documents silently came from the fallback provider. Now guarded by a test.
- **A range field that could never save.** The autosave dedupe compared `String(next)`, and
  `String({min,max})` is `"[object Object]"` on both sides, so every band the user typed was
  judged unchanged and dropped. Invisible to 256 tests; found by using the app.
- **Two chart bugs no unit test would catch.** The y-axis title rendered mirrored and reversed,
  and tick values read $1.9K / $5.6K because rounding the peak rarely divides nicely by four.

## 8. Verification

- `npm test` — 260 unit tests: gate invariant, formulas, derivation, benchmark resolution, source
  parsers, fallback ladder, prompt token budget. Offline, no database.
- `npm run probe:sources` — all 12 approved sources, live; exits non-zero if a keyless one fails.
- `npm run checkpoint:day2` — the gate over HTTP, including every refusal path.
- `npm run checkpoint:day3` — the numbers, against the real benchmark files.
- `npm run checkpoint:day4` — three `.docx` files, unzipped and inspected.
- `npm run checkpoint:day5` — the whole journey through the Vite proxy.
- `npm run test:ui` — the journey in a real browser.
- `npm run rehearse` — Demo Day's exact sequence, talking points checked against the data.
- `npm run validate:data` — the benchmark honesty contract: a placeholder may never carry a
  number.

Known debt: `checkpoint:day3/4/5`, `rehearse` and `qa-api-probe` still reference the three
retired question ids and fail. This is the largest outstanding item from the v3.0 cycle.

## 9. The demo

Start from the example project, type 5 answers across 4 phases approving each, generate, open
the Business Plan, then revise one answer, regenerate, and show v2 beside v1.

What the example project computes:

```
TAM   434 venues          [OpenStreetMap; Wikidata says 57 — the range is reported]
SAM   434 venues
SOM   11.79 venues at month 12
Ceiling  $195,300/month   — the whole market, at the founder's price
Net revenue  $5,306/month · ARR $63,676 · Profit −$1,194/month
CAC $1,200 · LTV $10,000 · LTV:CAC 8.33 · Payback 2.67 months
```

And the verdict:

> Do not proceed — the objective is larger than the market. You are aiming at $270,000 a month.
> Winning the entire market — every business in it, none of them ever lost — produces $195,300 a
> month at the price you set. This goal is not ambitious, it is arithmetically out of reach, and
> no forecast was needed to establish that.

The $270,000 figure is exactly what the retired questions implied (1.2M reachable × 0.05% ×
$450). The old app would have printed it as a finding; the new one proves it impossible using
two keyless sources and no benchmark at all.

Preparation: run `npm run db:seed` so the cached responses are loaded, and pre-generate v1
during setup so only one generation runs live.

## 10. Limitations

- 43 of 194 metrics are sourced. The badge is rare now because the derivation needs fewer of
  them, not because the corpus grew.
- `install_to_paid_pct` is 0/16 — the one gap that blocks a consumer projection outright. No
  API exists at any price.
- The unvalidated marker depends on the model's cooperation. Loosening the contract cost the
  prompt-injection probe's `GRD-MARKER-SURVIVES` check. The fix — deriving the marker from the
  data — is specified in ADR-014 and not built. Most important outstanding item.
- Benchmark selection ignores the business model. A B2B project in a consumer category still
  pulls consumer CPI into the prompt, unused.
- The competitor search is noisy. Searching "Google Maps, Waze" returns same-publisher apps, so
  competitor-derived features cite Google Chrome and Google Earth.
- Platform share has no source. StatCounter publishes a CSV, not an API, so SAM is not narrowed
  by platform — and says so.
- Local only (ADR-002). One user, no roles.
- The guardrail constrains what the model may cite, not how well it writes.

## 11. Repository map

```
biz2code/
├── INSTALL.md       clean machine → running app
├── start-biz2code.bat / .sh    one-click launcher
├── data/            question-bank.json · seed-project.json · benchmarks/
├── server/          routes → controllers → services → data
│   ├── services/    gate · derivation · calculation · benchmark · sources · chart
│   │                llm · generation · docx · external
│   ├── prompts/     document templates · context builder · figures · budget test
│   └── scripts/     migrate · seed · checkpoints · rehearse · probe-sources
├── client/          pages · components · hooks · context · lib · tests/
└── docs/            ARCHITECTURE.md · WORK_PLAN.md · DATA_SOURCE_OPTIONS.md
                     GATED_SPECIFICATION_METHOD.md · adr/ (16) · qa/
```

Companion documents in `Other/`: Design System v3.0, Flowchart Spec v3.0, Business Suite
Template v3.0, Coach Instructions, How We Work.
