# biz2code Flowchart Spec v3.0

## 1. Source of truth

The JSON is generated, not authored. Phase names, descriptions, question counts and types come
from `data/question-bank.json`; the gate states, derivation chain, generation order and model
policy are transcribed from `server/services/`.

## 2. Views

- `system` (HTML §1) — the four phases, their gates, and the revise loop
- `gate` (HTML §2) — the five phase states and six transitions
- `derivation` (HTML §3) — TAM → SAM → SOM → projection → verdict, branching on business model
- `generation` (HTML §4) — MRD → PRD → Business Plan, model policy, versioning
- `guardrail` (HTML §5) — the citable source set and the badge
- `calculation` (JSON only) — 12 formulas, 3 comparisons, 5 confidence tiers

The calculation view stays data-only: twelve formulas as boxes communicate less than the
formulas themselves.

## 3. The derivation chain

New in v3.0. The only place a reader can see that the founder's objective and the derived
market are produced independently and then compared.

```
  ANSWERS ─────────────────────────────┐
  (objectives and decisions only)      │
                                       │
  ┌──── consumer_installs ─────┐   ┌────┴──── b2b_licence ─────┐
  │ TAM  population × internet │   │ TAM  count of venues      │
  │      [World Bank]          │   │      [Overpass, Wikidata] │
  │ SAM  × segment × platform  │   │ SAM  = TAM                │
  │ reach  budget ÷ CPI        │   │ reach  budget ÷ B2B CAC   │
  │ convert  × install-to-paid │   │ convert  none             │
  └────────────┬───────────────┘   └────────────┬──────────────┘
               └──────────────┬─────────────────┘
                              ▼
              SOM — cohorts accumulate, decaying at the category churn rate
                              ▼
              projection, month by month → derived revenue at the horizon
                              │
      ┌───────────────────────┼───────────────────────┐
      ▼                       ▼                       ▼
  market ceiling      revenue verdict          adoption verdict
  (needs NO             (against the band:      (against the
   benchmark)            floor and target)       adoption target)
      └───────────────────────┼───────────────────────┘
                              ▼
                      OVERALL VERDICT
        proceed · revise the objective · do not proceed
```

Two properties the diagram exists to show:

The objective never feeds the projection. The arrow from ANSWERS carries decisions — price,
budget, model — never the goals. A goal that fed the forecast would produce a forecast that
agrees with it.

The ceiling bypasses the chain. It needs only market size and price, so it can render a verdict
when every benchmark in the category is missing. On the seed project it refuses a $270,000
target against a $195,300 ceiling with no forecast at all.

## 4. Invariants

From `gate.service.ts` and `derivation.service.ts`.

The gate, unchanged from v2.0:

1. A phase reaches `approved` only when every required question in it has an answer.
2. `current_phase` means the furthest phase unlocked, not the phase on screen.
3. Approve requires `phaseNo <= current_phase` and every earlier phase approved.
4. Revise reopens one phase and never rewinds `current_phase`.
5. `gate.service.ts` is the only module permitted to write `phases.status` or
   `projects.current_phase`.

The derivation, new in v3.0:

6. An objective is never an input to a projection, only ever compared against one.
7. A step whose source is missing stops the chain below it and is never bridged by an
   assumption.
8. Population segments and platform share narrow people; they are never applied to a count of
   premises.
9. A budget-derived SOM larger than the SAM is reported as market-bound, never silently
   clamped.

Without invariant 4, a project that reached phase 4 and reopened phase 2 could never complete.

## 5. Deferred layers

What became of each v1.0 deferred layer:

- Financial model as a separate deliverable — folded into the Business Plan: 12 formulas plus the
  derivation.
- SAD (Software Architecture Document) — cut. The 16 ADRs carry the architectural record.
- `Handoff.md` — cut. The provenance ledger inside each document does its job.
- Phases 5–7, build, deploy and operate — cut. biz2code stops at the specification.
- Feedback loop at a gate — scaffolded, disabled behind `LLM_FEEDBACK_ENABLED` (ADR-011).
- Charts in the documents — built in v3.0: a PNG bar chart drawn from scratch (ADR-015).

## 6. Regenerating

A Node script reads the question bank directly, so counts cannot drift from the application:

```js
const bank = require('./data/question-bank.json');
phases: bank.phases.map(p => ({
  id: p.phaseId, order: p.order, name: p.name,
  questions: bank.questions.filter(q => q.phaseId === p.phaseId).length,
  required:  bank.questions.filter(q => q.phaseId === p.phaseId && q.required).length,
  types:     [...new Set(bank.questions.filter(q => q.phaseId === p.phaseId).map(q => q.type))],
}))
```

The derivation view also reads `bank.derivationLayer`, where the chain and the segment → World
Bank indicator mapping live.

The HTML is standalone: no build step, no CDN, no fetched fonts. It opens from the filesystem,
prints, and can be screenshotted. The diagram is dark because cyan carries text at 6.95:1 on
the dark background and fails on white.

## 7. What it deliberately leaves out

- The database schema. `001_init.sql` and its two migrations state it more precisely.
- The React component tree. It changes faster than the diagram is regenerated.
- HTTP routes. They're in `ARCHITECTURE.md`, with their auth requirements.
- The twelve sources individually. The guardrail view shows the rule, not the catalogue; the
  catalogue is `DATA_SOURCES.md` and it changes.
