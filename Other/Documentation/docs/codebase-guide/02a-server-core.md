# 02a — Server core: entry, config, data, middleware, routes, controllers

Phase 3, backend, part 1. **24 files, 700 lines** (`find server/{config,controllers,db,middleware,routes,types} -name "*.ts" | xargs wc -l`, plus `index.ts` and `app.ts`).

Read this file to follow one request end to end. Business logic starts in
[02b](02b-services-gate-and-domain.md).

**Header comments:** none of the files in this section carries one. All 24 begin with two blank
lines where a `PURPOSE / WHY / DEPENDS / ADR` block was removed, except `config/env.ts`, which
retains a one-line header. Where the sibling checkout's header is quoted it is marked
**[sibling]** and describes intent, not this file's contents.

---

## The request path in one picture

```
browser  ──►  vite dev server :5173  ──proxy /api──►  express :3001
                                                       │
  helmet ─► cors ─► express.json ─► cookieParser ─► checkOrigin
                                                       │
        /api/health ──────────────────────────────────►│ (public, no auth)
        /api/ready  ──────────────────────────────────►│ (public, hits the DB)
                                                       │
        /api/auth/login|register ──► authLimiter ──────►│
                                                       ▼
                                            authRoutes / projectRoutes /
                                            answerRoutes / phaseRoutes /
                                            documentRoutes
                                                       │
                             each nested router: requireAuth ─► loadProject
                                                       ▼
                                            controller ──► service ──► db/query
                                                       │
                                              errorHandler (last)
```

---

## `server/index.ts` — 22 lines

**Purpose.** Process entry point: start the HTTP listener and give one specific failure a useful
message.

**[sibling] header:** *"Process entry point; starts the HTTP listener."*

**Related ADR:** ADR-001 (one process), ADR-002 (localhost).

| Name | Signature | Inputs | Output | Side effects | Failure mode | Tested? | Calls / called by |
|---|---|---|---|---|---|---|---|
| *(module body)* | — | `env.PORT` | — | Binds a TCP port; writes to stdout | — | No test found | Calls `app.listen`; entry point for `npm run dev:api`, `npm run start`, and Playwright's `webServer` |
| *(anonymous)* `server.on('error')` | `(err: NodeJS.ErrnoException) => void` | Node error | never | `console.error`, `process.exit(1)` on `EADDRINUSE`; re-throws otherwise | Re-throws any non-`EADDRINUSE` error | No test found | — |

**Worth noting.** The `EADDRINUSE` message (lines 14-18) tells the reader that
`client/vite.config.ts` proxies to this port, so both must move together. That coupling is real:
[client/vite.config.ts:12](../../../../client/vite.config.ts) hard-codes `http://localhost:3001`
and reads no environment variable.

---

## `server/app.ts` — 80 lines

**Purpose.** Builds the Express app: the middleware chain, two public probes, the rate limiter,
five routers, the error handler.

**[sibling] header:** *"PURPOSE Builds the Express app: middleware chain and route mounting.
WHY Middleware ORDER matters. cookieParser before auth (auth reads the cookie); error handler
LAST."*

**Related ADR:** ADR-001, ADR-005.

| Name | Signature | Inputs | Output | Side effects | Failure mode | Tested? | Calls / called by |
|---|---|---|---|---|---|---|---|
| `app` | `express.Express` | — | The configured app | none at import; the routers' imports do load `question-bank.json` and `benchmarks/*.json` transitively | A bad content file throws at import, before `listen` | Exercised by [qa-api-probe.ts:77](../../../../server/scripts/qa-api-probe.ts) (`app.listen(0)`) — 77 probes. No unit test | Imported by `index.ts` and `qa-api-probe.ts` |
| *(inline)* `GET /api/health` | `(_req, res) => res.json({ ok, service })` | — | `{ ok: true, service: 'biz2code' }` | none | cannot fail | `API-001` in the probe | — |
| *(inline)* `GET /api/ready` | `async (_req, res)` | — | `{ ok, database }` | **DB read** — `SELECT 1` | Returns 503 on any DB error; never throws | `RES-HEALTH-LIES`, `RES-DB-DOWN`, `RES-DB-RECOVERY` in [qa-resilience-probe.ts](../../../../server/scripts/qa-resilience-probe.ts) | Calls `db/query.query` **directly** — a layer skip, see [01-architecture.md](01-architecture.md) §2.4 |
| `authLimiter` | `RateLimitRequestHandler` | — | — | in-memory counter | — | `SEC-RATELIMIT` in the API probe | Mounted on `/api/auth/login` and `/api/auth/register` only |

**The chain, in order, with what each is for** (lines 21-77):

| # | Line | Middleware | Why it sits here |
|---|---|---|---|
| 0 | 21 | `app.disable('x-powered-by')` | Removes the framework banner |
| 1 | 24-38 | `helmet(...)` | CSP with `defaultSrc 'self'`, `frameAncestors 'none'`, `objectSrc 'none'`; `hsts` only when `NODE_ENV === 'production'`; `crossOriginEmbedderPolicy: false` |
| 2 | 40 | `cors({ origin: env.CLIENT_ORIGIN, credentials: true })` | Single origin; `credentials` is required for the cookie |
| 3 | 41 | `express.json()` | Populates `req.body` before any validator |
| 4 | 42 | `cookieParser()` | **Must precede `requireAuth`**, which reads `req.cookies.token` |
| 5 | 44 | `checkOrigin` | CSRF layer 2, after cookies are parsed |
| 6 | 47-55 | health / ready | Public, mounted before the routers so a probe needs no session |
| 7 | 69-70 | `authLimiter` | Path-scoped |
| 8 | 72-77 | five routers | See the mount table below |
| 9 | 79 | `errorHandler` | **Last**, so it catches everything above |

**Router mounts** (lines 72-77) — note the three nested ones use `:projectId` in the mount path
and therefore require `mergeParams` in the router:

```ts
app.use('/api/auth',                            authRoutes);
app.use('/api/projects',                        projectRoutes);
app.use('/api/projects/:projectId/answers',     answerRoutes);
app.use('/api/projects/:projectId/phases',      phaseRoutes);
app.use('/api/projects/:projectId/documents',   documentRoutes);
```

**Observation.** The CSP is defined but has no effect in the deployed configuration: Express
serves only JSON, and the SPA is served by Vite on a different port. It would matter if the
client were ever served from this process.

---

## `server/config/env.ts` — 32 lines

**Purpose.** Load `.env` from the repository root once, at import, and fail immediately on a
missing required value.

**Its own header (present):** `/* Loads and validates environment variables once, at boot. */`

**Related ADR:** ADR-002, ADR-011.

| Name | Signature | Inputs | Output | Side effects | Failure mode | Tested? | Calls / called by |
|---|---|---|---|---|---|---|---|
| `required` *(private)* | `(name: string) => string` | env var name | the value | reads `process.env` | **Throws** `Missing required env var: X` | No direct test | Used three times below |
| `env` | `const` object, 7 keys | `process.env` | frozen-by-convention config | `dotenv.config()` at line 7 | Throws at import if `DATABASE_URL`, `JWT_SECRET` or `GROQ_API_KEY` is absent | Indirectly — every test that imports a service transitively imports this. CI supplies test values in [verify.yml](../../../../.github/workflows/verify.yml) | Imported by `app`, `index`, `auth.service`, `middleware/auth`, `middleware/origin`, `db/pool`, `llm.service` |

**The seven keys:**

| Key | Required | Default | Consumers |
|---|---|---|---|
| `NODE_ENV` | no | `'development'` | `helmet` hsts, cookie `secure` |
| `PORT` | no | `3001` | `index.ts` |
| `DATABASE_URL` | **yes** | — | `db/pool.ts` |
| `JWT_SECRET` | **yes** | — | `auth.service`, `middleware/auth` |
| `GROQ_API_KEY` | **yes** | — | `llm.service.callGroq` |
| `GEMINI_API_KEY` | no | `null` | `llm.service.callGemini` — the rung is skipped when null |
| `LLM_FEEDBACK_ENABLED` | no | `false` | `llm.service.critiqueAnswers` only |

**Path resolution** (line 7): `resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '.env')`
— the repository root, deliberately, so `server/.env` is ignored. This is what
[INSTALL.md](../../../../INSTALL.md) §8 warns about.

**Lines 26-28 are blank.** Per the
[QA-Assessment-2026-08-24 follow-up](../qa/QA-Assessment-2026-08-24.md), that is where
`OPEN_EXCHANGE_RATES_APP_ID`, `REST_COUNTRIES_API_KEY` and `GOOGLE_BOOKS_API_KEY` were removed.
Their replacements are now local `null` constants at
[sources.service.ts:137-139](../../../../server/services/sources.service.ts) — with a consequence
the QA note did not anticipate; see [02d](02d-services-data-sources.md) §5.

**Note.** `GROQ_API_KEY` is `required()`, so **the server will not boot without it even though
nothing calls a model until a document is generated.** README and INSTALL both state this as
intended.

---

## `server/db/pool.ts` — 6 lines

**Purpose.** The single `pg.Pool` for the process.

**[sibling] header:** *"The single pg connection pool."*

| Name | Signature | Inputs | Output | Side effects | Failure mode | Tested? | Calls / called by |
|---|---|---|---|---|---|---|---|
| `pool` | `Pool` | `env.DATABASE_URL` | pool, `max: 10` | Opens connections lazily on first query | Connection errors surface at query time, not import time | No test found (unit tests use [fakeDb.ts](../../../../server/test/fakeDb.ts) instead) | Used by `db/query.ts`; `pool.end()` is called by every script |

`max: 10` is the only tuning. There is no `idleTimeoutMillis` or `connectionTimeoutMillis`.

---

## `server/db/query.ts` — 33 lines

**Purpose.** The whole data-access layer. ADR-004's *"~30-line typed wrapper"* — measured at 33.

**[sibling] header:** *"Thin typed wrapper over pg."*

**Related ADR:** ADR-004.

| Name | Signature | Inputs | Output | Side effects | Failure mode | Tested? | Calls / called by |
|---|---|---|---|---|---|---|---|
| `query<T>` | `(sql: string, params?: unknown[]) => Promise<T[]>` | SQL + params | `res.rows as T[]` | **DB** | Rejects with the driver's error — no wrapping | Substituted by `fakeDb` in unit tests; exercised live by all three QA probes | Called by every service that touches the DB, and by `app.ts` |
| `queryOne<T>` | `(sql, params?) => Promise<T \| null>` | as above | first row or `null` | **DB** | as above | as above | The "normal absence" case — Coding Guide §1.2 **[sibling]** singles it out as the one legitimate `null` return |
| `transaction<T>` | `(fn: (q: typeof query) => Promise<T>) => Promise<T>` | a callback | whatever `fn` returns | **DB**: `BEGIN` / `COMMIT` / `ROLLBACK`, one dedicated client | Rolls back then re-throws; `client.release()` in `finally` | Exercised by `gate.service.test` via `fakeDb`; live in the probes | `gate.approvePhase`, `answer.saveAnswers`, `project.create`, `project.createFromSeed`, `generation.generateAll` |

**The typing is an assertion, not a check** (line 8): `return res.rows as T[]`. Nothing verifies
the SQL produced those columns. Coding Guide §2 **[sibling]**: *"The typing is a claim, not a
check."*

**How `transaction` scopes the client** (lines 22-24) — the callback receives a `scoped` function
with the same shape as `query`, bound to the single checked-out client, so every statement inside
the callback lands in the same transaction:

```ts
const scoped = async <R>(sql: string, params: unknown[] = []): Promise<R[]> =>
  (await client.query(sql, params)).rows as R[];
const out = await fn(scoped as typeof query);
```

**A real hazard.** Any code inside the callback that imports `query` directly instead of using
the injected `q` would silently run **outside** the transaction. Nothing enforces this; it is a
convention. All five current call sites use the parameter correctly (verified by reading each).

---

## `server/types/express.d.ts` — 14 lines

**Purpose.** Module augmentation so `req.userId` and `req.project` type-check.

| Name | Declaration | Set by | Read by |
|---|---|---|---|
| `Express.Request.userId?` | `number` | [middleware/auth.ts:14](../../../../server/middleware/auth.ts) | `project.controller.userIdOf`, `middleware/project.loadProject`, `auth.controller.me` |
| `Express.Request.project?` | `ProjectRow` | [middleware/project.ts:16](../../../../server/middleware/project.ts) | `projectOf()` in the answer, phase, document and project controllers |

Both are **optional**, so every consumer must re-check. Each controller does so through a local
guard that throws `AppError` — `projectOf` appears four times, once per controller, as a
three-line private function. That duplication is deliberate rather than shared; there is no
common helper.

---

## `server/middleware/` — 7 files, 225 lines

### `async.ts` — 11 lines

| Name | Signature | Failure mode | Tested? |
|---|---|---|---|
| `asyncHandler` | `(fn: AsyncRouteHandler) => RequestHandler` | Forwards a rejected promise to `next`, so it reaches `errorHandler` | No direct test; every controller depends on it |

Without it, a rejected promise in an `async` Express handler becomes an unhandled rejection and
the client hangs. Every exported controller is wrapped in it — verified: 17 of 17
`export const` handlers across the five controllers.

### `auth.ts` — 19 lines

| Name | Signature | Inputs | Output | Side effects | Failure mode | Tested? |
|---|---|---|---|---|---|---|
| `requireAuth` | `(req, res, next) => void` | `req.cookies.token` | sets `req.userId`, calls `next()` | none | **401** `Not authenticated` with no cookie; **401** `Invalid session` on any `jwt.verify` throw | `API-002`, `SEC-JWT-FORGED`, `SEC-JWT-ALG-NONE`, `SEC-LOGOUT-REPLAY` in the API probe |

`jwt.verify` is what rejects `alg: none` and a forged signature — the probe asserts both. The
`catch` is bare (line 16), so an expired token and a tampered one are indistinguishable to the
client, which is the intent.

### `error.ts` — 41 lines — **the only unit-tested file in this section**

| Name | Signature | Inputs | Output | Side effects | Failure mode | Tested? |
|---|---|---|---|---|---|---|
| `AppError` | `class extends Error`, `constructor(message, status = 400)` | — | — | none | it *is* the failure | 11 tests, [error.test.ts](../../../../server/middleware/error.test.ts) |
| `statusOf` *(private)* | `(err: Error) => number` | any error | 400-499 or 500 | none | never throws | `it('reads statusCode when status is absent')`, `it('does NOT trust a foreign 5xx')`, `it('ignores a nonsensical status')` |
| `CLIENT_ERROR_TEXT` *(private)* | `Record<number, string>` | — | 400 / 413 / 415 messages | — | — | `it('maps malformed JSON to 400')`, `it('maps an oversized body to 413')` |
| `errorHandler` | `(err, _req, res, _next) => void` | any error | JSON `{ error }` | `console.error` **only for 5xx** | never throws | all 11 tests |

**The rule this file encodes** (lines 11-18): a foreign error's self-reported status is trusted
**only if it is 4xx**. A library claiming 500 or 503 is downgraded to 500 with a generic body.
Asserted by `it('does NOT trust a foreign 5xx')`
([error.test.ts:88](../../../../server/middleware/error.test.ts)).

**And the corollary** (lines 31-35): a 5xx logs the real error server-side and returns exactly
`{ error: 'Internal error' }`. A 4xx never logs. Asserted by
`it('does not log a client error as a server fault')` and `it('logs the real error server-side')`.

The test file's own comment cites `DEF-01` from the QA assessment — this behaviour was a defect
fix, not an original design.

### `origin.ts` — 16 lines

| Name | Signature | Inputs | Output | Failure mode | Tested? |
|---|---|---|---|---|---|
| `checkOrigin` | `(req, res, next) => void` | `req.method`, `Origin` header, `env.CLIENT_ORIGIN` | `next()` or 403 | **403** `Cross-origin request refused` | Exercised by the API probe's cross-origin cases |

Three branches (lines 9-15): `GET`/`HEAD`/`OPTIONS` pass unconditionally; a **missing** `Origin`
passes; anything else must match `env.CLIENT_ORIGIN` exactly.

**The missing-Origin allowance is a deliberate weakening**, and the reason is that server-side
callers — `qa-api-probe.ts`, `curl`, the Playwright fixture — send no `Origin`. It means this
middleware defends against a cross-site *browser* request and nothing else. `SameSite=Lax` on the
cookie is the primary control; this is the second layer.

### `project.ts` — 26 lines

| Name | Signature | Inputs | Output | Side effects | Failure mode | Tested? |
|---|---|---|---|---|---|---|
| `loadProject` | `(req, _res, next) => void` | `req.params.projectId`, `req.userId` | sets `req.project` | **DB** via `getOwned` | 400 on a non-integer id; 401 with no `userId`; **404** (never 403) when the project is not owned | `SEC-LIST-ISOLATION` and the ownership group in the API probe |
| `parsePhaseNo` | `(req: Request) => number` | `req.params.phaseNo` | 1..`PHASE_COUNT` | none | **throws** `AppError(400)` | via the phase probes |

`loadProject` is **promise-chained rather than `async`** (lines 15-17) so that its rejection
reaches `next` without `asyncHandler`. `parsePhaseNo` throws instead, and is only ever called
inside an `asyncHandler`-wrapped controller — so both reach `errorHandler`, by different routes.

**404-not-403 is the isolation design.** `getOwned` filters on `user_id` in the `WHERE` clause
([project.service.ts:60](../../../../server/services/project.service.ts)), so another user's
project is indistinguishable from a nonexistent one. ADR-005's *"Someone else's project answers
404, never 403"* (WORK_PLAN Day 2) is verified here.

### `validate.ts` — 11 lines

| Name | Signature | Inputs | Output | Failure mode | Tested? |
|---|---|---|---|---|---|
| `validateBody` | `(fields: string[]) => RequestHandler` | required key names | `next()` or 400 | 400 `Missing: a, b` | `API-003` (missing password) etc. |

**Presence only** — it checks `req.body?.[f] === undefined` and nothing else. All type and range
validation lives in `answer.service.toColumns`. WORK_PLAN Day 2 states the reason:
*"Type validation lives in `answer.service.toColumns()`, not `middleware/validate.ts`, because
seeding writes answers without passing through HTTP."* Verified: `createFromSeed` inserts
directly ([project.service.ts:104-114](../../../../server/services/project.service.ts)) and
would bypass any HTTP-layer validator.

Used at exactly two call sites: `auth.routes` (register, login) and `project.routes` (create).

### `error.test.ts` — 101 lines

Covered in [06-testing.md](06-testing.md).

---

## `server/routes/` — 5 files, 76 lines

Every route file has the same shape: create a router, attach the auth chain once, list the
endpoints. No file contains logic.

### The complete endpoint table — 19 endpoints

| Method | Path | Auth chain | Controller | Success | Documented failures |
|---|---|---|---|---|---|
| GET | `/api/health` | none | inline | 200 | — |
| GET | `/api/ready` | none | inline | 200 | 503 if the DB is down |
| POST | `/api/auth/register` | `authLimiter`, `validateBody(['email','password'])` | `auth.register` | **201** + cookie | 400 bad email / short password, 409 duplicate, 429 rate limit |
| POST | `/api/auth/login` | `authLimiter`, `validateBody(['email','password'])` | `auth.login` | 200 + cookie | 401 (identical body for both causes), 429 |
| POST | `/api/auth/logout` | `requireAuth` | `auth.logout` | **204** | 401 |
| GET | `/api/auth/me` | `requireAuth` | `auth.me` | 200 | 401 |
| GET | `/api/projects` | `requireAuth` | `project.list` | 200 | 401 |
| POST | `/api/projects` | `requireAuth`, `validateBody(['name'])` | `project.create` | **201** | 400 blank name, 401 |
| POST | `/api/projects/seed` | `requireAuth` | `project.createFromSeed` | **201** | 401 |
| GET | `/api/projects/:projectId` | `requireAuth`, `loadProject` | `project.get` | 200 | 400, 401, 404 |
| GET | `/api/projects/:projectId/answers` | `requireAuth`, `loadProject` | `answer.list` | 200 | 400, 401, 404 |
| POST | `/api/projects/:projectId/answers` | `requireAuth`, `loadProject` | `answer.save` | **201** | 400 (type, range, unknown option, unknown question), 401, 404 |
| GET | `/api/projects/:projectId/phases` | `requireAuth`, `loadProject` | `phase.list` | 200 | 400, 401, 404 |
| GET | `/api/projects/:projectId/phases/:phaseNo` | `requireAuth`, `loadProject` | `phase.get` | 200 | 400 bad phaseNo, 404 phase not found |
| POST | `/api/projects/:projectId/phases/:phaseNo/approve` | `requireAuth`, `loadProject` | `phase.approve` | 200 | **409** ×3 (not unlocked / earlier phase unapproved / incomplete) |
| POST | `/api/projects/:projectId/phases/:phaseNo/revise` | `requireAuth`, `loadProject` | `phase.revise` | 200 | 400, 404 |
| POST | `/api/projects/:projectId/documents/generate` | `requireAuth`, `loadProject` | `document.generate` | 200 | **409** phases not all approved |
| GET | `/api/projects/:projectId/documents` | `requireAuth`, `loadProject` | `document.list` | 200 | 400, 401, 404 |
| GET | `/api/projects/:projectId/documents/:id/download` | `requireAuth`, `loadProject` | `document.download` | 200 + stream | 400 bad id, 404 no file_path, **410** file gone from disk |

**The pattern that makes an unauthenticated route impossible by omission.** Each nested router
declares the chain once as router-level middleware:

```ts
export const answerRoutes = Router({ mergeParams: true });
answerRoutes.use(requireAuth, loadProject);
```

A route added later inherits it. WORK_PLAN Day 2 names this as the intent; verified in all four
nested routers ([answer](../../../../server/routes/answer.routes.ts),
[phase](../../../../server/routes/phase.routes.ts),
[document](../../../../server/routes/document.routes.ts),
and [project](../../../../server/routes/project.routes.ts) which uses `requireAuth` at router
level and `loadProject` per-route, since `/` and `/seed` have no `:projectId`).

**`mergeParams: true`** is required on the three nested routers because `:projectId` is in the
*mount* path, not the route path.

---

## `server/controllers/` — 5 files, 242 lines

Every exported handler is `asyncHandler(async (req, res) => …)`. None touches the database
directly.

### `auth.controller.ts` — 39 lines

| Name | Signature | Inputs | Output | Side effects | Failure mode | Tested? | Calls |
|---|---|---|---|---|---|---|---|
| `register` | `RequestHandler` | `{ email, password }` | `201 { user }` + `Set-Cookie` | DB write, cookie | propagates `AppError` from the service | API probe (400/409 cases) | `authService.register`, `.issueToken`, `.setAuthCookie` |
| `login` | `RequestHandler` | `{ email, password }` | `200 { user }` + `Set-Cookie` | DB read, cookie | 401 | `SEC-ENUM` | `authService.login`, `.setAuthCookie` |
| `logout` | `RequestHandler` | — | **204**, no body | clears cookie | — | `SEC-LOGOUT-REPLAY` | `authService.clearAuthCookie` |
| `me` | `RequestHandler` | `req.userId` | `200 { user }` | DB read | **401** `Session no longer valid` when the row is gone | `API-002` | `authService.findUserById` |

`me` re-reads the user rather than trusting the token payload, so a deleted account invalidates a
still-valid JWT. That is the only revocation mechanism in the system — there is no token
blacklist, and `SEC-LOGOUT-REPLAY` in the probe exists because a captured cookie **does** still
work after logout until it expires.

### `project.controller.ts` — 51 lines

| Name | Signature | Output | Failure mode | Calls |
|---|---|---|---|---|
| `userIdOf` *(private)* | `(req) => number` | userId | throws `AppError(401)` | — |
| `list` | `RequestHandler` | `{ projects }` | 401 | `projectService.list` |
| `create` | `RequestHandler` | `201 { project }` | 400 blank name | `projectService.create` |
| `createFromSeed` | `RequestHandler` | `201 { project }` | 500 if the seed file is unreadable at import (already crashed by then) | `projectService.createFromSeed` |
| `get` | `RequestHandler` | `{ project, phases, phaseMeta }` | 404 | `projectService.getPhases`, `questionBank.getPhases` |

`create` accepts `verticalId` and `businessModel` in the body
([project.controller.ts:8-12](../../../../server/controllers/project.controller.ts)) and passes
them through unvalidated — neither is checked against `taxonomy.json` or p4q1's options. A
project can therefore be created with any `vertical_id` string, which `benchmark.resolve` will
later report as `Unknown vertical '…'`.

### `answer.controller.ts` — 43 lines

| Name | Signature | Output | Failure mode | Calls |
|---|---|---|---|---|
| `projectOf` *(private)* | `(req) => number` | project id | throws `AppError(404)` | — |
| `list` | `RequestHandler` | `{ answers }` | 404 | `answerService.getAnswers` |
| `save` | `RequestHandler` | `201 { answers, phases }` | 400 missing `questionId`; 400 `null`/`undefined` value; anything `toColumns` throws | `answerService.saveAnswers`, `projectService.getPhases` |

**Accepts two body shapes** (lines 27-29): `{ questionId, value }` or `{ answers: [...] }`. The
single form is normalised into a one-element array, so both take the transactional batch path.
The client only ever sends the single form
([useAnswers.ts:12-13](../../../../client/src/hooks/useAnswers.ts)).

**Returns the recomputed phases with the saved answers** (line 41). That is what lets the
stepper update from one round trip.

### `phase.controller.ts` — 63 lines

| Name | Signature | Output | Failure mode | Calls |
|---|---|---|---|---|
| `projectOf` *(private)* | `(req) => number` | project id | `AppError(404)` | — |
| `list` | `RequestHandler` | `{ phases, phaseMeta }` | 404 | `projectService.getPhases`, `questionBank.getPhases` |
| `get` | `RequestHandler` | `{ phase, meta, questions, answers, canApprove }` | 400 bad phaseNo; **404** phase not found | `parsePhaseNo`, `projectService.getPhases`, `questionBank.getQuestionsForPhase`, `answerService.getAnswersForPhase`, `gate.canApprove` |
| `approve` | `RequestHandler` | `{ approved, nextPhase, phases, project }` | 409 ×3 from the gate | `gate.approvePhase` then re-reads phases and project |
| `revise` | `RequestHandler` | `{ revising, phases, project }` | 404 | `gate.revisePhase` then re-reads |

**`canApprove` is computed server-side on every phase read** (line 38). The UI never re-decides
it — see [03b-frontend-state.md](03b-frontend-state.md) §4. This is the single most important
line in the controller layer for the product's claim.

`approve` and `revise` both re-read `phases` **and** `project` after the mutation and return
them, so one request refreshes the whole gate view.

### `document.controller.ts` — 46 lines

| Name | Signature | Output | Side effects | Failure mode | Calls |
|---|---|---|---|---|---|
| `projectOf` *(private)* | `(req) => number` | project id | — | `AppError(404)` | — |
| `generate` | `RequestHandler` | the full `GenerationOutcome` | **network (LLM + APIs), DB writes, file writes** | 409 if phases are unapproved; the pipeline itself never aborts on a section failure | `generation.generateAll` |
| `list` | `RequestHandler` | `{ documents }` | DB read | 404 | `generation.listDeliverables` |
| `download` | `RequestHandler` | streamed `.docx` | file read | 400 bad id; 404 no `file_path`; **410** row exists but the file is gone | `generation.getDeliverable`, `docx.absolutePathFor`, `fs.stat`, `createReadStream` |

**`download`'s path handling** (lines 32-45): the `id` is validated as a positive integer, then
`getDeliverable(projectId, id)` scopes the row to the project — so a document id belonging to
another project returns 404 from the service's own `WHERE project_id = $1 AND id = $2`. The
filename in `Content-Disposition` is `basename(doc.file_path)`, and `file_path` is written only
by the server as `outputs/<projectId>/<Stem>_v<n>.docx`. `DOC-FILENAME-*` in
[qa-generation-probe.ts:154-158](../../../../server/scripts/qa-generation-probe.ts) asserts the
shape with a regex.

**The 410 is a deliberate third state.** A row whose file has been deleted is neither 200 nor
404 — it says the resource existed and is gone, which matches ADR-007's insert-only model where
rows outlive files.

**`generate` is fully synchronous over HTTP.** It holds the request open for the whole
generation — measured at 126-192 s in the QA sweep. There is no job queue and no polling
endpoint; the client simply waits
([DocumentsPage.tsx:73-96](../../../../client/src/pages/DocumentsPage.tsx)).

---

## Coverage summary for this section

| File | Unit tests | Covered by |
|---|---|---|
| `middleware/error.ts` | **11** | [error.test.ts](../../../../server/middleware/error.test.ts) |
| everything else (23 files) | **0** | `qa:api` (77 probes), `qa:resilience` (17 checks), `test:ui` (Playwright) |

No route, controller, middleware other than `error.ts`, or `db/query.ts` function has a Vitest
unit test. The HTTP probes cover the behaviour; the unit suite does not.

---

*Next: [02b-services-gate-and-domain.md](02b-services-gate-and-domain.md).*
