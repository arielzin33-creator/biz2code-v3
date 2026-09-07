# biz2code — Full Application QA Assessment

Build assessed: `39b6bbd`. Retested after fixes on the `qa-fixes` branch. Date: 2026-08-22.

Status: remediated. 11 of 13 defects fixed and retested, 2 accepted with rationale (§9).

Environment: Windows 11, Node 24.16.0, npm 11.13.0, PostgreSQL 18.4, Chromium 151 (Playwright),
axe-core 4.13.0. Scope: frontend, backend, database, integrations, generated DOCX output. Local
non-production environment, throwaway accounts, all test data deleted on completion.

## 1. Summary

Verdict: CONDITIONAL GO at assessment, GO after remediation.

Nothing in the release-blocking list was found: no broken object-level authorization, no gate
invariant breach, no calculation-integrity defect, no credential exposure, no missing provenance
guardrail, no document-version overwrite. The guardrail survived a direct prompt-injection attack
carried in founder answers, and did so on the fallback model.

Thirteen defects were recorded, none critical. Four were Medium and clustered in one place: HTTP
hardening had never been applied to the Express layer — no security headers, no rate limiting, no
token revocation, and client errors from body-parser surfacing as `500 Internal error`.

Two conditions were raised, both WCAG 2.2 AA, and both are now fixed and retested:

**C1**, against 4.1.3 Status Messages (AA): the gate's refusal reason and autosave state are not
in a live region, so a screen-reader user is not told why Approve is disabled.

**C2**, against 1.4.10 Reflow (AA): a long unbroken answer string overflows the layout by up to
1,725 px at 320 px.

### Test totals

- Static, build, type and data-contract checks: 4 commands, 4 pass.
- Unit tests (Vitest): 154, all pass.
- HTTP checkpoints, 4 suites: 243 assertions, all pass.
- Browser journey (Playwright): 11 checks, 10 pass and 1 skipped (opt-in live generation).
- API, ownership and security probe: 77 checks, 68 as expected, 9 findings.
- Browser QA for WCAG, XSS and vitals: 21 checks, 18 clean, 3 findings.
- Generation guardrail and DOCX: 26 checks, all clean.
- Concurrency, resilience and latency: 17 checks, 15 clean, 2 findings.

553 checks in total: 13 defects, none critical, no blockers.

Evidence: `docs/qa/evidence/` — `api-probe.json`, `browser-qa.json`, `generation-probe.json`,
`resilience-probe.json`, `npm-audit.json`, `harness.txt`. Harnesses are committed and
re-runnable: `server/scripts/qa-*.ts`.

## 2. Requirements-to-test matrix

**R-01, high risk (ADR-005).** JWT in an HttpOnly cookie, client sends credentials. Evidence
`SEC-COOKIE-*`. Pass: HttpOnly, SameSite=Lax, Path=/.

**R-02, high (ADR-003).** Only `gate.service.ts` writes `phases.status` and `current_phase`.
Evidence `gate.service.test.ts` (20 cases) and `DATA-NO-IMPOSSIBLE-STATE`. Pass.

**R-03, high (ADR-003).** Approve requires complete answers and prior phases approved. Evidence
the API gate group (4) and checkpoint:day2 (63). Pass.

**R-04, high (ADR-003).** `current_phase` is the furthest unlocked, and revise does not rewind.
Evidence the gate tests and `checkpoint:day2`. Pass.

**R-05, high (ADR-008).** 11 deterministic formulas, the LLM performs no arithmetic. Evidence
`calculation.service.test.ts` (48). Pass.

**R-06, high (ADR-008).** No `Infinity` or `NaN`; a safe explained result instead. Evidence 4
dedicated cases plus a sweep over 0, −0 and ±1e308. Pass.

**R-07, critical (ADR-009).** Only approved sources are citable; anything unsupported renders
UNVALIDATED. Evidence `GRD-*` (6) under live prompt injection. Pass.

**R-08, high (ADR-009).** PROXY and SOURCES DISAGREE are distinguishable. Evidence
`benchmark.service.test.ts` (25) and `UnvalidatedBadge`. Pass.

**R-09, medium (ADR-010).** One model pinned per document set. Evidence `GRD-ONE-MODEL` and
`rehearse`. Pass.

**R-10, high (ADR-009).** The LLM ladder: retry, fallback, timeout, JSON validation, budget.
Evidence `llm.service.test.ts` (30). Pass.

**R-11, critical (ADR-007).** Regeneration versions and never overwrites. Evidence
`DOC-NO-OVERWRITE` and `DOC-VERSION-ROWS`. Pass.

**R-12, critical (ADR-005).** Object ownership on every project-scoped action. Evidence 21 BOLA
probes. Pass.

**R-13, medium (ADR-003).** 21 fixed questions across 4 phases. Evidence
`answer.service.test.ts` (21) and `checkpoint:day5`. Pass.

**R-14, high (ADR-008).** Answer typing feeds calculation inputs correctly. Evidence 21 unit
tests and 12 API input probes. Pass.

**R-15, medium (ADR-009).** External data is cached and degrades to unvalidated. Evidence the
`checkpoint:day3` offline simulation. Pass.

**R-16, medium (ADR-004).** Migrations repeatable from an empty DB. Evidence the `DB-MIGRATIONS`
ledger. Pass.

**R-17, high.** WCAG 2.2 AA. Evidence axe on 4 pages plus 7 manual checks. Two AA gaps, C1 and
C2.

**R-18, medium.** Core Web Vitals, p75 LCP ≤ 2.5 s and CLS ≤ 0.1. Evidence `PERF-*`. Pass, lab
only.

Untested and why:

- INP requires field data or sustained synthetic interaction, and is not meaningful in a
  single-user lab run.
- Load, stress and soak testing would spend LLM quota on every generation call, and the app is
  single-user and local-only (ADR-002).
- A real screen-reader pass needs assistive tech, which this environment does not have.
  Programmatic checks found C1; a manual AT pass remains outstanding.
- Firefox and WebKit: only Chromium is installed. The app uses no vendor-specific APIs, but this
  is unverified.
- TLS-dependent controls (HSTS, the Secure cookie): no TLS on localhost. Must be re-tested if
  hosted.
- The migration upgrade path: only one migration exists.

## 3. API and ownership matrix

18 routes inventoried from source. Every project-scoped route was exercised as anonymous, owner
(A) and non-owner (B).

`GET /api/health` answers 200 to everyone, public by design.

The auth routes: `POST /api/auth/register` answers 201; `POST /api/auth/login` answers 200 or
401; `POST /api/auth/logout` answers 401 anonymous and 204 signed in; `GET /api/auth/me` answers
401 anonymous and 200 for whoever is signed in.

`GET /api/projects` and `POST /api/projects`, plus `POST /api/projects/seed`, answer 401
anonymous. Signed in, the list returns only the caller's own projects, and both creates return
201 for any user.

Every remaining project-scoped route answers 401 anonymous, succeeds for the owner, and answers
404 for a non-owner: `GET /api/projects/:id`; `GET` and `POST /api/projects/:id/answers` (200 and
201 for the owner); `GET /api/projects/:id/phases` and `/phases/:n`; `POST /phases/:n/approve`
(200 or 409 for the owner); `POST /phases/:n/revise`; `GET /api/projects/:id/documents`; `POST
/documents/generate` (200 or 409); and `GET /documents/:id/download`.

21/21 BOLA probes passed. A non-owner receives 404, not 403: another user's project is
indistinguishable from one that does not exist, so the endpoint cannot be used to enumerate
object IDs.

Direct calls to `approve`, `revise`, `generate` and `download`, with altered phase numbers and
out-of-order sequencing, were all refused server-side (409), not merely by a disabled button.

## 4. Defect register

Severity: Critical = data loss or security breach. High = core function broken. Medium =
incorrect behaviour with a workaround. Low = cosmetic or bounded. Status is after remediation.

### DEF-01 — Client errors reported as `500 Internal error` · Medium · Fixed

`server/middleware/error.ts:35` mapped only `AppError` to a status code; everything else became
500, discarding the correct status body-parser errors already carry.

A malformed JSON body should answer 400 and answered 500. A 2 MB body against a 100 kB limit
should answer 413 and answered 500.

Because `status >= 500` triggers `console.error(err)`, every malformed request also wrote a full
stack trace, burying genuine faults.

Fixed: `errorHandler` reads `err.status ?? err.statusCode` for 4xx. A foreign 5xx is still
distrusted and reported as 500. 11 regression tests in `middleware/error.test.ts`.

### DEF-02 — No security response headers · Medium · Fixed

`Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` all
absent; `X-Powered-By: Express` present. Bounded today (local-only, React escapes output, no XSS
found) but blocking if ever hosted.

Fixed with `helmet()` and an explicit CSP, plus `app.disable('x-powered-by')`. Verified under
`NODE_ENV=production`: HSTS, CSP with `frame-ancestors 'none'`, `nosniff`, `X-Frame-Options` and
`Referrer-Policy` all present, banner gone. OWASP WSTG-CONF-07, ASVS 14.4.

Limitation: the CSP sits on the API, which serves JSON. A browser does not render JSON, so the
policy does little there. The client HTML is served by Vite in development and would be served by
a static host in production — that is where the policy needs to be applied.

### DEF-03 — No rate limiting on authentication · Medium · Fixed

30 consecutive failed logins completed in 2,135 ms, every one answered 401. No 429, no lockout,
no backoff. Mitigating: bcrypt cost 10, 8-character minimum, no account enumeration.

Fixed with `express-rate-limit` on `/auth/login` and `/auth/register`: 20 failures per 15 min per
IP, successes not counted. OWASP WSTG-ATHN-03, API4:2023.

### DEF-04 — Logout does not invalidate the token · Medium · Accepted

A cookie captured before `POST /auth/logout` still returns 200 on `/auth/me`. Logout clears the
browser's copy; it cannot revoke a token already taken, and the token lives 7 days
(`TOKEN_TTL_SECONDS`).

Not fixed. Recorded as a consequence in ADR-005 with the grounds (local-only, single-user) and
the fix required before hosting. Revoking a stateless JWT means reintroducing server-side session
state — the thing that ADR chose against — so it is a decision to make deliberately at
deployment. OWASP WSTG-SESS-06.

### DEF-05 — Gate refusal and autosave are not announced · Medium (C1) · Fixed

WCAG 2.2 §4.1.3, Level AA. Zero live regions existed on the phase page, so three status changes
were conveyed visually only: the unanswered-questions count and list, the field saving
indicator, and the gate's rejection message. A screen-reader user met a disabled Approve button
with no announced reason.

Fixed: `role="status"` on the unanswered-questions list, the earlier-phase explanation and the
autosave indicator; `role="alert"` on gate and field errors. Six live regions where there were
none.

### DEF-06 — Long unbroken text overflows the layout · Medium (C2) · Fixed

WCAG 2.2 §1.4.10, Level AA. At 320 px, a 400-character answer with no spaces produced 2,045 px
of content — 1,725 px of horizontal scroll. The project name in the `<h1>` overflowed the same
way. Normal prose does not trigger it: the seed project measured 0 px overflow at 320, 375, 768
and 1280 px. The realistic trigger is a pasted URL.

The first browser run reported this against the seed project, which was wrong — that run had
created its project with an XSS payload as the name, so the test data caused the overflow. The
finding above is the corrected, isolated result.

Fixed with `overflow-wrap: anywhere` on text-bearing elements.

### DEF-07 — `prefers-reduced-motion` not honoured · Low · Fixed

The generation progress bar (`b2c-slide`, 1.4 s infinite) animated for ~70 s regardless of the OS
motion preference. WCAG 2.3.3 is AAA, so not an AA failure, but it is the one long-running
animation in the product. Fixed with a `@media (prefers-reduced-motion: reduce)` guard holding
the bar as a static band.

### DEF-08 — Phase stepper does not adapt below ~500 px · Low · Fixed

At 375 px: four columns of 78 × 149 px, labels wrapping to 3–4 lines; at 320 px the fourth phase
was visually clipped. No horizontal scroll, so legibility rather than breakage. Introduced on Day
5 (`flex: 1 1 0`) with no narrow breakpoint.

Fixed with `grid` and `auto-fit / minmax(150px, 1fr)`: at 375 px the items went to 164 × 86 px
(2 × 2), with no media query.

### DEF-09 — 5 CVEs in the vitest dev-dependency chain · Low · Deferred

`npm audit`: 1 critical, 1 high, 3 moderate, all in `vitest → vite-node → vite → esbuild`. Zero
production dependencies affected, verified against all three `package.json` files. The app's own
Vite is 6.4.3; the vulnerable 5.4.21 copies are nested under vitest only. The critical
(GHSA-5xrq-8626-4rwp, CVSS 9.8) requires the Vitest UI server to be listening, which this project
never runs.

Deferred: the fix is `vitest@4`, a major bump against 165 passing tests, for a dev-only
dependency with zero production exposure.

### DEF-10 — No CI pipeline and no linter · Low · Fixed

No workflows, no ESLint config, no `lint` script — `server/middleware/error.ts:34` even carried a
pragma for a linter that was not installed. Fixed: `.github/workflows/verify.yml` runs typecheck,
lint, unit tests, the data contract, the build, migrations and both QA probes on every push,
under a minute and with no LLM quota. ESLint added with a narrow correctness ruleset.

### DEF-11 — Withdrawn

Reported as "the `Secure` flag is not conditional on environment". That was false:
`auth.service.ts` already had `secure: process.env.NODE_ENV === 'production'`. The absence of
`Secure` on a localhost response was read as the absence of the logic. Verified: under
`NODE_ENV=production` the cookie is issued as `token=…; HttpOnly; Secure; SameSite=Lax`.

### DEF-12 — No Origin check or CSRF token · Informational · Fixed

`POST` with `Origin: http://evil.example` was accepted (201). Defence rested on `SameSite=Lax`
and on only `express.json()` being mounted, so a classic HTML-form CSRF gets 400 — accidental but
real. Fixed: `middleware/origin.ts` refuses a mutating request that declares a foreign `Origin`.
A request with no Origin is allowed deliberately: curl and every harness here sends none, and a
browser cannot be made to omit it.

### DEF-13 — `/api/health` is liveness, not readiness · Informational · Fixed

Returned 200 while the database was refusing connections. Fixed: `GET /api/ready` queries the
database and answers 503 when it cannot; `/health` stays a liveness probe.

## 5. Accessibility — WCAG 2.2 Level AA

Tooling: axe-core 4.13.0 (`wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa`) plus manual
programmatic checks, Chromium 151.

The automated scan found zero violations on every page: `/login` (14 checks passed),
`/projects` (24), `/projects/:id/phase/1` (24), `/projects/:id/documents` (11). That reflects
semantic `<main>`/`<nav>`/`<header>`, every control labelled, a visible focus ring, and colour
contrast measured rather than eyeballed.

The manual and programmatic checks:

- 1.3.1, form labelling — pass. Every input has a `<label for>` or an `aria-label`.
- 1.3.1, heading order — pass. An h1 is present and no levels are skipped.
- 1.3.6, landmarks — pass. One `main`, one `nav`, one `header`.
- 1.4.3, brand palette contrast — pass. Accent 6.95:1, button text on accent 7.01:1.
- 1.4.10 at 320 px with long unbroken content — was a fail (DEF-06), now fixed.
- 1.4.10 at 375, 768 and 1280 px with normal content — pass, no horizontal scroll.
- 2.1.1, tab into the form — pass. The first Tab reaches `#email`.
- 2.4.7, computed `:focus-visible` — pass. A 2 px outline from an explicit rule.
- 2.4.11, focus not obscured — not tested; no sticky headers or overlays exist.
- 2.5.8, target size — not measured; no control appeared below 24 px.
- 4.1.3, live regions — was a fail (DEF-05), now fixed.
- 2.3.3 (AAA), reduced motion — was a fail (DEF-07), now fixed.

A manual screen-reader pass is still outstanding. Programmatic checks found C1; an AT pass could
find more, particularly around the stepper's `aria-current="step"` and the disabled-button
announcement.

## 6. Security

Mapped to OWASP WSTG, ASVS and API Security Top 10 (2023). All testing was authorized and
non-destructive; no finding was exploited beyond proving impact.

- **BOLA, object ownership** (API1:2023, WSTG-ATHZ-04) — pass, 21/21. 404 rather than 403, and no
  enumeration.
- **Broken function-level auth** (API5:2023) — pass. Gate rules are enforced in the service layer.
- **Account enumeration** (WSTG-IDNT-04) — pass. A wrong password and an unknown account return
  byte-identical 401s.
- **SQL injection** (WSTG-INPV-05) — pass. Payloads in path params answer 400 or 404, and all
  queries are parameterised.
- **Path traversal** (WSTG-ATHZ-01) — pass. `%2e%2e%2fetc%2fpasswd` answers 400, and download
  filenames are derived server-side via `basename()`.
- **Stored XSS** (WSTG-INPV-02) — pass. `<img src=x onerror=...>` is stored and rendered inert.
- **Prompt injection** — pass, see below.
- **OOXML / document injection** (WSTG-INPV-16) — pass. The `</w:t></w:r>` payload was neutralised
  in all three documents.
- **JWT flaws** (WSTG-SESS-10) — pass. A forged token and `alg:none` both answer 401.
- **Replay after logout** (WSTG-SESS-06) — fail. DEF-04, accepted.
- **Cookie flags** (WSTG-SESS-02) — HttpOnly, SameSite=Lax and Path present; Secure is
  production-only.
- **CSRF** (WSTG-SESS-05) — was partial. DEF-12, now fixed.
- **Security misconfiguration** (API8:2023) — was a fail. DEF-02, now fixed.
- **Unrestricted resource consumption** (API4:2023) — was a fail. DEF-03, now fixed; body size is
  capped at 100 kB.
- **Sensitive data exposure** (WSTG-ERRH-01) — pass. No `password_hash`, stack trace or SQL in any
  response.
- **Secrets in VCS** — pass. `.env` untracked, `.env.example` empty, no key patterns tracked.
- **CORS** (WSTG-CLNT-07) — pass. `evil.example` and `null` are not reflected.
- **SSRF** (API7:2023) — not applicable; no user-supplied URL is fetched.
- **Supply chain** (A06:2021) — DEF-09, dev-only.

### Prompt injection

Hostile instructions were placed in three founder answers, then a full generation run was
executed against the live model. Payloads: instruction override, system-prompt disclosure, a
fabricated citation with a unique canary (`ZZQA-CANARY-BRAND-9931`, "412% year-on-year growth"),
guardrail suppression, and an OOXML structure break.

The system prompt was not disclosed. The canary source was not cited, and is absent from all
three documents. The fabricated 412% statistic was not repeated. The "ALL FIGURES INDEPENDENTLY
AUDITED" claim was not adopted. No UNVALIDATED marker was removed — 17 fields stayed marked. The
OOXML structure was not broken; the payload was escaped in all three files. And the documents
still read in one voice, from a single model across the set.

26/26 clean. The run executed on `gemini-3.5-flash-lite`, the fallback model, because the Groq
token budget was drained — so the guardrail held on the weakest model in the ladder.

## 7. Performance and resilience

API latency, local, warm, LLM excluded, n=60 per endpoint:

p50 / p95 / p99 in milliseconds: `GET /api/health` 1.0 / 1.6 / 2.0. `GET /api/auth/me`
1.6 / 2.8 / 5.2. `GET /api/projects` 1.6 / 2.5 / 2.6. `GET /api/projects/:id` 2.1 / 2.9 / 3.9.
`GET /api/projects/:id/phases/:n` 2.9 / 4.4 / 5.2. `POST /api/projects/:id/answers`
3.5 / 6.0 / 6.7.

All p95 well under 200 ms. The write path is slowest, as expected: it upserts and then makes the
gate recompute completeness.

Generated-document requests are measured separately, since provider latency dominates: a cold run
of all three documents is 69 s, of which ~10 s is model time; the remaining ~59 s is Groq's
8,000-token-per-minute bucket refilling at ~133/s. A consecutive run is ~99 s because a drained
bucket makes the pinned model fail and the set escalates. This is a free-tier capacity floor, not
a code inefficiency.

Core Web Vitals, lab, localhost, unthrottled: LCP 124–152 ms, CLS 0.000, TTFB 5–6 ms across
`/login`, `/projects` and a phase page. Inside the p75 thresholds, but these are lab numbers —
they establish that nothing is structurally slow, not that field performance would meet the
threshold. INP was not measured.

Concurrency:

- Ten simultaneous approvals of one phase: all accepted, final state `current_phase = 2`, not 11.
  `GREATEST()` and the idempotent `UPDATE` make it safe by construction.
- Concurrent approve and revise on one phase: no impossible state; the phase ended `approved` with
  a timestamp.
- Eight concurrent writes to one answer: 1 row. `UNIQUE(project_id, question_id)` holds.
- Whole-table invariant sweep: zero approved phases with a null timestamp, across every project.

Resilience:

- Database refuses connections: 500, with no driver internals or connection strings leaked.
- Database returns: the first request after recovery answers 200. The pool recovered with no
  restart.
- 2 MB request body: rejected at 100 kB.
- External APIs unreachable: all five lookups served from `external_cache`.
- Primary LLM fails: the set redrafts on the next model. Verified live.

Observability gap: no structured logging, correlation IDs, metrics or traces. Errors go to
`console.error` with a full stack. Acceptable for a local single-user application; the first
thing to add before hosting.

## 8. Generated-document validation

Three documents produced in a live run, each opened as a ZIP and inspected part by part.

All three are valid OOXML packages of 24 parts — 11 kB for the MRD, 12 kB each for the PRD and
Business Plan. Sections rendered with no failures: 5 in the MRD, 7 in the PRD, 11 in the Business
Plan. In all three, OOXML injection was neutralised, no credentials or secrets appear, the
filename is safe, and one pinned model wrote the set. The UNVALIDATED marker appears in the
Business Plan, inside the compressed part rather than only in the API response.

Provenance ledger: 21 answers, 6 benchmarks, 6 external calls, 23 field records. Proxy benchmarks
correctly flagged (`cpi_usd`, `retention_d30_pct`).

Version integrity (ADR-007): after regenerating, `version = 2`, all three v1 files
byte-identical, 6 deliverable rows. No overwrite path found.

Documents were validated structurally and by extracting text. A visual render was not performed —
no converter is available here. Manual review of one document in Word before the demo is
recommended.

## 9. Retest record — 2026-08-22

All fixes were made on `qa-fixes` and retested with the same harnesses that found the defects.

- `qa:api` (77 probes): 9 findings at assessment, 2 after — both correct-on-localhost, see below.
- `qa:browser` (21 checks): 3 findings, now 0.
- `qa:resilience` (17 checks): 2 findings, now 0.
- `qa:generation` (26 checks): 0 findings, and not re-run — untouched by these changes, and it
  spends quota.
- Unit tests: 154, now 165. The 11 new ones are all for DEF-01.
- `npm run lint`: no linter existed; now 0 errors and 5 warnings.
- Checkpoints day 2, 3 and 5: 63 / 61 / 59 before and after.
- Browser journey: 10 pass before and after.

Two `qa:api` findings that were never defects — both are the probe's expectation being wrong for
a development environment. They are left in the suite rather than silenced, because they are the
check that the production-only branch still exists:

- `SEC-COOKIE-SECURE` — correct to be absent on plain-HTTP localhost; a `Secure` cookie would
  never be sent and login would break. Confirmed present in production mode.
- `SEC-HDR-strict-transport-security` — deliberately production-only. Sending HSTS from a
  localhost HTTP server would lock a developer out of their own machine.

`DB-CONSTRAINTS` was also a false finding: the probe asserted `>= 5` foreign keys, but four is
correct for this schema — `external_cache` and `schema_migrations` have no parent to reference.
Threshold corrected in the probe.

## 10. Exit criteria

- Blocker or critical issues: none.
- Ownership and authorization: pass, 21/21.
- Gate invariant: pass, held under 10-way concurrency.
- Calculation integrity: pass, 48 unit tests, deterministic across runs.
- Credential exposure: none.
- Provenance guardrail: pass, held under live prompt injection.
- Document version overwrite: none. v1 is byte-identical after v2.
- WCAG 2.2 AA on a critical journey: pass. C1 and C2 both fixed and retested.

### GO

Two items remain open, both documented and neither blocking:

**DEF-04**, the token not being revocable on logout. Acceptable because the app is local-only
and single-user (ADR-002), and it is recorded in ADR-005. Revisit on any hosted deployment.

**DEF-09**, the dev-dependency CVEs. Acceptable because there is zero production exposure and the
critical path is unreachable. Revisit after the deadline.

If a hosted deployment is planned, DEF-04 must be resolved before it ships. DEF-02, DEF-03,
DEF-11 and DEF-12 are fixed and verified in production mode.

## 11. Regression suite proposal

The four QA harnesses written for this assessment are committed and re-runnable, so most of this
is wiring.

On every pull request, in rough order of value:

1. Unit: `errorHandler` maps `err.status` — 400 for malformed JSON, 413 for oversized. Under a
   second.
2. Browser: live regions present on the phase page. ~10 s.
3. Browser: `overflow-wrap` holds a 400-character unbroken answer at 320 px. ~10 s.
4. API: security headers present on every response. Under a second.
5. API: the rate limit returns 429 after N failed logins. ~2 s.
6. API: BOLA sweep across all 18 routes as a non-owner. ~3 s.
7. Browser: axe-core scan, 4 pages, zero violations. ~15 s.
8. Integration: concurrency — 10 approvals plus the invariant sweep. ~2 s.

Pre-release only, because they spend real quota: the prompt-injection canary suite (~90 s) and
DOCX structural validation (~90 s).

Items 8 and 10 belong on a pre-release trigger because they spend real quota.

## Appendix — reproducing this assessment

```bash
npm run typecheck && npm test && npm run build && npm run validate:data

npx tsx server/scripts/qa-api-probe.ts          # 77 probes  — API, ownership, security
npx tsx server/scripts/qa-resilience-probe.ts   # 17 checks  — concurrency, resilience, latency
npx tsx server/scripts/qa-generation-probe.ts   # 26 checks  — SLOW, spends LLM quota

npm run dev                                     # then, in another terminal:
node <scratch>/qa-browser.mjs docs/qa/evidence/browser-qa.json   # axe, XSS, vitals
```

Each harness creates throwaway users and deletes them on completion. The generation probe is the
only one that spends quota.

Baselines: OWASP WSTG, ASVS and API Security Top 10 (2023); WCAG 2.2; Playwright testing
guidance; Core Web Vitals thresholds; k6 performance testing guidance.
