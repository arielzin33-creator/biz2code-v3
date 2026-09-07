# biz2code — Work Plan

One build week, then one revision cycle.

React and TypeScript were being learned during this build; every estimate carries that. If a day
slipped, the rule was to cut from Day 6, never Day 7.

Days 0–7 are the original plan with its outcomes, left as written. The revision cycle at the end
covers v3.0.

## Day 0 — before the clock starts (2–3 hrs)

- [V] Groq account and API key; free tier covers the build.
- [V] Largest model returning clean JSON in <30 s: `openai/gpt-oss-120b` (3/3, median 2.7 s).
      Fallback `openai/gpt-oss-20b` (3/3, 1.5 s); cross-provider fallback `gemini-3.5-flash-lite`
      (3/3, 3.3 s), the only free-tier Gemini inside budget. Re-verify with
      `node server/scripts/probe-models.mjs [--provider gemini]`; evidence in
      `docs/model-probe-results*.json`. Note: `llama-3.3-70b-versatile` no longer exists on Groq.
- [V] PostgreSQL 18.4 local, db `biz2code`, write access confirmed. Auth is `scram-sha-256`, so
      the URL needs `postgres:<password>@`; a bare host fails.
- [V] Vite scaffold running (workspaces: server + client), HTTP 200 on :5173.
- [V] `npm run validate:data`: 16 verticals, 0 errors, 6 warnings. The warnings are Day 3
      requirements — 2 verticals have conflicting published sources (fintech, social_media) and 4
      carry proxy metrics from an adjacent vertical. `benchmark.service` must surface both.

Front-loading environment setup protects Day 1; setup failures are the most common way a one-week
build loses a day.

## Day 1 — Backend foundation

Ships: register and login work in Postman; the DB has tables.

- [V] Express + TS bootstrap, env config, error middleware.
- [V] `001_init.sql` applied; `pool.ts` plus typed `query.ts`. The old script shelled out to
      `psql "$DATABASE_URL"`, which relies on the var being exported — it lives in `.env`.
      Replaced with `server/scripts/migrate.ts`: same config as the server, numbered files in
      order, one transaction each, tracked in `schema_migrations`.
- [V] `auth.service` — bcrypt, JWT, httpOnly cookie; `auth.routes` + controller.
- [V] Checkpoint: 19/19 assertions. Happy path, cookie flags, failure paths (409, 401, 400), and
      leak checks — login never reveals which field was wrong, no `password_hash` in any response.

## Day 2 — The gate

Ships: the whole state machine, working over HTTP.

- [V] `project.service`, question-bank loader and validator, `answer.service` upsert.
      Type validation lives in `answer.service.toColumns()`, not `middleware/validate.ts`, because
      seeding writes answers without passing through HTTP.
- [V] `gate.service` — the invariant. `current_phase` means the furthest phase unlocked, not the
      phase on screen. Approve requires `phaseNo <= current_phase` and every earlier phase
      approved, and advances with `GREATEST(current_phase, phaseNo + 1)`. The scaffold's
      `current_phase !== phaseNo` rule made a revised phase 2 un-approvable forever on a project
      that had reached phase 4 — the last step of the demo. Completeness is counted from the
      phases table, never inferred.
- [V] Routes nested under `/api/projects/:projectId/...` with `mergeParams`; each router owns its
      own `requireAuth` + `loadProject` chain, so a route added later cannot be left
      unauthenticated by omission. Someone else's project answers 404, never 403.
- [V] Vitest: 20/20, offline. `server/test/fakeDb.ts` throws on any SQL it does not recognise, so
      a query added to the gate fails loudly instead of returning no rows. Answers are built from
      the real question bank, not hard-coded ids.
- [V] Checkpoint `npm run checkpoint:day2` — 63/63 in-process over HTTP: four phases approved,
      every refusal path, revise then re-approve without rewinding, seed project, ownership
      isolation. It caught the completeness bug the unit suite missed.

## Day 3 — Numbers and sources

Ships: computed economics, benchmark resolution, live APIs.

- [V] `calculation.service` — 11 formulas, null on placeholder, no NaN or Infinity. Added a fifth
      confidence tier, `assumption`, between tertiary and placeholder: without it `paying_users`,
      a guess times a guess, would inherit `primary` and read as researched. Figures carry
      `usedBenchmark`, because the tier alone cannot say whether a benchmark contributed.
- [V] Vitest: 47 tests, guardrails before the happy path, including a sweep driving every formula
      with 0, -0 and ±1e308 to prove nothing returns a non-finite number.
- [V] `benchmark.service` — 25 tests. `resolve()` never returns null and never throws; a missing
      metric comes back shaped like a real one, so no caller can forget the absent case. The
      honesty contract from `validate_benchmarks.py` is re-enforced at boot in TypeScript, since a
      file edited on the demo laptop after the last CI run would otherwise reach the LLM
      unchecked. An unknown vertical does not fall back — a typo in `vertical_id` would otherwise
      draw global averages that read as researched.
- [V] `external.service` — World Bank + iTunes, `external_cache`, verified live; a simulated dead
      network falls back to the cache.
- [V] Checkpoint `npm run checkpoint:day3` — 54/54 against the real seed answers and benchmark
      files. It reproduces node-pg's NUMERIC-as-string behaviour rather than passing JS numbers.
- [V] Customer lifetime is asked, not derived — question `p4q6`, taking the bank from 20 to 21
      (ADR-003). D30 retention counts installs still opening the app while LTV is about customers
      still paying, and `churn_monthly_pct` and `ltv_usd` are sourced in zero of sixteen
      verticals. The founder now answers it (`assumption` tier), and
      `benchmark_implied_lifetime_months` is reported beside it as a divergence. Both the formula
      and the derivation live in `question-bank.json` → `calculationLayer`.

What the seed project computed at this point: 600 paying users, $270k/month gross, zero store
commission, $263.5k profit. At the founder's assumed 24-month lifetime, LTV $10,800 against CAC
$3,360 — LTV:CAC 3.21, clearing the sourced 1.5 floor. In the same result the app reports that
the category's published D30 retention implies about 1.0 months, 23× lower, and that the
benchmark measures a different population. Both benchmarks feeding the economics are proxies for
navigation_local, and the ARPU comparison is unavailable because the category has no sourced ARPU.

## Day 4 — Generation

Ships: three DOCX files on disk.

- [V] `llm.service` — a four-rung ladder: 120b, 120b again, 20b, Gemini. 413 and 429 skip the
      retry rung, since an identical request cannot fit a budget it just failed. Made budget-aware
      after the Business Plan hit 413 on both Groq models every run: the BP prompt is 4,780 tokens
      and a flat `max_tokens: 4000` took it to 8,780 against a hard 8,000 ceiling. Output size is
      now declared per document (2000/2400/3000). The budget is per model and refills at ~133
      tokens/s, so the ladder reads `x-ratelimit-remaining-tokens`, starts with whichever Groq
      model can afford the call, and waits up to 30 s for the bucket rather than dropping to a
      weaker model.
- [V] Prompt templates per document, with the allow-list built from what the project actually
      resolved — a benchmark with no sourced value contributes no citation. Returned JSON is flat
      (`budget_engineering`) and the nesting is restored at render time: small models drop nested
      objects far more often than flat keys, and a lost parent takes four fields down with it.
- [V] `generation.service` — MRD → PRD → Business Plan in ADR-010 order, the Business Plan
      receiving a digest of the first two rather than their raw JSON. The ledger records per
      field: which model wrote it, whether a fallback was used, and why it is unvalidated.
- [V] `docx.service` — an unvalidated field is rendered, never omitted: heading, shaded marker,
      reason. Version lives in the filename, so v1 and v2 coexist.
- [V] Malformed-output path: 25 unit tests against a mocked provider drive every rung and every
      kind of bad output — fences, truncation, a JSON array, an empty body, a missing key.
- [V] Checkpoint `npm run checkpoint:day4` — 60/60. It unzips each file rather than trusting its
      size: `[Content_Types].xml`, `word/document.xml`, `_rels/.rels`, a footer, every declared
      heading, and the UNVALIDATED marker readable inside the compressed part. Then it revises an
      answer, regenerates, and checks v2 exists beside v1.
- [V] One model writes the whole set. The first build let each document fall back independently,
      producing three documents in three voices. A model is now pinned for the run; if it cannot
      deliver all three, the whole set is redrafted on the next model. Order 120b → 20b → Gemini.

Timing: a cold run is 68.6 s, whole set on gpt-oss-120b, no fallback, 23/23 sections. Only ~10 s
is the model thinking; the rest is Groq's bucket refilling, because one model carries all ~18,200
tokens. Consecutive runs are ~99 s because a drained bucket makes the pinned model fail and the
set escalates — pre-generating v1 (Day 6) leaves exactly one live run on a cold bucket.

What the generated Business Plan says, unprompted, from the seed:

> Retention is based on a proxy 30-day figure from a different app band, making the assumed
> 24-month customer lifetime highly optimistic. Profitability depends on these unvalidated
> assumptions; if uptake or retention falls short, the financial outlook deteriorates.

It cites the sourced 1.5 viability floor and never the unsourced 3:1 target.

## Day 5 — Frontend

Ships: the app is usable in a browser.

- [V] Vite, router, React Query, AuthContext. `AuthContext` carries a `restoring` flag so a reload
      does not flash the login page at a signed-in user, and React Query does not retry a 401 or
      404 — both are settled answers.
- [V] Login and Projects, with New project and Start from the example project, which creates a
      fresh seed copy every time so a rehearsal never leaves the live run half-answered.
- [V] PhasePage. `QuestionField` autosaves on blur, not on change: every save makes the gate
      recompute completeness, so per-keystroke saves would be dozens of requests and a flickering
      stepper. Selects commit on change. `ApprovalGate` names the unanswered questions rather than
      counting them. `canApprove` comes from the server; the UI displays the invariant and never
      re-decides it, with no optimistic update.
- [V] DocumentsPage — list, download, `UnvalidatedBadge` in three kinds: unvalidated, proxy, and
      sources disagree. Flattening them would discard the distinction the benchmark layer works to
      preserve. Versions are grouped newest-first so v1 is visibly still there.
- [V] Checkpoint `npm run checkpoint:day5` — 59/59. It starts the API and Vite, then drives the
      journey through the proxy on :5173 as a browser does; hitting the API directly would skip
      the proxy and the same-site cookie. It also asserts every key `client/src/lib/types.ts`
      declares is present in the response, which catches drift a typecheck cannot.

Playwright drove the journey and screenshotted every screen, finding two bugs no unit test would:

1. Approving phase 1 bounced the user back to phase 1. The unlocked-phase redirect read
   `current_phase` from a cache that had not refetched, so for one render the just-unlocked phase
   still looked locked. Fixed by holding the redirect while the project query is fetching.
2. The stepper wrapped 3-then-1, reading as two groups. All four now share the row evenly.

## Day 6 — Harden

- [V] Remaining unit tests: 154 (31 new), covering `answer.service.toColumns` — the last line
      before the calculation layer — and `competitorTerms`, whose output becomes cache keys.
- [V] Loading and error states: the button says ~70 s before it is pressed, and an indeterminate
      bar runs while it works.
- [V] `npm run db:seed` was a stub that only printed. It now loads the seed's cached API responses
      into `external_cache`; generation with the network cut serves all five external lookups from
      cache, verified by blocking `fetch` for both API hosts mid-run.

What Day 6 surfaced:

1. **Generation queried the world aggregate for every project.** The bank asks which market you
   are launching in (`p2q2`) and the seed answers Israel, but the code queried `WLD`. Now resolved
   against the World Bank's own country list, with the iTunes storefront following the same
   answer. Unresolvable answers fall back to the aggregate and say so in the prompt.
2. **The App Store was searched for the wrong thing.** `p2q4`'s help text promises the named
   alternatives are queried against the App Store, but the search term was p1q1's product
   description, so the promise was never kept and the pre-cached seed entry could never match. A
   shared pure parser now derives the terms and `fetch-seed-data.ts` imports the same one.
3. **The seeded iTunes payload was the wrong shape.** The seed file stored the API envelope
   `{resultCount, results}`; `external.service` caches the bare array its callers read.

Pre-generate v1 before the demo starts — arithmetic, not polish. Three documents cost ~18,000
tokens; two Groq models supply 16,000 instantaneous, so the third document is always short by
~3,400 on a cold run. Measured: back-to-back runs are 13.6 s then 31.1 s, with the Business Plan
dropping to Gemini both times. The demo's script generates twice, so it triggers this on stage.

- [V] Full dress rehearsal, `npm run rehearse` — runs Demo Day's exact sequence, prints what a
      grader will see, checks the talking points against the data, and exits non-zero if one no
      longer holds. `REHEARSE_DRY=1` skips generation. Last run clean: 74.5 s, both versions
      written by `gpt-oss-120b`, 9 fields unvalidated, v1 intact after v2. Say the 24-month
      lifetime out loud on stage — the LTV:CAC verdict depends on that answer.

Known deviation, carried deliberately: **revise regenerates all three documents.**
`question-bank.json` says editing an individual answer re-runs generation for the affected fields
only, and every question carries a `feeds` array, so the mechanism exists. Pre-generating v1
removes the pressure that would justify the complexity, and partial regeneration is subtle —
revising `p2q3` feeds `calc.som_input`, which moves every economic figure and therefore the
Business Plan too, so it would save the PRD and nothing else.

## Day 7 — Buffer

Do not plan work here. If Day 7 is genuinely free: record the 2:30 video, build the slides, write
the Medium article.

## What "done" looks like

Every item verified by a re-runnable command, not by inspection.

- [V] Login, create a project, answer 4 phases, approve each gate — `checkpoint:day5` 59/59, and
      the same journey in a real browser (`test:ui`, 10 pass).
- [V] Revise, regenerate, v2 alongside v1 — `checkpoint:day4` 60/60; `qa:generation` proves the
      three v1 files are byte-identical after v2 is written.
- [V] Three DOCX files download and open — each unzipped and inspected. Not yet opened by a human
      in Word.
- [V] `unvalidated` appears where data is missing, visibly — present inside the compressed `.docx`
      part, not merely in the API response; survived a live instruction to remove it.
- [V] Numbers reproducible across runs — asserted in the calculation suite and `checkpoint:day3`.
- [V] Unit tests pass — 260/260 at v3.0 (165 at v1.0), offline, no database.
- [V] Repo has branches and comments — 13 branches, 28 commits, every merge `--no-ff`; 74 of 74
      source files carry a header comment, zero TODOs.

Quality gates added after the build: `npm run lint` (0 errors), a CI workflow running typecheck,
lint, tests, data contract, build, migrations and two QA probes, and a full QA assessment — 141
checks, 13 defects, 11 fixed, verdict GO (`docs/qa/QA-Assessment-2026-08-22.md`).

## Revision cycle — v3.0

The build shipped a working gate and pipeline. Running it revealed the questions were wrong, and
everything downstream inherited it: three questions asked the founder for measurements he could
not have, `paying_users` was a guess times a guess, and the documents narrated his own assumptions
back at him.

Done, and how each was verified:

- [V] Retire the three estimate questions, ask objectives only — the 24-question bank loads and
      gates.
- [V] Revenue as a band, a new `range` type across server, client and validation — the API
      rejects an inverted band, a non-object and a non-numeric bound.
- [V] Derivation layer: TAM/SAM/SOM, projection, dual verdicts, back-solved levers — 60 tests,
      including "an objective never influences its own projection".
- [V] Two market models, consumer installs and B2B licence — 21 of those 60 tests.
- [V] Widen the approved sources from 2 to 12 — `probe:sources` calls all twelve live.
- [V] Premises counts for B2B sizing, Overpass plus Wikidata — 434 and 57 for Israel, reported as
      a range.
- [V] `unvalidated` means absent data and nothing else — 17 of 23 fields down to 1 of 24.
- [V] Key Figures as six Word tables built in code — 6 tables per document.
- [V] Projection chart, a PNG bar chart with zero dependencies — 1 embedded image per document.
- [V] ARR added, and ARPU corrected to per paying customer — calculation suite.
- [V] Feature list with future and competitor-observed features — PRD section, each entry
      traceable to a named app.
- [V] Prompt token budget guarded — `budget.test.ts` fails above 7,900.


