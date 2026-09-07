# 02b — Services: the gate and the domain

Phase 3, backend, part 2. Six files, **644 lines**: `gate.service.ts` (117),
`questionBank.service.ts` (100), `answer.service.ts` (170), `auth.service.ts` (96),
`project.service.ts` (119), `competitorTerms.ts` (42).

These are the modules that make the product a gatekeeper. The numbers layer is
[02c](02c-services-numbers.md); the sources layer is [02d](02d-services-data-sources.md).

---

## `server/services/questionBank.service.ts` — 100 lines

**Purpose.** Read `data/question-bank.json` once at import, validate it, and index it three ways.
Every other module treats this as the authority on what a question is.

**Its own header (present):** `/* Loads and indexes question-bank.json. */`

**[sibling] header:** *"PURPOSE Loads and indexes question-bank.json; validates it at boot."*

**Related ADR:** ADR-003, ADR-006.

### Types

| Name | Shape | Notes |
|---|---|---|
| `Question` | `questionId, phaseId, order, text, type, required, inDemoSet, helpText, feeds, options?, placeholder?, numeric?` | `type` is the 5-member union. `feeds: string[]` is loaded but **never read by any code** — see below |
| `PhaseMeta` | `phaseId, order, name, description, primaryDocument` | `primaryDocument` is likewise never read by server code |
| `SegmentFilter` | `kind, indicator, note?` | `kind` is `'none' \| 'percent_of_population' \| 'complement_of_percent' \| 'absolute_count'` |
| `Bank` *(private)* | `version, phases, questions, derivationLayer?` | The loader reads only these four of the file's nine top-level keys |

### Functions

| Name | Signature | Inputs | Output | Side effects | Failure mode | Tested? | Calls / called by |
|---|---|---|---|---|---|---|---|
| `fail` *(private)* | `(reason: string) => never` | message | never returns | none | **throws** `question-bank.json is invalid — <reason>` | indirectly | used 8× in `load()` and once in `phaseNoOf` |
| `load` *(private)* | `() => Bank` | the JSON file | validated bank | **file read** at module scope | throws at import — the process dies before `listen` | Every test that imports a service exercises the happy path | called once, line 71 |
| `PHASE_COUNT` | `const number` | — | `bank.phases.length` (**4**) | — | — | used throughout `gate.service.test` | `gate.service`, `project.service`, `middleware/project`, `generation.service`, `rehearse`, both QA probes |
| `getPhases` | `() => PhaseMeta[]` | — | the raw array | none | cannot fail | via controller probes | `phase.controller`, `project.controller`, `generation.assertAllPhasesApproved`, `prompts/context.renderAnswers` |
| `getSegmentFilters` | `() => Record<string, SegmentFilter>` | — | `bank.derivationLayer?.segments ?? {}` | none | returns `{}` if the key is missing | `derivation.service.test` uses hand-built segments, not this | `derivationInputs.resolveSegments` |
| `getQuestionsForPhase` | `(phaseNo: number) => Question[]` | 1..4 | sorted by `order`; `[]` for an unknown phase | none | **returns `[]`, never throws** — a typo'd phase number silently yields no required questions | `answer.service.test` `it('every question in the bank can be answered')`; `gate.service.test` throughout | `gate.canApprove`, `phase.controller.get`, `qa-generation-probe` |
| `getQuestion` | `(questionId: string) => Question` | an id | the question | none | **throws** `AppError('Unknown question: X', 404)` | `answer.service.test:127` `it('rejects an unknown question id before any value is considered')` | `answer.service.saveAnswer/saveAnswers`, `phaseNoOf`, `prompts/context.renderAnswers` |
| `phaseNoOf` | `(questionId: string) => number` | an id | 1..4 | none | throws `AppError(404)` via `getQuestion`; `fail(…)` if the phase cannot be resolved | indirectly, in every answer test | `answer.service`, `project.service.createFromSeed` |

### The three indexes built at import (lines 73-82)

```ts
const phaseNoByPhaseId = new Map(bank.phases.map((p) => [p.phaseId, p.order]));
const byId             = new Map(bank.questions.map((q) => [q.questionId, q]));
const byPhase          = new Map<number, Question[]>();   // then sorted by q.order
```

Everything downstream is a `Map` lookup, so the file is parsed exactly once per process.

### What `load()` actually validates (lines 52-67)

| Check | Line | Message |
|---|---|---|
| `phases` is a non-empty array | 52 | `no phases` |
| `questions` is a non-empty array | 53 | `no questions` |
| every question has a `questionId` | 59 | `a question has no questionId` |
| no duplicate `questionId` | 60 | `duplicate questionId X` |
| `phaseId` exists in `phases` | 62 | `X points at unknown phase Y` |
| `select`/`multiselect` has non-empty `options` | 63-64 | `X is select but has no options` |
| `number`/`range` declares `numeric` | 65-66 | `X is number but declares no numeric bounds` |

**What it does NOT validate**, verified by reading all 18 lines of the loop:

- `order` is not checked for uniqueness or presence. Two questions in one phase with the same
  `order` would sort non-deterministically.
- `required` is not checked for presence; `undefined` is falsy, so a question missing the key is
  silently optional and can never block a gate.
- `feeds` is not checked at all — and **nothing reads it**. `grep -rn "\.feeds" server client`
  returns only the type declarations in
  [questionBank.service.ts:17](../../../../server/services/questionBank.service.ts) and
  [client/src/lib/types.ts:48](../../../../client/src/lib/types.ts). Every one of the 23
  questions carries a `feeds` array; no code path consumes it. WORK_PLAN's *"every question
  carries a `feeds` array, so the mechanism exists"* is accurate about the data and not about
  the code — the array is inert.
- `numeric.min <= numeric.max` is not checked.
- `maxSelections`, which appears on multiselect questions in the JSON, is not in the `Question`
  interface and is not read anywhere.

**Purpose not evident from source:** `PhaseMeta.primaryDocument` is loaded and shipped to the
client in `phaseMeta`, but no server or client code branches on it. Recommend confirming with
the author whether it is intended for a future per-phase generation mode (ADR-010's rejected
alternative).

---

## `server/services/gate.service.ts` — 117 lines — **the product**

**Purpose.** The phase state machine, and the only module that transitions phase state.

**[sibling] header** — quoted at length because it is the clearest statement of the invariant and
it is absent from this checkout:

> *PURPOSE   THE GATE. The only module allowed to mutate phases.status or projects.current_phase.*
> *WHY       This is the product. Every other module is UI or plumbing around this state machine.
> Centralising mutation here is what makes the invariant enforceable and testable.*
> *DEPENDS   db/query.ts, questionBank.service.ts*
> *ADR       ADR-003*

**Note on this file:** it begins with **seven** blank lines (lines 1-7) — the largest such gap in
the repository, matching the two-block header the sibling carries.

**Related ADR:** ADR-003; the invariants are the Gated Specification Method §4.3.

### Types

| Name | Shape |
|---|---|
| `PhaseStatus` | `'pending' \| 'in_progress' \| 'awaiting_approval' \| 'approved' \| 'revising'` — the same five as the `CHECK` in `001_init.sql` and as `client/src/lib/types.ts` |

### Functions

| Name | Signature | Inputs | Output | Side effects | Failure mode | Tested? | Calls / called by |
|---|---|---|---|---|---|---|---|
| `canApprove` | `(projectId: number, phaseNo: number) => Promise<boolean>` | ids | boolean | **DB read** (1 query) | none — returns `false`, never throws | 3 tests: `it('is false when a required question is unanswered')`, `it('is true once every required question is answered')`, `it('ignores optional questions')` ([gate.service.test.ts:28-38](../../../../server/services/gate.service.test.ts)) | Called by `refreshPhaseStatus`, `approvePhase`, `phase.controller.get` |
| `refreshPhaseStatus` | `(projectId, phaseNo) => Promise<PhaseStatus>` | ids | the resulting status | **DB read + conditional write** | **throws** `AppError('Phase not found', 404)` | 4 tests, [gate.service.test.ts:169-185](../../../../server/services/gate.service.test.ts) | Called by `answer.saveAnswer`, `answer.saveAnswers`, `project.createFromSeed` |
| `approvePhase` | `(projectId, phaseNo) => Promise<{approved: number; nextPhase: number \| null}>` | ids | the transition | **DB: 3 reads + a 3-statement transaction** | 404 project; **409** ×3 | 6 tests, [gate.service.test.ts:48-92](../../../../server/services/gate.service.test.ts) | `phase.controller.approve`, `rehearse`, both QA probes |
| `revisePhase` | `(projectId, phaseNo) => Promise<void>` | ids | — | **DB: 2 writes** | **throws** `AppError('Phase not found', 404)` when no row updates | 4 tests, [gate.service.test.ts:93-117](../../../../server/services/gate.service.test.ts) | `phase.controller.revise`, `rehearse` |

### `canApprove` — completeness, counted not inferred

```ts
const required = getQuestionsForPhase(phaseNo).filter((q) => q.required);
const answered = await query<{ question_id: string }>(
  'SELECT question_id FROM answers WHERE project_id = $1 AND phase_no = $2', [projectId, phaseNo]);
const have = new Set(answered.map((a) => a.question_id));
return required.every((q) => have.has(q.questionId));
```

The set of required questions comes from the **bank**, the set of answers from the **database**,
and the comparison is by id. Nothing is cached and nothing is derived from a counter — which is
why editing the bank changes the gate immediately on restart.

**One consequence worth stating.** `getQuestionsForPhase` returns `[]` for an unknown phase, and
`[].every(...)` is `true`. So `canApprove(projectId, 99)` returns `true`. It is unreachable
through HTTP because `parsePhaseNo` rejects anything outside 1..`PHASE_COUNT`
([middleware/project.ts:23](../../../../server/middleware/project.ts)) and `approvePhase`'s own
guards would reject it, but the function itself has no domain check.

### `refreshPhaseStatus` — the only automatic transition

```ts
if (phase.status === 'approved') return phase.status;   // line 34 — never reopens

const complete = await canApprove(projectId, phaseNo);
const next: PhaseStatus = complete
  ? 'awaiting_approval'
  : (phase.status === 'pending' ? 'pending' : 'in_progress');
```

Two rules in four lines: an approved phase is immutable here, and a `pending` phase stays
`pending` even if its answers are complete — because completeness does not unlock a phase,
approval of the previous one does.

The write is conditional (`if (next !== phase.status)`, line 41), so a no-op save issues one
`SELECT` and no `UPDATE`.

**`revising` cannot be produced by this function.** Neither branch emits it, so the state
survives only until the first answer save after `revisePhase`. See
[01-architecture.md](01-architecture.md) §2.7.

### `approvePhase` — four guards, then one transaction

Guards, in order (lines 50-67): project exists → `phaseNo <= current_phase` → no earlier phase
with `status <> 'approved'` → `canApprove`. Each throws a distinct message, which is what lets
the UI say *why* rather than "cannot approve".

The transaction (lines 70-101) is four statements:

1. `UPDATE phases SET status = 'approved', approved_at = now()` — the `approved_needs_timestamp`
   CHECK makes the timestamp non-optional.
2. `UPDATE projects SET current_phase = GREATEST(current_phase, $2)` — **the non-rewinding
   advance**. This is the line WORK_PLAN Day 2 identifies as the scaffold's bug fix.
3. `UPDATE phases SET status = 'in_progress' … AND status = 'pending'` — opens the next phase
   *only if it has never been opened*, so re-approving a revised phase 2 on a project at phase 4
   does not reset phase 3.
4. `UPDATE projects SET status = CASE WHEN (SELECT count(*) … = 'approved') = $2 THEN 'complete'
   ELSE 'in_progress' END … WHERE id = $1 AND status <> 'archived'` — completeness by count, and
   an archived project is never revived.

Statements 2 and 3 are skipped entirely when `phaseNo === PHASE_COUNT` (`nextPhase === null`).

**The two tests that prove the demo path** —
[gate.service.test.ts:124,143](../../../../server/services/gate.service.test.ts):
`it('re-approves the revised phase without rewinding the project')` and
`it('completes the project on the re-approval, not only on phase 4')`. Together they cover the
exact sequence the Master Plan's demo script performs on stage.

### `revisePhase` — two statements, no transaction

```ts
UPDATE phases SET status = 'revising', approved_at = NULL
  WHERE project_id = $1 AND phase_no = $2 RETURNING phase_no
```

`RETURNING` is how the 404 is detected — `rows.length === 0` means no such phase. Then a second
statement demotes a `complete` project back to `in_progress`.

**These two statements are not in a transaction.** A crash between them leaves a project marked
`complete` with a `revising` phase. `DATA-NO-IMPOSSIBLE-STATE` in
[qa-resilience-probe.ts:133](../../../../server/scripts/qa-resilience-probe.ts) checks for
impossible states after a concurrency run and passes, so the window has not been observed to
open — but the guarantee is by narrowness, not by construction. `approvePhase` uses a
transaction for the equivalent multi-statement change; `revisePhase` does not.

---

## `server/services/answer.service.ts` — 170 lines

**Purpose.** Validate a value against its question's declared type and bounds, then upsert it,
then let the gate recompute.

**Its own header (present):** `/* Upserts answers, typed by question kind. */`

**Related ADR:** ADR-006 (no FK on `question_id`).

### Types

| Name | Shape | Note |
|---|---|---|
| `AnswerRow` | `question_id, phase_no, value_text, value_number: string \| null, value_json, answered_at` | `value_number` is typed **`string`** — the honest reflection of `node-pg`'s NUMERIC handling |
| `RangeValue` | `{ min: number; max: number }` | v3.0 addition |
| `AnswerValue` | `string \| number \| string[] \| RangeValue` | the public input union |
| `Columns` *(private)* | `{ valueText, valueNumber, valueJson: string \| null }` | `valueJson` is a **pre-stringified** JSON string, not an object |

### Functions

| Name | Signature | Inputs | Output | Side effects | Failure mode | Tested? | Calls / called by |
|---|---|---|---|---|---|---|---|
| `toColumns` | `(question: Question, value: AnswerValue) => Columns` | question + raw value | one of three columns filled | **none — pure** | **throws** `AppError(400)` with a per-type message; `AppError(500)` on an unknown type | **21 tests**, the whole of [answer.service.test.ts](../../../../server/services/answer.service.test.ts) | called by `saveAnswer`, `saveAnswers` |
| `saveAnswer` | `(projectId, questionId, value) => Promise<AnswerRow>` | — | the stored row | **DB upsert + `refreshPhaseStatus`** | propagates `toColumns`; `AppError(500)` if the upsert returns nothing | no direct test (the batch form is used everywhere) | `getQuestion`, `phaseNoOf`, `toColumns`, `query`, `refreshPhaseStatus` |
| `saveAnswers` | `(projectId, entries) => Promise<AnswerRow[]>` | batch | stored rows | **DB transaction + one `refreshPhaseStatus` per distinct phase** | 400 on an empty array; validation happens **before** the transaction opens | indirectly, via `gate.service.test` fixtures and every probe | `answer.controller.save`, `rehearse`, `qa-generation-probe` |
| `getAnswers` | `(projectId) => Promise<AnswerRow[]>` | id | all answers, ordered `phase_no, question_id` | DB read | none | — | `answer.controller.list`, `generation.generateAll`, `rehearse` |
| `getAnswersForPhase` | `(projectId, phaseNo) => Promise<AnswerRow[]>` | ids | ordered `question_id` | DB read | none | — | `phase.controller.get` |

### `toColumns` — the last line of defence before the numbers

This is the function the Coding Guide **[sibling]** calls *"the last line before the calculation
layer"*. It is an exhaustive `switch` with no `default` reachable for a valid type — the
`default` at line 90 throws a 500, which is only possible if the bank declares a type the union
does not know.

| Case | Column | Validation | Error message |
|---|---|---|---|
| `text` | `value_text` | must be a string; trimmed; non-empty after trim | `X expects text` / `X cannot be blank` |
| `select` | `value_text` | must be a string **and** in `question.options` | `"v" is not an option for X` |
| `multiselect` | `value_json` | must be a non-empty array; every member in `options`; **deduplicated** | `X needs at least one option` / `Not options for X: a, b` |
| `number` | `value_number` | coerced via `Number()`; rejects boolean and array explicitly; `Number.isFinite`; within `numeric.min..max` | `X expects a number` / `X must be between A and B unit` |
| `range` | `value_json` | must be a non-array object; both bounds finite; **`min <= max`**; both within `numeric` bounds | `X: the lower figure must not exceed the upper one` / `X: the lower figure must be between A and B unit` |

**Three details that each exist because of a specific failure:**

1. **`typeof value === 'boolean'` is rejected before `Number.isFinite`** (line 56). `Number(true)`
   is `1`, so without the explicit check a boolean would store as a valid answer. Test:
   `it('refuses a boolean, which Number() would otherwise coerce to 0 or 1')`.
2. **`JSON.stringify` is applied inside `toColumns`, not left to the driver** (lines 51, 87).
   Coding Guide §2.3 **[sibling]**: *"node-pg turns a JS array into `{a,b,c}` — a Postgres array
   literal. JSONB will not accept it."*
3. **`select` is case-sensitive** — test
   `it('is case-sensitive, because the value is used as a key downstream')`. The p4q1 answer
   string is matched exactly against `B2B_MODEL` in `derivation.service`, so a case-folded match
   would silently route a B2B project into the consumer funnel.

### `saveAnswers` — validate-then-transact

Lines 126-129 validate **every** entry before line 131 opens the transaction. So a batch with one
bad value fails atomically without ever touching the database.

`refreshPhaseStatus` is called **after** the transaction commits, once per distinct phase
(lines 151-153). It is deliberately outside: the gate's read must see committed rows.

**A subtle asymmetry.** `saveAnswer` (singular) calls `refreshPhaseStatus` *inside* its own flow
but not inside a transaction (line 116), while `saveAnswers` batches. Both are correct; they are
simply different shapes for the same guarantee.

### The upsert

Identical SQL in both functions (lines 103-110 and 135-142) — a genuine duplication of ~8 lines:

```sql
INSERT INTO answers (project_id, question_id, phase_no, value_text, value_number, value_json)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (project_id, question_id) DO UPDATE
  SET value_text = EXCLUDED.value_text, value_number = EXCLUDED.value_number,
      value_json = EXCLUDED.value_json, answered_at = now()
RETURNING question_id, phase_no, value_text, value_number, value_json, answered_at
```

Uniqueness is enforced by the schema, so two concurrent saves cannot produce two rows —
asserted live by `RACE-ANSWER-UPSERT` in
[qa-resilience-probe.ts:126](../../../../server/scripts/qa-resilience-probe.ts).

**Note:** the upsert **does not** update `phase_no`. If a question ever moved phase, existing
rows would keep the old value and `canApprove` would stop seeing them.

---

## `server/services/auth.service.ts` — 96 lines

**Purpose.** Registration, login, JWT issuance, and the cookie's flags.

**[sibling] header:** *"Register, login, token issuance."*

**Related ADR:** ADR-005.

### Constants

| Name | Value | Why |
|---|---|---|
| `BCRYPT_ROUNDS` | `10` | |
| `TOKEN_TTL_SECONDS` | `604800` (7 days) | Applied to both the JWT `expiresIn` and the cookie `maxAge` |
| `MIN_PASSWORD_LENGTH` | `8` | |
| `COOKIE_NAME` | `'token'` | **Exported** — read by `middleware/auth` indirectly (`req.cookies.token`) and by the QA probe |
| `DUMMY_HASH` | `bcrypt.hashSync('no-such-user', 10)` at import | The timing-attack defence |
| `cookieOptions` *(private)* | `{ httpOnly: true, sameSite: 'lax', secure: NODE_ENV === 'production', path: '/' }` | |

### Functions

| Name | Signature | Inputs | Output | Side effects | Failure mode | Tested? | Calls / called by |
|---|---|---|---|---|---|---|---|
| `normaliseEmail` *(private)* | `(email: string) => string` | — | trimmed, lower-cased | none | — | indirectly | `register`, `login` |
| `register` | `(email, password) => Promise<PublicUser>` | credentials | user without `password_hash` | **DB insert**, bcrypt hash | `AppError(400)` bad email; `AppError(400)` short password; **`AppError(409)`** on PG `23505`; `AppError(500)` if `RETURNING` is empty | `API-004/005/006` in the probe; no unit test | `auth.controller.register`, `rehearse`, both generation probes |
| `login` | `(email, password) => Promise<{user, token}>` | credentials | user + JWT | DB read, bcrypt compare | **`AppError(401)`** `Invalid email or password` — one message for both causes | `SEC-ENUM`; no unit test | `auth.controller.login` |
| `issueToken` | `(userId: number) => string` | id | signed JWT | none | throws if `JWT_SECRET` is unusable | `SEC-JWT-FORGED`, `SEC-JWT-ALG-NONE` | `login`, `auth.controller.register` |
| `setAuthCookie` | `(res, token) => void` | — | — | writes `Set-Cookie` | — | the cookie-flag group in the probe | both controllers |
| `clearAuthCookie` | `(res) => void` | — | — | writes an expiring `Set-Cookie` | — | `SEC-LOGOUT-REPLAY` | `auth.controller.logout` |
| `findUserById` | `(id) => Promise<PublicUser \| null>` | id | user or `null` | DB read | **returns `null`** — the legitimate `queryOne` case | `API-002` | `auth.controller.me` |

### The two security properties, in code

**Email enumeration is closed** (lines 69-76):

```ts
const row = await queryOne<UserRow>('SELECT … FROM users WHERE email = $1', [normaliseEmail(email)]);
const passwordMatches = await bcrypt.compare(password, row?.password_hash ?? DUMMY_HASH);
if (!row || !passwordMatches) throw new AppError('Invalid email or password', 401);
```

`bcrypt.compare` runs unconditionally against `DUMMY_HASH` when there is no row, so both paths
cost one bcrypt round. The single error message means status **and** body are identical —
which is exactly what `SEC-ENUM` asserts
([qa-api-probe.ts:111-117](../../../../server/scripts/qa-api-probe.ts)).

**The hash never leaves the service** (line 78):

```ts
const { password_hash: _hash, ...user } = row;
```

`UserRow extends PublicUser` with `password_hash`, and the destructure drops it. Every other
query names its columns (`RETURNING id, email, created_at`; `SELECT id, email, created_at`), so
there is no path that could return it. `SEC-NO-HASH` asserts it over HTTP.

**Email validation is a single regex** (line 42): `/^[^@\s]+@[^@\s]+\.[^@\s]+$/`. Deliberately
loose — ADR-005 scopes this to a local, single-user tool.

**No test file exists for this service.** Its behaviour is covered only by `qa:api`.

---

## `server/services/project.service.ts` — 119 lines

**Purpose.** Project lifecycle, phase-row creation, and loading the seed project.

**Its own header (present):** `/* Create / list projects; loads the seed project. */`

**Related ADR:** ADR-005 (ownership), ADR-006 (seed as authored content).

### Types

| Name | Shape | Note |
|---|---|---|
| `ProjectRow` | 10 fields mirroring the table | Also the type of `req.project` |
| `PhaseRow` | `phase_no, status, approved_at` | A projection, not the whole row |
| `NewProject` *(private)* | `name, verticalId?, businessModel?, isSeed?` | |
| `SeedAnswer` *(private)* | `questionId, type, valueText, valueNumber, valueJson: string[] \| null, clearOnDemo` | **`valueJson` is mistyped** — see below |
| `SeedFile` *(private)* | `{ project, answers }` | Reads only 2 of the seed file's 6 top-level keys |

### Functions

| Name | Signature | Inputs | Output | Side effects | Failure mode | Tested? | Calls / called by |
|---|---|---|---|---|---|---|---|
| `create` | `(userId, input) => Promise<ProjectRow>` | — | the row | **DB transaction**: insert project + 4 phase rows via `generate_series` | `AppError(400)` blank name; `AppError(500)` if `RETURNING` is empty | `API-008`; no unit test | `project.controller.create`, `createFromSeed` |
| `list` | `(userId) => Promise<ProjectRow[]>` | id | newest first | DB read | none | `SEC-LIST-ISOLATION` | `project.controller.list` |
| `getOwned` | `(projectId, userId) => Promise<ProjectRow>` | ids | the row | DB read | **`AppError(404)`** — never 403 | the ownership group in `qa:api` | `middleware/project.loadProject` |
| `getById` | `(projectId) => Promise<ProjectRow>` | id | the row | DB read | `AppError(404)` | — | `phase.controller.approve/revise` — **note: no ownership check**, safe only because `loadProject` already ran |
| `getPhases` | `(projectId) => Promise<PhaseRow[]>` | id | ordered by `phase_no` | DB read | none | — | 4 controllers |
| `createFromSeed` | `(userId) => Promise<ProjectRow>` | id | the row | **DB: `create` + a transaction of N inserts + 4 × `refreshPhaseStatus`** | propagates | `API-007`; no unit test | `project.controller.createFromSeed`, `rehearse`, `qa-generation-probe` |

### `create` — phase rows from `generate_series`

```sql
INSERT INTO phases (project_id, phase_no, status)
SELECT $1, n, CASE WHEN n = 1 THEN 'in_progress' ELSE 'pending' END
FROM generate_series(1, $2) AS n
```

`PHASE_COUNT` is passed as `$2`, so the number of phases is driven by the bank, not hard-coded.
**This is the one place outside `gate.service` that writes `phases.status`** — see
[01-architecture.md](01-architecture.md) §2.5 for why the single-writer claim needs the
creation/transition distinction.

### `createFromSeed` — and the type that does not describe the data

```ts
const prefill = seed.answers.filter((a) => !a.clearOnDemo);
```

**Verified counts.** The seed file holds 23 answers; `clearOnDemo` is `true` for exactly five —
`p1q1, p1q2, p2q6, p3q1, p4q8` — matching the bank's `demoSet.questionIds` exactly. So
**18** answers are pre-filled, not the 19 that
[README.md](../../../../README.md) and [INSTALL.md](../../../../INSTALL.md) claim, and not out of
24 questions but out of 23.

```bash
node -e "const s=require('./data/seed-project.json');
         console.log(s.answers.length, s.answers.filter(a=>!a.clearOnDemo).length)"
# → 23 18
```

**The `valueJson` type is wrong** ([project.service.ts:82](../../../../server/services/project.service.ts)):

```ts
valueJson: string[] | null;
```

`p4q8`'s seed value is `{"min":8000,"max":270000}` — an object. The insert at line 111 does
`a.valueJson === null ? null : JSON.stringify(a.valueJson)`, which stringifies an object
perfectly well, so **nothing breaks at runtime**; the declared type simply does not describe the
file. This is the same defect the
[QA assessment](../qa/QA-Assessment-2026-08-24.md) §6 fixed in the Playwright `SeedFile`
interface — it was not fixed here.

**`createFromSeed` bypasses `answer.service` entirely** (lines 104-114), inserting straight into
`answers` with no call to `toColumns`. That is the reason WORK_PLAN gives for putting validation
in the service rather than in HTTP middleware — but the consequence is that **the seed file's
values are never validated against the bank**. A seed answer with an option string that no
longer exists in `question-bank.json` would be inserted silently and would only surface when
`select`-typed logic tried to match it.

`phaseNoOf(a.questionId)` (line 109) is the one bank check that does run — it throws
`AppError(404)` for an unknown id, so an id that no longer exists **would** fail loudly. All 23
seed ids currently resolve (verified against the bank).

---

## `server/services/competitorTerms.ts` — 42 lines

**Purpose.** Turn one prose answer (`p2q4`) into at most three App Store search terms. Pure, so
that `fetch-seed-data.ts` and the live pipeline derive identical cache keys.

**[sibling] header:** *"Turns the p2q4 answer into App Store search terms."*

**Related ADR:** ADR-009 (iTunes is an approved source).

### Constants

| Name | Value | Purpose |
|---|---|---|
| `NON_ANSWERS` *(private)* | `nothing, none, no one, nobody, n/a, na, unknown` | An answer meaning "no competitor" must not become a search term |
| `DESCRIPTIVE_OPENERS` *(private)* | `/^(individual\|various\|several\|some\|other\|generic\|custom\|in-house\|internal\|manual\|paper\|word of mouth)\b/i` | Drops descriptions of *what people do* rather than named products |
| `MAX_TERMS` | `3` — **exported** | Read by the test; not read by any production caller |
| `MAX_TERM_LENGTH` *(private)* | `40` | A fragment longer than this is a sentence, not a product name |

### Functions

| Name | Signature | Inputs | Output | Side effects | Failure mode | Tested? | Calls / called by |
|---|---|---|---|---|---|---|---|
| `competitorSearchTerms` | `(raw: string \| null \| undefined) => string[]` | the p2q4 answer | 0-3 terms | **none — pure** | never throws; returns `[]` | **10 tests**, all of [competitorTerms.test.ts](../../../../server/services/competitorTerms.test.ts) | `generation.gatherExternal`, `scripts/fetch-seed-data.ts` |

### The pipeline, and what it does to the seed answer

1. `raw.replace(/\([^)]*\)/g, ' ')` — parenthetical asides removed **first**, so
   `"Google Maps (indoor coverage is partial…)"` becomes `"Google Maps "`.
2. `split(/[,;\n]|\band\b|\bor\b/i)` — commas, semicolons, newlines, and the words *and* / *or*.
3. Per fragment: strip trailing `.!?`, strip a leading `and`/`or`, trim.
4. Drop if empty, in `NON_ANSWERS`, matching `DESCRIPTIVE_OPENERS`, or over 40 characters.
5. Deduplicate case-insensitively (keeping the first casing).
6. Stop at 3.

**Traced on the real seed answer:**

> `"Google Maps (indoor coverage is partial and venue-dependent), Waze (outdoor only), and individual mall-operator apps (one app per venue, low install rates)."`

→ asides removed → `"Google Maps , Waze , and individual mall-operator apps ."`
→ split → `["Google Maps ", " Waze ", " ", " individual mall-operator apps ."]`
→ fragment 3 is empty; fragment 4 starts with `individual` and is dropped by
`DESCRIPTIVE_OPENERS`
→ **result: `["Google Maps", "Waze"]`**

Which is exactly the two iTunes cache keys the seed file carries (`itunes|Google Maps/IL`,
`itunes|Waze/IL`). The parser and the pre-cache agree because both call this function —
[fetch-seed-data.ts:75](../../../../server/scripts/fetch-seed-data.ts) imports it. That shared
import is the fix WORK_PLAN Day 6 item 2 describes.

**Determinism is asserted**, not assumed:
`it('is deterministic — the same answer always yields the same keys')`
([competitorTerms.test.ts:56](../../../../server/services/competitorTerms.test.ts)). It matters
because the output becomes a database cache key.

**A known weakness this function cannot fix.** Master Plan §10: *"The competitor search is noisy.
Searching 'Google Maps, Waze' returns same-publisher apps."* Confirmed as out of scope here —
`competitorSearchTerms` produces correct terms; the noise is in what the iTunes API returns for
them, and nothing filters the results by publisher
([generation.service.ts:116-124](../../../../server/services/generation.service.ts) dedupes by
`trackName` only).

---

## Coverage summary for this section

| File | Lines | Unit tests | Untested exports |
|---|---|---|---|
| `gate.service.ts` | 117 | **20** | none — all 4 exported functions covered |
| `answer.service.ts` | 170 | **21** | `saveAnswer` (singular), `getAnswers`, `getAnswersForPhase` — no direct test |
| `competitorTerms.ts` | 42 | **10** | none |
| `questionBank.service.ts` | 100 | 0 direct | all 6 exports — exercised indirectly by `answer.service.test` and `gate.service.test` |
| `auth.service.ts` | 96 | **0** | all 7 exports — HTTP probe only |
| `project.service.ts` | 119 | **0** | all 6 exports — HTTP probe only |

---

*Next: [02c-services-numbers.md](02c-services-numbers.md) — calculation, derivation, and the
three unreachable code paths.*
