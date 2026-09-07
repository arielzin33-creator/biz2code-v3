# biz2code — System Architecture

Version 3.0.

One frontend, one backend, one structure. This describes what is in the repository.

What v3.0 changed: the user is no longer asked to estimate his own market. Three questions
that requested measurements he could not have are retired, a derivation layer produces the market
from published sources, and the two are compared to yield a verdict — proceed, revise the
objective, or do not proceed. See ADR-012 through ADR-016.

## 1. Constraints that shaped every decision

- One week, one developer, so a monolith with no containers and no CI/CD (ADR-001, ADR-002).
- React and TypeScript being used during the build, so the fewest new tools possible and raw
  SQL over an ORM (ADR-004).
- Local-only, DOCX downloaded to disk, so no cloud storage and no public URL (ADR-002).
- Single user, no roles, so no tenant isolation surface (ADR-005).
- The thesis that LLMs cannot infer what analysis an idea needs, so fixed questions and
  guardrailed citation (ADR-003, ADR-009).
- Graded on both the app and its documents, so output quality is a first-class requirement.

## 2. System context

┌─────────────┐   REST/JSON    ┌──────────────────────────┐      ┌────────────┐
│  React SPA  │ ─────────────▶ │   Express API (TS)       │ ───▶ │ PostgreSQL │
│ (Vite, TS)  │ ◀───────────── │                          │      └────────────┘
└─────────────┘   httpOnly     │  ├ gate state machine    │
                  JWT cookie   │  ├ derivation layer      │      ┌────────────┐
                               │  ├ calculation layer     │ ───▶ │ ./outputs  │
                               │  ├ generation pipeline   │      │  *.docx    │
                               │  └ provenance ledger     │      └────────────┘
                               └───────┬──────────────────┘
                                       │ server-side only, all cached
      ┌──────────────┬─────────────────┼─────────────────┬──────────────┐
      ▼              ▼                 ▼                 ▼              ▼
  Groq (LLM)    World Bank        Overpass /         Eurostat /     Crossref /
  Gemini f/b    iTunes Search      Wikidata          OECD / UNSD    data.gov.il
                                (premises counts)                   Google Books

Everything external is server-side. The browser never holds an API key, and iTunes sends no CORS
headers, so a browser call would fail regardless.

Twelve approved sources, ten keyless and two needing a free key. Every one caches through
`external_cache`, whose `CHECK` constraint is ADR-009's allow-list expressed in schema: a source
that is not approved cannot be cached, and so cannot reach a document. Widening the list is a
migration. `npm run probe:sources` calls all twelve live and exits non-zero if a keyless one
fails.

## 3. Request flow — the gate

answer question ──▶ POST /api/projects/:id/answers
                          │
                          ▼
                   validate against question-bank.json
                          │
                          ▼
                   UPSERT answers  (unique on project_id+question_id)
                          │
                          ▼
              all required questions in phase answered?
                    │ no                        │ yes
                    ▼                           ▼
            phase: in_progress          phase: awaiting_approval
                                                │
                          ┌─────────────────────┴──────────────┐
                          ▼ approve                            ▼ revise
              phase: approved, approved_at=now()      phase: revising
              current_phase += 1 (if < 4)             (edit individual answers)
                          │
                          ▼
              phase 4 approved ──▶ generation pipeline

The gate is one invariant: `current_phase` may only advance when the current phase is `approved`,
and a phase may only reach `approved` when every required question has an answer. Everything else
is UI around that rule.

## 4. The derivation layer

New in v3.0, and the reason the rest of the pipeline changed. The founder states goals; this
works out what the sources support; the two are compared. An objective is never an input to a
projection. A test asserts it: two runs differing only in the stated objective produce identical
projections.

The chain branches on the business model (`p4q1`), because a product sold to premises does not
address a population (ADR-013):

text
                     CONSUMER                          B2B LICENCE
  TAM        population x internet %          count of tagged venues
             [World Bank]                     [Overpass + Wikidata, reported as a range]
                     │                                     │
  SAM        x segment share x platform       (unchanged — segments narrow
             [World Bank, StatCounter]         people, not buildings)
                     │                                     │
  reach      budget ÷ cost-per-install        budget ÷ cost per customer won
                     │                                     │
  convert    x install-to-paid rate           (none — a signed venue already pays)
                     │                                     │
  SOM        cohorts accumulate, decaying at the category churn rate
                     │
  revenue    x price x (1 − commission)   ── commission is 0 for a direct sale

One figure needs no benchmark at all: the market ceiling, the whole market at the founder's
price. That is what lets the app return a verdict in a category with no data — on the seed
project it refuses a $270,000 target against a $195,300 ceiling without a forecast.

Where a chain stops, it stops. A missing source returns unvalidated with a reason and nothing
below it is bridged by an assumption.

## 5. Generation pipeline

Runs once, after phase 4 is approved. Order matters (ADR-010).

collect answers ──▶ fetch APIs (cached) ──▶ DERIVATION ──▶ calculation layer
                                                 │                │
                            ┌────────────────────┴────────────────┘
                            ▼
                    build guardrailed context
                    { answers, computed, derivation, benchmarks,
                      apiData, allowedCitations }
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
           MRD  ────────▶ PRD ────────▶ Business Plan
          (v1)           (v1)          (needs MRD+PRD for
                                        product_weaknesses)
              │             │             │
              └─────────────┴─────────────┘
                            ▼
      prepend Key Figures (tables + chart, rendered in code, never by the model)
                            ▼
              render DOCX ──▶ ./outputs/{project}/MRD_v1.docx
                            ▶ store row in deliverables (+ provenance, unvalidated)

The derivation runs before the economics, because paying customers, customer lifetime and
cost-per-customer used to come from answers and now come from the projection.

**One model writes all three.** A set read side by side must be in one voice, so a model is
pinned for the whole run. If it cannot deliver every document, the whole set is redrafted on the
next model — escalating `gpt-oss-120b` → `gpt-oss-20b` → `gemini-3.5-flash-lite` (ADR-010).

**Timing.** 120–200 s for a cold run. Little of that is the model thinking; the rest is Groq's
8,000-token-per-minute bucket refilling at ~133/s, because one model carries the whole set.

**The prompt is a budgeted resource.** Groq weighs requested output against the same per-minute
ceiling, so an oversized `max_tokens` is rejected with 413 before a token is generated, and the
only symptom is that every document quietly arrives from the fallback provider.
`prompts/budget.test.ts` fails if any template's prompt plus `max_tokens` exceeds 7,900. Current
costs: MRD 7,221, PRD 7,728, Business Plan 7,880 (ADR-016).

**Key Figures and the chart are not generated.** Six Word tables and a PNG bar chart are built in
code from the same figures the prompt carries, so the summary cannot disagree with the arithmetic
it summarises. The chart is drawn from scratch — an RGBA buffer, a 5x7 bitmap font, a PNG encoder
over `node:zlib` — because every charting library needs a native canvas or a headless browser
(ADR-015).

**Which market.** The World Bank country and the App Store storefront both come from `p2q2`,
resolved against the World Bank's own country list. The App Store is searched for the competitors
named in `p2q4`, one search per named product. An unresolvable country falls back to the world
aggregate and says so in the prompt.

**Failure handling.** If the LLM returns malformed JSON for a section, that section is marked
`unavailable — malformed model output` and the rest of the document still renders. A failed API
call falls through to the cache, then to the benchmarks file; a missing benchmark renders
unvalidated. Nothing aborts the pipeline.

**What `unvalidated` means.** A figure was stated for which no source was supplied. Not a section
that is short, that is a judgement clearly labelled as one, or that correctly reports a gap; and
a summary does not inherit its inputs' markers. One field of twenty-four carries it on a full
run: `prd.rice` (ADR-014).

## 6. Backend structure

Routes → controllers → services → data. Each layer may call the one below it and never the one
above.

server/
├── index.ts                    # bootstrap, listen
├── app.ts                      # express app, middleware chain
├── config/
│   ├── env.ts                  # typed env loading, fails fast on missing keys
│   └── constants.ts
├── middleware/
│   ├── auth.ts                 # verifies JWT from httpOnly cookie
│   ├── validate.ts             # request-body validation
│   └── error.ts                # single error handler, last in chain
├── routes/                     # HTTP shape only — no logic
├── controllers/                # parse request → call service → shape response
├── services/                   # all business logic lives here
│   ├── gate.service.ts              # the state machine
│   ├── derivation.service.ts        # TAM/SAM/SOM, projection, verdict (ADR-012/013)
│   ├── derivationInputs.service.ts  # fetches what derive() needs; keeps derive() pure
│   ├── calculation.service.ts       # deterministic formulas
│   ├── generation.service.ts        # orchestrates MRD → PRD → BP
│   ├── llm.service.ts               # Groq client, JSON mode, retry, Gemini fallback
│   ├── benchmark.service.ts         # loads and resolves benchmarks/*.json
│   ├── sources.service.ts           # the Tier-2 clients and the source registry (ADR-009)
│   ├── external.service.ts          # World Bank + iTunes, with DB cache
│   ├── chart.service.ts             # PNG bar chart, zero dependencies (ADR-015)
│   └── docx.service.ts              # renders sections → .docx
├── prompts/
│   ├── figures.ts              # Key Figures tables, built in code (ADR-015)
│   └── budget.test.ts          # fails if a prompt exceeds the token ceiling (ADR-016)
├── db/
│   ├── pool.ts                 # pg Pool
│   ├── query.ts                # ~30-line typed wrapper (ADR-004)
│   └── migrations/001_init.sql
├── data/                       # authored content, validated in CI (ADR-006)
└── types/

Dependency rule: never upward, never sideways between services except through explicit imports.
`gate.service` is the only module permitted to mutate `phases.status` or `projects.current_phase`.

## 7. Frontend

src/
├── main.tsx                    # providers: QueryClient → Auth → Router
├── App.tsx                     # routes + ProtectedRoute
├── pages/
│   ├── LoginPage.tsx
│   ├── ProjectsPage.tsx        # list, New project, demo reset
│   ├── PhasePage.tsx           # the gate UI
│   └── DocumentsPage.tsx       # generated docs + download
├── components/
│   ├── QuestionField.tsx       # text, select, multiselect, number
│   ├── PhaseStepper.tsx
│   ├── ApprovalGate.tsx
│   └── UnvalidatedBadge.tsx    # renders the guardrail visibly
├── hooks/                      # React Query wrappers, one per resource
│   ├── useProject.ts           # also owns the query-key registry
│   ├── usePhase.ts             # the two gate mutations
│   ├── useAnswers.ts
│   └── useDocuments.ts
├── lib/
│   ├── api.ts                  # fetch client, credentials: 'include'
│   └── types.ts                # hand-mirrored API response shapes
└── context/AuthContext.tsx

React Query owns server state; Context owns auth, the only genuine client state; `useState` owns
whatever a single component is doing. No Redux — a store would be ceremony over one value.

The query-key registry lives in `hooks/useProject.ts` and every other hook imports it.
Invalidation after a mutation is what refreshes the stepper and the gate, so the keys have to
agree; building them inline would make a typo a silent cache miss rather than a compile error.

`client/tests/journey.spec.ts` drives the whole flow in a real browser. Two bugs reached it that
nothing else caught: a redirect that bounced the user back to the phase they had just approved,
and a stepper that wrapped into two rows.

## 8. Cross-cutting

**Provenance ledger.** Every generated field records where it came from: which answers, which
benchmark entries (with confidence tier), which API responses. This populates the Data Sources
field all three documents require.

**Unvalidated rendering.** A field whose inputs include a placeholder benchmark, a failed API
call, or malformed model output renders unvalidated with a reason. 43 of 194 vertical benchmark
metrics are currently sourced.

**Conflict surfacing.** Where published sources disagree (fintech D30 retention 2%–12%, social
5%–22%), the document reports the disagreement and its sources rather than silently choosing one.

**Caching.** World Bank and iTunes responses are cached in `external_cache`, and `npm run db:seed`
pre-loads what the example project needs. Verified offline: with network access to both hosts
blocked mid-generation, all five external lookups were served from cache.

**Confidence tiers.** Five, weakest wins: `primary`, `secondary`, `tertiary`, `assumption`,
`placeholder`. `assumption` is the tier for a figure derived only from the founder's own answers
— without it, a guess multiplied by a guess would inherit `primary` and read as researched
(ADR-008).

**Testing.** Four layers, each proving something the others cannot. The unit tests (Vitest) cover
the gate invariant, the formulas, benchmark resolution and the model ladder, offline and with no
database. Four HTTP checkpoints (243 assertions) cover the same rules surviving routing, auth,
ownership and JSON. One browser journey (Playwright) covers the screen. `npm run rehearse` runs
Demo Day's sequence with the talking points checked against the data.

**Branding.** The app and the generated documents render onto opposite backgrounds, so they carry
different accents from the same brand: cyan-500 `#13A8E2` on the dark UI (6.95:1), navy-500
`#154F6B` on the white page (8.89:1). Each is unusable on the other surface. See
`Other/Design/biz2code Design System v3.0.md`.
