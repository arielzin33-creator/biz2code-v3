# 02a — Server core (minimal)

**24 files, 700 lines.** Entry, config, data, middleware, routes, controllers.
None of these files carries a header comment (except `config/env.ts`, one line).

## Request path

```
browser ──► vite :5173 ──proxy /api──► express :3001
   helmet ─► cors ─► express.json ─► cookieParser ─► checkOrigin
        /api/health ──► (public)
        /api/ready  ──► (public, hits the DB)
        /api/auth/login|register ──► authLimiter
        ──► auth / project / answer / phase / document routers
              each nested router: requireAuth ─► loadProject
              ──► controller ──► service ──► db/query
        errorHandler (last)
```

---

## `index.ts` — 22 lines

Process entry point. Calls `app.listen(env.PORT)`. A `server.on('error')` handler exits 1 on
`EADDRINUSE` with a message naming `client/vite.config.ts`, and re-throws anything else.
That coupling is real — `vite.config.ts:12` hard-codes `http://localhost:3001`. No test.

## `app.ts` — 80 lines

Builds the Express app. Middleware **order matters**: cookieParser before auth; error handler last.

| # | Line | Middleware |
|---|---|---|
| 0 | 21 | `app.disable('x-powered-by')` |
| 1 | 24-38 | `helmet` — CSP `defaultSrc 'self'`, `frameAncestors 'none'`, `objectSrc 'none'`; hsts prod-only; `crossOriginEmbedderPolicy: false` |
| 2 | 40 | `cors({ origin: env.CLIENT_ORIGIN, credentials: true })` |
| 3 | 41 | `express.json()` |
| 4 | 42 | `cookieParser()` — must precede `requireAuth` |
| 5 | 44 | `checkOrigin` — CSRF layer 2 |
| 6 | 47-55 | `/api/health` (static JSON) · `/api/ready` (`SELECT 1`, 503 on error) |
| 7 | 69-70 | `authLimiter` — path-scoped |
| 8 | 72-77 | five routers |
| 9 | 79 | `errorHandler` |

```ts
app.use('/api/auth',                          authRoutes);
app.use('/api/projects',                      projectRoutes);
app.use('/api/projects/:projectId/answers',   answerRoutes);
app.use('/api/projects/:projectId/phases',    phaseRoutes);
app.use('/api/projects/:projectId/documents', documentRoutes);
```

`/api/ready` calls `db/query` directly — a layer skip. The CSP has no practical effect: Express
serves only JSON and the SPA is served by Vite on another port.

## `config/env.ts` — 32 lines

Loads the **repo-root** `.env` at import (`../../.env`, so `server/.env` is ignored) and throws
on a missing required value.

| Key | Required | Default | Consumers |
|---|---|---|---|
| `NODE_ENV` | no | `'development'` | helmet hsts, cookie `secure` |
| `PORT` | no | `3001` | `index.ts` |
| `DATABASE_URL` | **yes** | — | `db/pool.ts` |
| `JWT_SECRET` | **yes** | — | `auth.service`, `middleware/auth` |
| `GROQ_API_KEY` | **yes** | — | `llm.service.callGroq` |
| `GEMINI_API_KEY` | no | `null` | `llm.service.callGemini` — rung skipped when null |
| `LLM_FEEDBACK_ENABLED` | no | `false` | `llm.service.critiqueAnswers` only |

`GROQ_API_KEY` is required, so **the server will not boot without it** even though nothing calls
a model until generation. Lines 26-28 are blank — where three source API keys were removed; their
replacements are local `null` constants at `sources.service.ts:137-139`.

## `db/pool.ts` — 6 lines

The single `pg.Pool`, `max: 10`. No `idleTimeoutMillis` or `connectionTimeoutMillis`. Connection
errors surface at query time. Unit tests use `test/fakeDb.ts` instead.

## `db/query.ts` — 33 lines — the whole data-access layer

| Name | Signature | Notes |
|---|---|---|
| `query<T>` | `(sql, params?) => Promise<T[]>` | `res.rows as T[]` — an assertion, not a check |
| `queryOne<T>` | `(sql, params?) => Promise<T \| null>` | The one legitimate `null` return |
| `transaction<T>` | `(fn: (q: typeof query) => Promise<T>) => Promise<T>` | `BEGIN`/`COMMIT`/`ROLLBACK`, one dedicated client, `release()` in `finally` |

`transaction` passes the callback a `scoped` function bound to the checked-out client:

```ts
const scoped = async <R>(sql: string, params: unknown[] = []): Promise<R[]> =>
  (await client.query(sql, params)).rows as R[];
const out = await fn(scoped as typeof query);
```

**Hazard:** code inside the callback that imports `query` directly runs *outside* the
transaction. Convention only. All five call sites (`gate.approvePhase`, `answer.saveAnswers`,
`project.create`, `project.createFromSeed`, `generation.generateAll`) use the parameter.

## `types/express.d.ts` — 14 lines

| Declaration | Set by | Read by |
|---|---|---|
| `Request.userId?: number` | `middleware/auth.ts:14` | `project.controller.userIdOf`, `loadProject`, `auth.controller.me` |
| `Request.project?: ProjectRow` | `middleware/project.ts:16` | `projectOf()` in four controllers |

Both optional, so every consumer re-checks. `projectOf` is duplicated once per controller — no
shared helper.

---

## `middleware/` — 7 files, 225 lines

| File | Lines | Export | Behaviour |
|---|---:|---|---|
| `async.ts` | 11 | `asyncHandler` | Forwards a rejected promise to `next`. All 17 controller handlers are wrapped |
| `auth.ts` | 19 | `requireAuth` | Reads `req.cookies.token`, sets `req.userId`. 401 `Not authenticated` with no cookie; 401 `Invalid session` on any `jwt.verify` throw (bare catch — expired and tampered are indistinguishable) |
| `error.ts` | 41 | `AppError`, `errorHandler` | See below — the only unit-tested file here (11 tests) |
| `origin.ts` | 16 | `checkOrigin` | `GET`/`HEAD`/`OPTIONS` pass; **missing `Origin` passes**; anything else must equal `env.CLIENT_ORIGIN`, else 403 |
| `project.ts` | 26 | `loadProject`, `parsePhaseNo` | `loadProject` is promise-chained (not `async`) so its rejection reaches `next` without `asyncHandler`; `parsePhaseNo` throws `AppError(400)` |
| `validate.ts` | 11 | `validateBody(fields)` | **Presence only** — `req.body?.[f] === undefined`. Two call sites: auth routes, project create |
| `error.test.ts` | 101 | — | See [06-testing.md](06-testing.md) |

**`error.ts`'s rule:** a foreign error's self-reported status is trusted **only if 4xx**. A
library claiming 500/503 is downgraded to 500 with a generic body. A 5xx logs the real error
server-side and returns exactly `{ error: 'Internal error' }`; a 4xx never logs. (`DEF-01`.)

**Missing-`Origin` is a deliberate weakening** — server-side callers (probes, curl, Playwright)
send no `Origin`. `SameSite=Lax` is the primary control.

**404-not-403 is the isolation design** — `getOwned` filters on `user_id` in the `WHERE`, so
another user's project is indistinguishable from a nonexistent one.

**Type validation lives in `answer.service.toColumns`, not `validate.ts`**, because
`createFromSeed` inserts directly and would bypass any HTTP-layer validator.

---

## The 19 endpoints

| Method | Path | Chain | Controller | Success | Failures |
|---|---|---|---|---|---|
| GET | `/api/health` | none | inline | 200 | — |
| GET | `/api/ready` | none | inline | 200 | 503 DB down |
| POST | `/api/auth/register` | `authLimiter`, `validateBody(email,password)` | `auth.register` | **201** + cookie | 400, 409 dup, 429 |
| POST | `/api/auth/login` | `authLimiter`, `validateBody(email,password)` | `auth.login` | 200 + cookie | 401 (identical body both causes), 429 |
| POST | `/api/auth/logout` | `requireAuth` | `auth.logout` | **204** | 401 |
| GET | `/api/auth/me` | `requireAuth` | `auth.me` | 200 | 401 |
| GET | `/api/projects` | `requireAuth` | `project.list` | 200 | 401 |
| POST | `/api/projects` | `requireAuth`, `validateBody(name)` | `project.create` | **201** | 400, 401 |
| POST | `/api/projects/seed` | `requireAuth` | `project.createFromSeed` | **201** | 401 |
| GET | `/api/projects/:projectId` | `requireAuth`, `loadProject` | `project.get` | 200 | 400, 401, 404 |
| GET | `…/answers` | `requireAuth`, `loadProject` | `answer.list` | 200 | 400, 401, 404 |
| POST | `…/answers` | `requireAuth`, `loadProject` | `answer.save` | **201** | 400 (type, range, unknown option/question), 401, 404 |
| GET | `…/phases` | `requireAuth`, `loadProject` | `phase.list` | 200 | 400, 401, 404 |
| GET | `…/phases/:phaseNo` | `requireAuth`, `loadProject` | `phase.get` | 200 | 400, 404 |
| POST | `…/phases/:phaseNo/approve` | `requireAuth`, `loadProject` | `phase.approve` | 200 | **409** x3 |
| POST | `…/phases/:phaseNo/revise` | `requireAuth`, `loadProject` | `phase.revise` | 200 | 400, 404 |
| POST | `…/documents/generate` | `requireAuth`, `loadProject` | `document.generate` | 200 | **409** phases unapproved |
| GET | `…/documents` | `requireAuth`, `loadProject` | `document.list` | 200 | 400, 401, 404 |
| GET | `…/documents/:id/download` | `requireAuth`, `loadProject` | `document.download` | 200 + stream | 400, 404 no `file_path`, **410** file gone |

**The pattern that makes an unauthenticated route impossible by omission** — each nested router
declares the chain once at router level, so a route added later inherits it:

```ts
export const answerRoutes = Router({ mergeParams: true });
answerRoutes.use(requireAuth, loadProject);
```

`mergeParams: true` is required on the three nested routers because `:projectId` is in the
*mount* path. `project.routes` uses `requireAuth` at router level and `loadProject` per-route,
since `/` and `/seed` have no `:projectId`.

---

## `controllers/` — 5 files, 242 lines

Every handler is `asyncHandler(async (req, res) => …)`. None touches the database directly.

**`auth.controller.ts` (39)** — `register` (201 + cookie) · `login` (200 + cookie) ·
`logout` (204) · `me`. `me` **re-reads the user** rather than trusting the token payload, so a
deleted account invalidates a still-valid JWT. That is the only revocation mechanism — no token
blacklist, and a captured cookie still works after logout until it expires.

**`project.controller.ts` (51)** — `list` · `create` (201) · `createFromSeed` (201) ·
`get` → `{ project, phases, phaseMeta }`. `create` passes `verticalId` and `businessModel`
through **unvalidated** — neither is checked against `taxonomy.json` or p4q1's options, so
`benchmark.resolve` may later report `Unknown vertical '…'`.

**`answer.controller.ts` (43)** — `list` · `save` → `201 { answers, phases }`.
Accepts two body shapes: `{ questionId, value }` or `{ answers: [...] }`; the single form is
normalised into a one-element array so both take the transactional batch path. The client only
sends the single form. **Returns the recomputed phases with the answers**, so the stepper updates
in one round trip.

**`phase.controller.ts` (63)** — `list` · `get` → `{ phase, meta, questions, answers,
canApprove }` · `approve` → `{ approved, nextPhase, phases, project }` · `revise`.
**`canApprove` is computed server-side on every phase read** — the UI never re-decides it.
`approve` and `revise` both re-read phases *and* project after the mutation.

**`document.controller.ts` (46)** — `generate` (network + DB + file writes) · `list` ·
`download`. `download` validates `id` as a positive integer, and `getDeliverable` scopes the row
with `WHERE project_id = $1 AND id = $2`, so another project's document id returns 404.
`Content-Disposition` uses `basename(file_path)`, written only by the server as
`outputs/<projectId>/<Stem>_v<n>.docx`.

**The 410 is a deliberate third state** — a row whose file was deleted is neither 200 nor 404.

**`generate` is fully synchronous over HTTP** — it holds the request open for the whole run,
measured at 126-192 s. No job queue, no polling endpoint; the client just waits.

---

## Coverage

| File | Unit tests |
|---|---|
| `middleware/error.ts` | **11** |
| everything else (23 files) | **0** — covered by `qa:api` (77), `qa:resilience` (17), `test:ui` |
