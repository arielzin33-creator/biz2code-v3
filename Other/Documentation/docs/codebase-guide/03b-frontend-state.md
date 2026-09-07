# 03b — Frontend: state, hooks and the API client

Phase 4. Eight files, **400 lines**: 4 hooks (147), `AuthContext` (56), `lib/api.ts` (44),
`lib/types.ts` (144), plus the `QueryClient` defaults in `main.tsx`.

---

## 1. The state-management pattern, as actually imported

**Verified, not assumed.** `grep -rn "from '@tanstack/react-query'" client/src` returns five
files; `grep -rn "redux\|zustand\|jotai\|recoil\|mobx" client` returns nothing, and none appears
in [client/package.json](../../../../client/package.json).

Three stores, with a clean division:

| Kind of state | Owner | Examples |
|---|---|---|
| **Server state** | TanStack Query v5 | projects, one project, one phase, documents |
| **Auth** | React Context | `user`, `restoring`, `login`, `register`, `logout` |
| **Everything else** | component `useState` | `QuestionField.value`, `PhasePage.fieldErrors`, `ApprovalGate.confirmingRevise`, `Button.hover` |

ARCHITECTURE §7's justification — *"No Redux — a store would be ceremony over one value"* — is
accurate: `AuthContext` holds exactly two values and three functions.

**There is no client-side cache of answers.** Answers arrive inside the phase query
(`PhaseDetailResponse.answers`) and are passed down as props. There is no `useAnswers` *query* —
only a mutation. That is why `keys.answers` is unused (§2).

---

## 2. The query-key registry

Declared once, in [client/src/hooks/useProject.ts:8-14](../../../../client/src/hooks/useProject.ts):

```ts
export const keys = {
  projects:                     ['projects'] as const,
  project:   (id: number)    => ['project', id] as const,
  phase:     (id, n: number) => ['phase', id, n] as const,
  answers:   (id: number)    => ['answers', id] as const,
  documents: (id: number)    => ['documents', id] as const,
};
```

Every other hook imports it (`import { keys } from './useProject'` in `usePhase`, `useAnswers`,
`useDocuments`). ARCHITECTURE §7 gives the reason: *"building them inline would make a typo a
silent cache miss rather than a compile error."* Verified — no hook constructs a key literal.

**`keys.answers` is dead.** `grep -rn "keys.answers" client/src` returns only the declaration. No
query uses it, and `useSaveAnswer` invalidates `keys.phase` and `keys.project` instead — correct,
because the phase query is what carries the answers. The entry is a placeholder for a query that
was never built.

### Which key each hook reads and writes

| Hook | Reads | Invalidates on success |
|---|---|---|
| `useProjects` | `projects` | — |
| `useProject` | `project(id)` | — |
| `useCreateProject` | — | `projects` |
| `useCreateSeedProject` | — | `projects` |
| `usePhase` | `phase(id, n)` | — |
| `useApprovePhase` | — | `project(id)`, `phase(id, n)`, **`phase(id, n+1)`**, `projects` |
| `useRevisePhase` | — | `project(id)`, `phase(id, n)`, `projects` |
| `useSaveAnswer` | — | `phase(id, n)`, `project(id)` |
| `useDocuments` | `documents(id)` | — |
| `useGenerateDocuments` | — | `documents(id)`, `project(id)` |

**`useApprovePhase` invalidates `phase(id, n+1)` as well as `phase(id, n)`**
([usePhase.ts:25](../../../../client/src/hooks/usePhase.ts)). Approving phase 1 unlocks phase 2
server-side, so phase 2's cached `status` and `canApprove` are both stale. Without that line the
user would arrive at a phase that still looked locked — the same class of bug as the redirect
loop, one layer up. `useRevisePhase` correctly does **not** invalidate `n+1`, because revising
never changes a later phase.

**`useSaveAnswer` invalidates `project(id)` as well as the phase.** Saving an answer can flip
`phases.status` from `in_progress` to `awaiting_approval`, which the stepper renders from the
project query.

---

## 3. `client/src/lib/api.ts` — 44 lines

**Purpose.** One fetch wrapper, one error class, and the download URL builder.

| Name | Signature | Inputs | Output | Side effects | Failure mode | Tested? | Called by |
|---|---|---|---|---|---|---|---|
| `BASE` *(private)* | `const string` | `import.meta.env.VITE_API_URL ?? '/api'` | — | — | — | — | `api`, `downloadUrl` |
| `ApiError` | `class extends Error`, `(message, status: number)` | — | — | — | it *is* the failure | via every error-path assertion | thrown by `api` |
| `ApiError#isUnauthenticated` | getter → `status === 401` | — | boolean | — | — | — | `AuthContext` |
| `ApiError#isRefusedByGate` | getter → `status === 409` | — | boolean | — | — | — | **no caller** |
| `api<T>` | `(path, init?) => Promise<T>` | — | parsed JSON, or `undefined` on 204 | **network** | **throws `ApiError`** on any non-OK | indirectly, everywhere | `get`, `post` |
| `get<T>` | `(path) => Promise<T>` | — | — | network | as above | — | 4 hooks + `AuthContext` |
| `post<T>` | `(path, body?) => Promise<T>` | — | — | network | as above | — | 5 hooks + `AuthContext` |
| `downloadUrl` | `(projectId, documentId) => string` | — | a URL | none | — | — | `DocumentsPage` |

**Three properties worth naming:**

1. **`credentials: 'include'` is unconditional** (line 24). Every request carries the cookie.
   Combined with the Vite proxy, the browser only ever talks to one origin, so the cookie stays
   same-site — the arrangement [INSTALL.md](../../../../INSTALL.md) §6 describes.

2. **The server's error message is preferred over the status text** (lines 29-30):
   ```ts
   const body = await res.json().catch(() => ({} as { error?: string }));
   throw new ApiError(body.error ?? res.statusText ?? 'Request failed', res.status);
   ```
   So `ApprovalGate` can surface *"Phase 2 must be approved first"* verbatim. The `.catch` covers
   a non-JSON error body.

3. **204 is handled explicitly** (line 33): `if (res.status === 204) return undefined as T;`.
   `POST /auth/logout` returns 204, and `res.json()` on an empty body would throw.

**`isRefusedByGate` has no caller.** `grep -rn "isRefusedByGate" client` → the definition only.
The gate's 409s are surfaced through the generic message path instead, which works — the getter
was built for a distinction the UI never made.

---

## 4. `client/src/context/AuthContext.tsx` — 56 lines

**Purpose.** Hold the current user, restore the session on mount, and expose the three auth
verbs.

| Name | Signature | Output | Side effects | Failure mode | Tested? |
|---|---|---|---|---|---|
| `AuthValue` *(private)* | interface: `user, restoring, login, register, logout` | — | — | — | — |
| `AuthContext` *(private)* | `Context<AuthValue \| null>` | — | — | — | — |
| `AuthProvider` | `({ children })` | provider | **network on mount**; `useState` ×2 | swallows a 401; logs anything else | every browser test |
| `useAuth` | `() => AuthValue` | the value | none | **throws** `useAuth must be used inside <AuthProvider>` | — |

### The restore effect

```ts
useEffect(() => {
  let cancelled = false;
  get<AuthResponse>('/auth/me')
    .then((r) => { if (!cancelled) setUser(r.user); })
    .catch((e: unknown) => {
      if (!(e instanceof ApiError && e.isUnauthenticated)) console.error(e);
    })
    .finally(() => { if (!cancelled) setRestoring(false); });
  return () => { cancelled = true; };
}, []);
```

Four things in nine lines:

1. **`restoring` starts `true`**, so `ProtectedRoute` and `LoginPage` both hold their redirect
   until the answer arrives. This is the flag WORK_PLAN Day 5 names.
2. **A 401 is not an error.** It is the expected answer for a signed-out visitor, so it is
   swallowed silently. Anything else is logged.
3. **`cancelled` guards both writes** against a StrictMode double-mount unmounting mid-flight.
   The `.finally` is guarded too, which matters more than the `.then` — an unguarded `finally`
   would clear `restoring` on a stale mount.
4. **The dependency array is empty**, so it runs once. The user is never re-fetched; `login`,
   `register` and `logout` update the state directly from their own responses.

**Consequence.** If the session expires while the tab is open, the client does not find out until
a query 401s. React Query then does not retry (the global rule), the query errors, and the page
shows its error state — but `user` stays populated and the app does not redirect to `/login`.
There is no 401 interceptor. In practice the 7-day TTL makes this rare.

**`value` is memoised on `[user, restoring]`** (line 47), so the three functions are recreated on
every auth change. They are not referenced in any dependency array, so this costs nothing.

---

## 5. Form and answer-saving behaviour — the commit / dedupe / re-sync logic

This is the mechanism the brief singles out, and the one Master Plan §7 records a bug in. All of
it is in [client/src/components/QuestionField.tsx](../../../../client/src/components/QuestionField.tsx).

### 5.1 The three values

```ts
const [value, setValue] = useState(() => toInputValue(question, answer));   // what is on screen
const stored = toInputValue(question, answer);                              // what the server confirmed
```

`stored` is **recomputed on every render** from the `answer` prop — it is not state. `value` is
local edit state seeded once from `stored`.

`toInputValue` (lines 19-30) normalises per type:

| Type | Returns |
|---|---|
| `range` | `isRange(answer?.value_json) ? that : { min: NaN, max: NaN }` |
| no answer | `[]` for multiselect, `''` otherwise |
| `multiselect` | `answer.value_json ?? []` |
| `number` | `answer.value_number ?? ''` — a **string**, since `value_number` is typed `string \| null` |
| `text` / `select` | `answer.value_text ?? ''` |

### 5.2 Commit — when a save is sent

| Type | Trigger | Line |
|---|---|---|
| `text` | `onBlur` | 120 |
| `number` | `onBlur`, with `Number(e.target.value)` | 185 |
| `select` | `onChange` | 129 |
| `multiselect` | `onChange` | 166 |
| `range` | `onBlur`, **only when both bounds are finite** | 204, 224 |

Blur for free text, change for discrete choices. Coding Guide §6.1 **[sibling]**: *"every save is
a round trip that makes the gate recompute the phase, so per-keystroke saving would be dozens of
requests and a stepper flickering between states while someone types."*

The range's `send` wrapper (line 204) is the extra rule:

```ts
const send = (next: RangeValue) => { if (bothBoundsGiven(next)) commit(next); };
```

Without it, blurring the floor field before typing the target would POST `{min: 8000, max: NaN}`
and the server would reject it with *"expects two numbers"* — a 400 the user caused by tabbing.

### 5.3 Dedupe — the bug that is fixed, verified

```ts
const commit = (next: AnswerValue) => {
  if (disabled) return;
  const unchanged = Array.isArray(next)
    ? Array.isArray(stored) && next.join(' ') === stored.join(' ')
    : isRange(next)
      ? isRange(stored) && next.min === stored.min && next.max === stored.max
      : String(next) === String(stored);
  if (unchanged) return;
  if (typeof next === 'string' && next.trim() === '') return;
  if (Array.isArray(next) && next.length === 0) return;
  onSave(next);
};
```

**The `isRange` branch (lines 69-70) is the fix.** Master Plan §7 records the defect:

> *"The autosave dedupe compared `String(next)`, and `String({min,max})` is `"[object Object]"` on
> both sides, so every band the user typed was judged unchanged and dropped. Invisible to 256
> tests; found by using the app."*

**Verified fixed** — the object branch compares `min` and `max` numerically before the `String()`
fallback can be reached. A range value can never fall through to line 71.

Three further guards, all early returns:

| Guard | Line | Purpose |
|---|---|---|
| `disabled` | 66 | An approved phase cannot save even if an event fires |
| `unchanged` | 72 | No round trip for a blur that changed nothing |
| empty string | 73 | Blurring an untouched text field must not POST `''` (which `toColumns` would 400 on) |
| empty array | 74 | Deselecting the last multiselect option is not a save — the server would 400 |

The last two mean **a field cannot be cleared once answered.** Deselecting every option leaves the
stored answer in place. That is deliberate — `toColumns` rejects both — but it means there is no
UI path to un-answer a question, and therefore no way to move a phase from `awaiting_approval`
back to `in_progress`.

### 5.4 Re-sync — keyed on a scalar, not an object

```ts
const storedKey = Array.isArray(stored)
  ? stored.join(' ')
  : isRange(stored) ? `${stored.min}:${stored.max}` : stored;
useEffect(() => { setValue(stored); }, [storedKey]);
```

React Query hands back a **new object identity** on every refetch, so an effect keyed on `stored`
or on `answer` would fire on every refetch and overwrite whatever the user was typing. Keying on
a derived scalar means the effect fires only when the value genuinely changed.

Each of the three shapes gets its own scalar: joined for arrays, `min:max` for ranges, the value
itself for strings and numbers.

**This is an intentional exhaustive-deps violation.** The effect reads `stored` but depends only
on `storedKey`. [eslint.config.mjs](../../../../eslint.config.mjs) sets
`'react-hooks/exhaustive-deps': 'warn'` specifically so this stays visible rather than being
silenced — the config's own comment says so:

> *"exhaustive-deps earns its place here: the QuestionField effect that reconciles server state
> with local typing has a deliberate, documented dependency exception, and a rule that flags it
> is what keeps that exception visible instead of forgotten."*

`npm run lint` reports 29 warnings; this is one of them.

**The generalised trap**, from Coding Guide §6.2 **[sibling]**: *"Any comparison that falls
through to `String()` will silently succeed on objects… `String(anything)` type-checks."* Both the
dedupe and the re-sync key needed a new branch when `range` was added; the compiler could flag
neither.

### 5.5 The full save round trip

```
user blurs a field
  └─ QuestionField.commit(next)
       ├─ disabled? unchanged? empty? → return, no request
       └─ onSave(next)
            └─ PhasePage.save(questionId, value)
                 ├─ setSavingId(questionId)          → "· saving…" appears
                 ├─ setFieldErrors({[id]: ''})
                 └─ useSaveAnswer.mutateAsync
                      └─ POST /projects/:id/answers  { questionId, value }
                           ├─ toColumns validates → 400 on failure
                           ├─ UPSERT answers
                           ├─ refreshPhaseStatus     → may flip the phase status
                           └─ 201 { answers, phases }
                      └─ onSuccess: invalidate phase(id, n) + project(id)
                 └─ finally: setSavingId(null)
  ← refetch → new answer prop → storedKey changes → setValue(stored)
  ← refetch → new phases → PhaseStepper recolours, ApprovalGate re-enables
```

**The response body is discarded.** `useSaveAnswer`'s `onSuccess` ignores `data` and invalidates
instead, so the UI updates from a refetch rather than from the mutation's payload. That costs one
extra round trip and guarantees the phase and the stepper agree.

**There is no optimistic update anywhere.** No `onMutate`, no `setQueryData`. Verified:
`grep -rn "onMutate\|setQueryData" client/src` returns nothing. ARCHITECTURE §7's *"the UI
displays the invariant and never re-decides it, with no optimistic update"* is exact.

---

## 6. `client/src/lib/types.ts` — 144 lines, 21 exports

**Purpose.** Hand-mirrored API response shapes.

**Its own header (present):** `/* Shared response types mirroring the API. */`

| Group | Types |
|---|---|
| Entities | `User`, `Project`, `Phase`, `PhaseMeta`, `Question`, `Answer`, `Deliverable` |
| Values | `PhaseStatus`, `RangeValue`, `AnswerValue`, `UnvalidatedEntry` |
| Outcome | `GenerationOutcome` |
| Envelopes | `AuthResponse`, `ProjectListResponse`, `ProjectResponse`, `PhaseDetailResponse`, `GateResponse`, `AnswersResponse`, `DocumentListResponse` |
| Labels | `DOC_TITLES`, `PHASE_STATUS_LABELS` |

**These are duplicates, not imports.** There is no shared package and no code generation; the
client re-declares every shape. ADR-004's trade-off, extended to the wire.

**Three places where the duplication is faithful and worth noting:**

| Field | Server | Client | Correct? |
|---|---|---|---|
| `Answer.value_number` | `string \| null` ([answer.service.ts:12](../../../../server/services/answer.service.ts)) | `string \| null` | ✓ — both acknowledge pg NUMERIC |
| `Answer.value_json` | `string[] \| RangeValue \| null` | `string[] \| RangeValue \| null` | ✓ |
| `Question.type` | 5-member union | the same 5 | ✓ |

**And one where it is not.** `GenerationOutcome.provenance` on the client
([types.ts:91-102](../../../../client/src/lib/types.ts)) declares 5 of the server's 10 fields —
`model`, `usedFallback`, `generatedAt`, `answersUsed`, `benchmarksUsed`, `externalCalls`. It omits
`computed`, `fields`, `llmAttempts` and `escalations`. That is a deliberate narrowing (the client
renders only the model name), and it is safe because the client never round-trips the object —
but it means the type does not describe the payload.

**`DOC_TITLES` and `PHASE_STATUS_LABELS` are display maps, not data.** `PHASE_STATUS_LABELS`
translates the machine states into user-facing English — notably `pending` → **"Locked"**, which
is the only place the word "locked" appears for that state.

**How the type mirror is kept honest.** WORK_PLAN Day 5 records that `checkpoint:day5`
*"asserts every key `client/src/lib/types.ts` declares is present in the response, which catches
drift a typecheck cannot."* **That checkpoint script does not exist in this repository** — see
[07-gaps-and-drift.md](07-gaps-and-drift.md) D3. So the mirror currently has no automated check
of any kind: `npm run typecheck` verifies the client is internally consistent, and nothing
compares it to the server.

---

## 7. Hook-by-hook reference

### `useProject.ts` — 50 lines, 5 exports

| Name | Kind | Returns | Notes |
|---|---|---|---|
| `keys` | registry | — | §2 |
| `useProjects` | query | `Project[]` via `select` | `select: (r) => r.projects` unwraps the envelope in the cache selector, so components never see it |
| `useProject` | query | `ProjectResponse` | `enabled: Number.isFinite(projectId) && projectId > 0` — guards `Number(undefined)` from a param-less render |
| `useCreateProject` | mutation | `{ project }` | invalidates `projects` |
| `useCreateSeedProject` | mutation | `{ project }` | invalidates `projects` |

`useProject` does **not** use `select`, so consumers destructure
`{ project, phases, phaseMeta }` themselves. The inconsistency with `useProjects` is cosmetic.

### `usePhase.ts` — 42 lines, 3 exports

| Name | Kind | Returns | Notes |
|---|---|---|---|
| `usePhase` | query | `PhaseDetailResponse` | `enabled: projectId > 0 && phaseNo > 0` |
| `useApprovePhase` | mutation | `GateResponse` | invalidates 4 keys incl. `phase(id, n+1)` |
| `useRevisePhase` | mutation | `GateResponse` | invalidates 3 keys |

Both mutations take `phaseNo` as the **mutation variable**, not as a hook argument, so one hook
instance can approve any phase. The `onSuccess` handlers read it from the second callback
parameter.

### `useAnswers.ts` — 19 lines, 1 export

| Name | Kind | Returns | Notes |
|---|---|---|---|
| `useSaveAnswer` | mutation | `AnswersResponse` | Takes `(projectId, phaseNo)` at construction; `{questionId, value}` per call |

The smallest file in the client. There is no answers *query* — see §1.

### `useDocuments.ts` — 36 lines, 3 exports

| Name | Kind | Returns | Notes |
|---|---|---|---|
| `useDocuments` | query | `Deliverable[]` via `select` | `enabled: projectId > 0` |
| `GENERATION_SECONDS` | `const 180` | — | display copy only — it drives no timeout |
| `useGenerateDocuments` | mutation | `GenerationOutcome` | **`retry: false`** |

**This file carries one of the two surviving multi-line comments in `client/src`** (lines 18-23),
and it is the QA follow-up's own justification:

> *"Measured end to end in the browser at 126-192s across runs… It read 70s, and the surrounding
> copy asks the user to leave the page open — an estimate less than half the real wait invites
> them to give up on a run that is working."*

**`retry: false` is load-bearing.** Without it the global default would retry a failed generation
twice, spending two more full sets of LLM tokens against an 8,000-per-minute budget.

---

## 8. Re-render triggers

| Trigger | What re-renders |
|---|---|
| `AuthContext` value changes (login, logout, restore completes) | everything under `AuthProvider` |
| `keys.project(id)` invalidated | `PhasePage` (stepper, header), `DocumentsPage` (approval gate) |
| `keys.phase(id, n)` invalidated | `PhasePage`'s questions, answers and `canApprove` |
| `keys.documents(id)` invalidated | `DocumentsPage`'s version list |
| `keys.projects` invalidated | `ProjectsPage` |
| `QuestionField.value` | that one field |
| `PhasePage.savingId` / `fieldErrors` | all `QuestionField`s on the page (props change for one, identity for the rest) |
| `Button.hover` / `press`, `Card.hover` | that one control |

**`refetchOnWindowFocus: false`** means tabbing away and back does not refetch — deliberate, per
§1's table, so a half-typed answer is never overwritten by a background refetch.

**`staleTime: 5_000`** means navigating between phases within five seconds serves from cache.
Combined with the invalidations above, a mutation still forces a fresh read immediately.

---

## Coverage summary for this section

| File | Lines | Exports | Unit tests | Covered by |
|---|---|---|---|---|
| `useProject.ts` | 50 | 5 | 0 | Playwright |
| `usePhase.ts` | 42 | 3 | 0 | Playwright |
| `useAnswers.ts` | 19 | 1 | 0 | Playwright |
| `useDocuments.ts` | 36 | 3 | 0 | Playwright (2 tests at a 300 s timeout) |
| `AuthContext.tsx` | 56 | 2 | 0 | Playwright |
| `lib/api.ts` | 44 | 5 | 0 | Playwright |
| `lib/types.ts` | 144 | 21 | 0 | `tsc` only |

**There is no client-side unit test runner.** `client/package.json` has no `test` script; the only
client test command is `test:ui`, which runs Playwright. Every behaviour in this file —
the dedupe, the re-sync key, the retry rule, the restore flag — is verified only by driving a
real browser, or not at all.

The dedupe and re-sync logic in particular is pure, self-contained and exactly the shape a unit
test would pin. Master Plan §7 records that the range-dedupe bug *"was invisible to 256 tests"* —
it would have remained invisible to 260, because none of them can reach this file.

---

*Next: [04-content-layer.md](04-content-layer.md).*
