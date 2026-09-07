# QA Assessment — 2026-08-24

Full sweep, automated and manual-in-browser, run against a dedicated `biz2code_qa`
database so the live `biz2code` data (27 users, 36 projects, 57 deliverables) was
never written to. Verified unchanged at the end of the run.

Both LLM providers were live for this sweep: Groq (`openai/gpt-oss-120b`,
`openai/gpt-oss-20b`) and Gemini (`gemini-3.5-flash-lite`).

## Result summary

| Suite | Result |
|---|---|
| `npm run typecheck` (server + both client projects) | exit 0 |
| `npm test` (vitest) | **260 / 260** |
| `npm run build` | exit 0 |
| `npm run lint` | 0 errors · 29 warnings |
| `validate_benchmarks.py` | 0 errors · 6 warnings |
| `npm run qa:api` | 77 probes · **75 as expected** · 2 TLS-only |
| `npm run qa:resilience` | **17 / 17 clean** · 0 findings |
| `npm run qa:generation` | 26 checks · **25 clean** · 1 finding |
| `npm run test:ui` (Playwright) | **23 / 23 passed** |
| `npm run probe:sources` | 8 reachable · 1 failed · 2 skipped |
| `npm audit` | 1 critical · 1 high · 3 moderate — all dev-toolchain |

The two `qa:api` deviations are `SEC-COOKIE-SECURE` and
`SEC-HDR-strict-transport-security`, both of which the probe itself annotates as
expected on plain-HTTP localhost. Under TLS they would be required.

## Defects found and fixed

### 1. Invalid `ignoreDeprecations` broke typecheck and build — `client/tsconfig.json`

`"ignoreDeprecations": "6.0"` is not a valid value on the installed TypeScript
(5.9.3, resolved from `^5.7.2`). Both `npm run typecheck` and `npm run build`
failed with `TS5103`, and the error propagated into `tsconfig.node.json` through
`extends`. Removed; nothing in the config is actually deprecated.

### 2. Dangling `<label for>` on grouped questions — `client/src/components/QuestionField.tsx`

**This was the only defect in application code.** The component rendered
`<label htmlFor={id}>` for every question type, but only assigned that `id` to
`text`, `select` and `number` inputs. For `multiselect` and `range` the label
pointed at an element that does not exist, so clicking the question text did
nothing and the control group had no accessible name.

Affected five questions: `p1q4`, `p2q6`, `p3q4`, `p4q5` (multiselect) and `p4q8`
(range). Fixed by dropping `htmlFor` for group types and giving those containers
`role="group"` with `aria-labelledby` pointing back at the label.

### 3. Probes referenced a question deleted by ADR-012 — `server/scripts/qa-api-probe.ts`, `client/tests/extended-qa.spec.ts`

`API-044`, `API-045` and `QA-09` all drove `p2q3`, a numeric market-size question
that no longer exists — ADR-012 moved the market from something the founder
states to something the app derives, and the bank's own `noMarketEstimatesAsked`
rule now forbids asking. The API was answering `404` correctly; the fixtures were
stale. Repointed at `p4q2` (number, `max` 100000) and `p2q2` (the phase-2 market
question) respectively.

Note this means request-body validation for numbers had been passing vacuously —
both probes 404'd before reaching the validator. It is now genuinely exercised.

### 4. Hardcoded provenance counts had rotted — `server/scripts/qa-generation-probe.ts`

`PROV-COMPLETE` asserted `answersUsed.length === 21` and `fields.length === 23`.
The bank has since grown to 23 questions and the document specs to 25 sections,
so the ledger was complete and the assertion was wrong. Both counts are now
derived from the question bank and the rendered section count.

### 5. Browser tests asserted a heading that was never rendered — both specs

`getByRole('heading', { name: 'biz2code' })` could never match: the brand is an
`<img alt="biz2code">` and the page's only `<h1>` is "Sign in". Repointed.

### 6. Test helper could not drive half the demo set — both specs

`answerDemoQuestions` handled only `valueText` and `valueNumber`, and threw for
anything else. Two of the five demo questions are `p2q6` (multiselect) and `p4q8`
(range), so the journey could never clear phase 2 or phase 4. Added multiselect
and range branches. The `SeedFile` interface also typed `valueJson` as
`string[] | null`, which does not describe `p4q8`'s `{min, max}`.

### 7. Live generation outran the per-test timeout — both specs

Generation measures 126–160s. `playwright.config.ts` sets a 150s per-test budget,
so the test was torn down mid-run and reported the misleading
"Target page, context or browser has been closed". Raising the *expect* timeout
had no effect because the *test* timeout fired first. Both generation tests now
call `test.setTimeout(300_000)`.

## Open items — not fixed

**`GRD-MARKER-SURVIVES` is a test-design false positive.** It asserts
`unvalidated.length > 0` after instructing the model to strip the marker. But
`unvalidated` is computed deterministically in `benchmark.service.ts:124`
(`metric.value === null || metric.confidence === 'placeholder'`), so the model
cannot influence it — per ADR-008 and ADR-015. A run where every metric sources
cleanly yields 0 and fails the check for a reason unrelated to the guardrail.
Deliberately left alone: weakening a security assertion should be a considered
decision, not a side effect of a QA pass. The right fix is to make the fixture
guarantee at least one unsourceable field, or to report "n/a" when there is
nothing to assert.

**The documents page understates generation time.** The UI says "Takes about 70
seconds"; measured runs took 126–160s, and one browser run used the
`openai/gpt-oss-20b` fallback. Worth correcting the copy or the expectation.

**`npm audit`: 1 critical, 1 high, 3 moderate — all dev-toolchain**
(`vitest → @vitest/mocker → vite → esbuild`), none in production runtime deps.
The client's own Vite is 6.4.3 and the path-traversal advisory covers `<= 6.4.2`,
so the dev server actually run is patched; the vulnerable copies are nested under
`vitest`. Remediation requires `vitest@4`, a breaking upgrade.

**CI does not set `GEMINI_API_KEY`.** Three `llm.service` fallback tests fail
without it, so `.github/workflows/verify.yml` is likely red for an environmental
reason rather than a code one. One line in the `env:` block fixes it.

**External sources: 1 failing, 2 unconfigured.** `googlebooks` returns no data;
`restcountries` and `openexchangerates` are skipped for want of a key. Per
ADR-014 this is not a malfunction — anything that cannot be sourced renders
`unvalidated` rather than being fabricated. Adding the keys widens citation
coverage.

## Manual browser verification

Walked the full journey in Chromium at 1440×900 and 390×844.

- Route guards hold: `/projects`, `/projects/:id/phase/:n` and `/documents` all
  redirect to `/login` when unauthenticated.
- Form semantics are correct — `type=email` / `type=password`, `required`,
  `autocomplete`, labels bound by `for`/`id`, one `<h1>`, `lang="en"`, `alt` text.
- Mobile at 390px reports `scrollWidth` 390: no horizontal overflow.
- With the API stopped, the error surfaces in the UI with zero uncaught page
  errors — it degrades rather than crashes.
- Phase 4 renders the economics cards, multiselect chips and the range
  floor/target pair correctly after the `QuestionField` change.
- Generated documents page shows all three DOCX downloads, names the writing
  model, and renders the `UNVALIDATED` badge on `prd.feature_roadmap` with the
  honest reason "The model returned no content for this field" — ADR-014 holding
  in the rendered product, not just in the API response.

---

# Follow-up — 2026-08-25

Four of the five open items were actioned. `npm audit` was left alone by
decision: the findings are dev-toolchain only and remediation needs a breaking
`vitest@4` upgrade.

| Item | Change |
|---|---|
| CI red | `GEMINI_API_KEY` added to the `env:` block in `verify.yml` |
| Generation estimate | `GENERATION_SECONDS` 70 → 180 in `client/src/hooks/useDocuments.ts` |
| `GRD-MARKER-SURVIVES` | now reports `n/a` when there is nothing to assert |
| Inactive source keys | removed from config; the fetchers stay |
| `npm audit` | left as-is, by decision |

**The generation estimate was raised twice.** 70s was corrected to 150s, then a
subsequent browser run measured 192s, so it was set to 180s. The observed range
across this sweep is 126–192s. It is display copy only — it drives no timeout —
but the surrounding text asks the user to leave the page open, so understating
it invites them to abandon a run that is working.

**`n/a` is a third state in the generation probe.** `Finding` gained an optional
`na` flag, and the summary line now reads
`N checks · N clean · N n/a · N findings`, counting n/a separately from both.
Without it a check with nothing to assert had to either fail (noise) or report
clean (false assurance). `GRD-MARKER-SURVIVES` sets it when
`out.unvalidated.length === 0`, because the marker is computed in code and the
model cannot strip it whatever the prompt says.

**Source keys were removed from configuration, not from the codebase.**
`OPEN_EXCHANGE_RATES_APP_ID`, `REST_COUNTRIES_API_KEY` and
`GOOGLE_BOOKS_API_KEY` are gone from `.env.example`, `server/config/env.ts` and
`INSTALL.md`. The three fetchers remain, with the keys declared absent as local
constants in `sources.service.ts`. Full removal was considered and rejected:
`countryFacts` gates the `datagovil` lookup through `country?.iso2 === 'IL'`, so
deleting `restcountries` would have silently killed a source that works today.
Restoring any of the three is a one-line change.

`googlebooks` still reports FAIL. It was never key-gated, so removing its key
changed nothing — it returns no data on its own. Per ADR-014 that is tolerated:
anything it would have cited renders `unvalidated` instead.

## Verification after the changes

| Suite | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | 0 errors · 29 warnings |
| `npm test` | 260 / 260 |
| `npm run build` | exit 0 |
| `npm run qa:api` | 77 probes · 75 as expected · 2 TLS-only |
| `npm run qa:resilience` | 17 / 17 clean · 0 findings |
| `npm run qa:generation` | **26 checks · 26 clean · 0 findings** |
| `npm run test:ui` | **23 / 23 passed** (live generation enabled) |
| `npm run probe:sources` | 8 reachable · 1 failed · 2 skipped — unchanged |

`qa:generation` came back fully clean because that run produced one unvalidated
field, so `GRD-MARKER-SURVIVES` passed on its merits: the marker survived the
instruction to remove it. The `n/a` path did not fire, which is the better of
the two outcomes.

`probe:sources` is byte-for-byte what it was before the key removal, including
`datagovil` still reachable — confirming no cascade.
