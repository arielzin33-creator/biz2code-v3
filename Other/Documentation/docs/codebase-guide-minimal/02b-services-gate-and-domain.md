# 02b — Services: the gate and the domain (minimal)

Six files, **644 lines**: `gate.service.ts` (117), `questionBank.service.ts` (100),
`answer.service.ts` (170), `auth.service.ts` (96), `project.service.ts` (119),
`competitorTerms.ts` (42).

---

## `questionBank.service.ts` — 100 lines

Reads `data/question-bank.json` once at import, validates it, indexes it three ways.

**Types** — `Question` (`questionId, phaseId, order, text, type, required, inDemoSet, helpText,
feeds, options?, placeholder?, numeric?`) · `PhaseMeta` (`phaseId, order, name, description,
primaryDocument`) · `SegmentFilter` (`kind, indicator, note?`) · `Bank` (reads 4 of the file's 9
top-level keys).

**Exports**

| Name | Signature | Notes |
|---|---|---|
| `PHASE_COUNT` | `number` | `bank.phases.length` = **4** |
| `getPhases` | `() => PhaseMeta[]` | Cannot fail |
| `getSegmentFilters` | `() => Record<string, SegmentFilter>` | `{}` if the key is missing |
| `getQuestionsForPhase` | `(phaseNo) => Question[]` | Sorted by `order`; **`[]` for an unknown phase, never throws** |
| `getQuestion` | `(questionId) => Question` | Throws `AppError('Unknown question: X', 404)` |
| `phaseNoOf` | `(questionId) => number` | 1..4; throws via `getQuestion` |

**Three indexes built at import** (lines 73-82) — everything downstream is a `Map` lookup:

```ts
const phaseNoByPhaseId = new Map(bank.phases.map((p) => [p.phaseId, p.order]));
const byId             = new Map(bank.questions.map((q) => [q.questionId, q]));
const byPhase          = new Map<number, Question[]>();   // then sorted by q.order
```

**`load()` validates** (52-67): non-empty `phases` and `questions`; every question has a
`questionId`; no duplicates; `phaseId` exists; `select`/`multiselect` has non-empty `options`;
`number`/`range` declares `numeric`.

**It does NOT validate:** `order` uniqueness or presence · `required` presence (a missing key is
silently optional and can never block a gate) · `feeds` — and **nothing reads it**; all 23
questions carry one and the array is inert · `numeric.min <= numeric.max` · `maxSelections`,
which appears in the JSON but is not in the `Question` interface.

*Purpose not evident from source:* `PhaseMeta.primaryDocument` is shipped to the client but no
code branches on it.

---

## `gate.service.ts` — 117 lines — **the product**

The phase state machine, and the only module that **transitions** phase state.
`PhaseStatus = 'pending' | 'in_progress' | 'awaiting_approval' | 'approved' | 'revising'` —
the same five as the schema CHECK and `client/src/lib/types.ts`.

| Name | Signature | Side effects | Failure | Tests |
|---|---|---|---|---|
| `canApprove` | `(projectId, phaseNo) => Promise<boolean>` | 1 DB read | never throws | 3 |
| `refreshPhaseStatus` | `(projectId, phaseNo) => Promise<PhaseStatus>` | read + conditional write | 404 `Phase not found` | 4 |
| `approvePhase` | `(projectId, phaseNo) => Promise<{approved, nextPhase}>` | 3 reads + a 4-statement transaction | 404, **409** x3 | 6 |
| `revisePhase` | `(projectId, phaseNo) => Promise<void>` | 2 writes | 404 | 4 |

### `canApprove` — completeness counted, not inferred

```ts
const required = getQuestionsForPhase(phaseNo).filter((q) => q.required);
const answered = await query<{ question_id: string }>(
  'SELECT question_id FROM answers WHERE project_id = $1 AND phase_no = $2', [projectId, phaseNo]);
const have = new Set(answered.map((a) => a.question_id));
return required.every((q) => have.has(q.questionId));
```

Required set from the **bank**, answers from the **database**, compared by id. Nothing cached.

**Consequence:** `[].every(...)` is `true`, so `canApprove(projectId, 99)` returns `true`.
Unreachable over HTTP (`parsePhaseNo` rejects out-of-range), but the function has no domain check.

### `refreshPhaseStatus` — the only automatic transition

```ts
if (phase.status === 'approved') return phase.status;   // line 34 — never reopens

const complete = await canApprove(projectId, phaseNo);
const next: PhaseStatus = complete
  ? 'awaiting_approval'
  : (phase.status === 'pending' ? 'pending' : 'in_progress');
```

An approved phase is immutable here, and a `pending` phase stays `pending` even when complete —
completeness does not unlock a phase, approval of the previous one does. The write is
conditional, so a no-op save issues one `SELECT` and no `UPDATE`. **Neither branch can emit
`revising`.**

### `approvePhase` — four guards, then one transaction

Guards (50-67): project exists → `phaseNo <= current_phase` → no earlier phase unapproved →
`canApprove`. Each throws a distinct message, so the UI can say *why*.

Transaction (70-101):

1. `UPDATE phases SET status = 'approved', approved_at = now()`
2. `UPDATE projects SET current_phase = GREATEST(current_phase, $2)` — the non-rewinding advance
3. `UPDATE phases SET status = 'in_progress' … AND status = 'pending'` — opens the next phase
   only if never opened, so re-approving phase 2 on a phase-4 project does not reset phase 3
4. `UPDATE projects SET status = CASE WHEN (count of approved) = $2 THEN 'complete' ELSE
   'in_progress' END … WHERE id = $1 AND status <> 'archived'`

Statements 2 and 3 are skipped when `phaseNo === PHASE_COUNT`.

### `revisePhase` — two statements, **no transaction**

```sql
UPDATE phases SET status = 'revising', approved_at = NULL
  WHERE project_id = $1 AND phase_no = $2 RETURNING phase_no
```

`RETURNING` detects the 404. A second statement demotes a `complete` project to `in_progress`.
A crash between them leaves a `complete` project with a `revising` phase.
`DATA-NO-IMPOSSIBLE-STATE` passes, but the guarantee is by narrowness, not construction.

---

## `answer.service.ts` — 170 lines

**Types** — `AnswerRow` (`value_number` typed **`string`**, honest about node-pg NUMERIC) ·
`RangeValue {min, max}` · `AnswerValue = string | number | string[] | RangeValue` ·
`Columns` (`valueJson` is a **pre-stringified** JSON string).

| Name | Signature | Notes |
|---|---|---|
| `toColumns` | `(question, value) => Columns` | **Pure.** Throws `AppError(400)` per type; 500 on an unknown type. **21 tests** |
| `saveAnswer` | `(projectId, questionId, value) => Promise<AnswerRow>` | Upsert + `refreshPhaseStatus` |
| `saveAnswers` | `(projectId, entries) => Promise<AnswerRow[]>` | Transaction + one refresh per distinct phase |
| `getAnswers` | `(projectId) => Promise<AnswerRow[]>` | Ordered `phase_no, question_id` |
| `getAnswersForPhase` | `(projectId, phaseNo) => Promise<AnswerRow[]>` | Ordered `question_id` |

### `toColumns` — the last line of defence before the numbers

| Case | Column | Validation | Error |
|---|---|---|---|
| `text` | `value_text` | string, trimmed, non-empty | `X expects text` / `X cannot be blank` |
| `select` | `value_text` | string **and** in `options` | `"v" is not an option for X` |
| `multiselect` | `value_json` | non-empty array, all in `options`, **deduplicated** | `X needs at least one option` / `Not options for X: a, b` |
| `number` | `value_number` | `Number()`; rejects boolean/array; `isFinite`; within `numeric` | `X expects a number` / `X must be between A and B unit` |
| `range` | `value_json` | non-array object, both bounds finite, **`min <= max`**, both within bounds | `X: the lower figure must not exceed the upper one` |

**Three details each fixing a specific failure:**

1. `typeof value === 'boolean'` is rejected before `Number.isFinite` — `Number(true)` is `1`.
2. `JSON.stringify` is applied inside `toColumns`, not left to the driver — node-pg turns a JS
   array into `{a,b,c}`, a Postgres array literal that JSONB will not accept.
3. `select` is **case-sensitive** — the p4q1 string is matched exactly against `B2B_MODEL`, so a
   case-folded match would silently route a B2B project into the consumer funnel.

### `saveAnswers` — validate-then-transact

Every entry is validated (126-129) **before** the transaction opens (131), so a batch with one
bad value fails atomically without touching the database. `refreshPhaseStatus` runs **after**
commit, once per distinct phase — deliberately outside, so the gate's read sees committed rows.

### The upsert (duplicated ~8 lines in both functions)

```sql
INSERT INTO answers (project_id, question_id, phase_no, value_text, value_number, value_json)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (project_id, question_id) DO UPDATE
  SET value_text = EXCLUDED.value_text, value_number = EXCLUDED.value_number,
      value_json = EXCLUDED.value_json, answered_at = now()
RETURNING question_id, phase_no, value_text, value_number, value_json, answered_at
```

**It does not update `phase_no`.** If a question moved phase, existing rows would keep the old
value and `canApprove` would stop seeing them.

---

## `auth.service.ts` — 96 lines

**Constants** — `BCRYPT_ROUNDS 10` · `TOKEN_TTL_SECONDS 604800` (7 days, both JWT `expiresIn`
and cookie `maxAge`) · `MIN_PASSWORD_LENGTH 8` · `COOKIE_NAME 'token'` ·
`DUMMY_HASH = bcrypt.hashSync('no-such-user', 10)` at import ·
`cookieOptions { httpOnly, sameSite: 'lax', secure: prod, path: '/' }`.

**Exports** — `register` (409 on PG `23505`) · `login` (401, one message for both causes) ·
`issueToken` · `setAuthCookie` · `clearAuthCookie` · `findUserById` (returns `null`).

**Email enumeration is closed:**

```ts
const row = await queryOne<UserRow>('SELECT … FROM users WHERE email = $1', [normaliseEmail(email)]);
const passwordMatches = await bcrypt.compare(password, row?.password_hash ?? DUMMY_HASH);
if (!row || !passwordMatches) throw new AppError('Invalid email or password', 401);
```

Both paths cost one bcrypt round; status and body are identical.

**The hash never leaves the service:** `const { password_hash: _hash, ...user } = row;`. Every
other query names its columns, so no path could return it.

Email validation is one loose regex: `/^[^@\s]+@[^@\s]+\.[^@\s]+$/`.

**No test file exists** — covered only by `qa:api`.

---

## `project.service.ts` — 119 lines

**Types** — `ProjectRow` (10 fields, also the type of `req.project`) · `PhaseRow`
(`phase_no, status, approved_at`) · `NewProject` · `SeedAnswer` · `SeedFile` (reads 2 of the
seed file's 6 top-level keys).

**Exports** — `create` · `list` · `getOwned` (**404, never 403**) · `getById` (**no ownership
check** — safe only because `loadProject` already ran) · `getPhases` · `createFromSeed`.

### `create` — phase rows from `generate_series`

```sql
INSERT INTO phases (project_id, phase_no, status)
SELECT $1, n, CASE WHEN n = 1 THEN 'in_progress' ELSE 'pending' END
FROM generate_series(1, $2) AS n
```

`PHASE_COUNT` is `$2`, so phase count is driven by the bank. **The one place outside
`gate.service` that writes `phases.status`.**

### `createFromSeed`

`const prefill = seed.answers.filter((a) => !a.clearOnDemo);`

23 seed answers; `clearOnDemo` is `true` for exactly five — `p1q1, p1q2, p2q6, p3q1, p4q8` —
matching the bank's `demoSet.questionIds`. So **18** are pre-filled, not the 19 README and
INSTALL claim, and out of 23 questions, not 24.

**`valueJson` is mistyped** as `string[] | null` (line 82), but `p4q8`'s seed value is
`{"min":8000,"max":270000}`. The insert stringifies an object fine, so nothing breaks at
runtime — the declared type just does not describe the file.

**It bypasses `answer.service` entirely** (104-114), inserting straight into `answers` with no
`toColumns` call. So **seed values are never validated against the bank**. `phaseNoOf` is the one
bank check that runs — an unknown id would throw 404. All 23 seed ids currently resolve.

---

## `competitorTerms.ts` — 42 lines

Turns the `p2q4` prose answer into at most three App Store search terms. **Pure**, so
`fetch-seed-data.ts` and the live pipeline derive identical cache keys.

**Constants** — `NON_ANSWERS` (nothing, none, no one, nobody, n/a, na, unknown) ·
`DESCRIPTIVE_OPENERS` (`individual|various|several|some|other|generic|custom|in-house|internal|
manual|paper|word of mouth`) · `MAX_TERMS 3` (exported, read only by the test) ·
`MAX_TERM_LENGTH 40`.

`competitorSearchTerms(raw) => string[]` — pure, never throws, returns `[]`. **10 tests.**

**Pipeline**

1. `raw.replace(/\([^)]*\)/g, ' ')` — parenthetical asides removed **first**
2. `split(/[,;\n]|\band\b|\bor\b/i)`
3. Per fragment: strip trailing `.!?`, strip a leading `and`/`or`, trim
4. Drop if empty, in `NON_ANSWERS`, matching `DESCRIPTIVE_OPENERS`, or over 40 chars
5. Deduplicate case-insensitively (first casing wins)
6. Stop at 3

**On the real seed answer** — `"Google Maps (indoor coverage is partial and venue-dependent),
Waze (outdoor only), and individual mall-operator apps (…)."` → **`["Google Maps", "Waze"]`**,
exactly the two iTunes cache keys the seed file carries (`itunes|Google Maps/IL`,
`itunes|Waze/IL`). Parser and pre-cache agree because both import this function.

Determinism is asserted, not assumed — the output becomes a database cache key.

**Known weakness out of scope here:** the iTunes search is noisy (same-publisher apps). Nothing
filters results by publisher; `generation.service.ts:116-124` dedupes by `trackName` only.

---

## Coverage

| File | Lines | Unit tests | Untested exports |
|---|---:|---:|---|
| `gate.service.ts` | 117 | **20** | none |
| `answer.service.ts` | 170 | **21** | `saveAnswer`, `getAnswers`, `getAnswersForPhase` |
| `competitorTerms.ts` | 42 | **10** | none |
| `questionBank.service.ts` | 100 | 0 direct | all 6 — indirect only |
| `auth.service.ts` | 96 | **0** | all 7 — HTTP probe only |
| `project.service.ts` | 119 | **0** | all 6 — HTTP probe only |
