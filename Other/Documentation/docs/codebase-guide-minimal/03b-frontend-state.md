# 03b — Frontend: state, hooks and the API client (minimal)

Eight files, **400 lines**: 4 hooks (147), `AuthContext` (56), `lib/api.ts` (44),
`lib/types.ts` (144), plus the `QueryClient` defaults in `main.tsx`.

## 1. Three stores

| Kind of state | Owner | Examples |
|---|---|---|
| **Server state** | TanStack Query v5 | projects, one project, one phase, documents |
| **Auth** | React Context | `user`, `restoring`, `login`, `register`, `logout` |
| **Everything else** | component `useState` | `QuestionField.value`, `PhasePage.fieldErrors`, `ApprovalGate.confirmingRevise`, `Button.hover` |

No redux/zustand/jotai/recoil/mobx anywhere. `AuthContext` holds exactly two values and three
functions.

**There is no client-side cache of answers.** Answers arrive inside the phase query
(`PhaseDetailResponse.answers`) and are passed down as props. There is no `useAnswers` *query* —
only a mutation.

## 2. The query-key registry

```ts
export const keys = {
  projects:                     ['projects'] as const,
  project:   (id: number)    => ['project', id] as const,
  phase:     (id, n: number) => ['phase', id, n] as const,
  answers:   (id: number)    => ['answers', id] as const,
  documents: (id: number)    => ['documents', id] as const,
};
```

Declared once in `useProject.ts:8-14`; every other hook imports it. No hook constructs a key
literal — a typo would be a compile error, not a silent cache miss.

**`keys.answers` is dead** — only the declaration. `useSaveAnswer` invalidates `keys.phase` and
`keys.project` instead, which is correct: the phase query carries the answers.

| Hook | Reads | Invalidates on success |
|---|---|---|
| `useProjects` | `projects` | — |
| `useProject` | `project(id)` | — |
| `useCreateProject` · `useCreateSeedProject` | — | `projects` |
| `usePhase` | `phase(id, n)` | — |
| `useApprovePhase` | — | `project(id)`, `phase(id, n)`, **`phase(id, n+1)`**, `projects` |
| `useRevisePhase` | — | `project(id)`, `phase(id, n)`, `projects` |
| `useSaveAnswer` | — | `phase(id, n)`, `project(id)` |
| `useDocuments` | `documents(id)` | — |
| `useGenerateDocuments` | — | `documents(id)`, `project(id)` |

**`useApprovePhase` invalidates `phase(id, n+1)`** because approving phase 1 unlocks phase 2
server-side, making phase 2's cached `status` and `canApprove` stale. `useRevisePhase` correctly
does **not** — revising never changes a later phase.

**`useSaveAnswer` invalidates `project(id)`** because saving can flip `phases.status` to
`awaiting_approval`, which the stepper renders from the project query.

## 3. `lib/api.ts` — 44 lines

`BASE = import.meta.env.VITE_API_URL ?? '/api'` · `ApiError(message, status)` with
`isUnauthenticated` (401) and `isRefusedByGate` (409) getters · `api<T>` · `get<T>` · `post<T>` ·
`downloadUrl(projectId, documentId)`.

1. **`credentials: 'include'` is unconditional.** Combined with the Vite proxy the browser only
   ever talks to one origin, so the cookie stays same-site.
2. **The server's error message is preferred over the status text:**
   ```ts
   const body = await res.json().catch(() => ({} as { error?: string }));
   throw new ApiError(body.error ?? res.statusText ?? 'Request failed', res.status);
   ```
   So `ApprovalGate` surfaces *"Phase 2 must be approved first"* verbatim.
3. **204 is handled explicitly:** `if (res.status === 204) return undefined as T;` —
   `POST /auth/logout` returns 204 and `res.json()` on an empty body would throw.

**`isRefusedByGate` has no caller** — 409s are surfaced through the generic message path instead.

## 4. `context/AuthContext.tsx` — 56 lines

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

1. **`restoring` starts `true`**, so `ProtectedRoute` and `LoginPage` both hold their redirect.
2. **A 401 is not an error** — the expected answer for a signed-out visitor. Anything else logs.
3. **`cancelled` guards both writes** against a StrictMode double-mount. The `.finally` guard
   matters more than the `.then` — an unguarded one would clear `restoring` on a stale mount.
4. **The dependency array is empty** — the user is never re-fetched; `login`/`register`/`logout`
   update state directly from their own responses.

**Consequence:** if the session expires while the tab is open, the client does not find out until
a query 401s. React Query does not retry, the query errors, the page shows its error state — but
`user` stays populated and the app does not redirect to `/login`. **There is no 401 interceptor.**
The 7-day TTL makes this rare.

`useAuth()` throws `useAuth must be used inside <AuthProvider>` outside the provider.

## 5. Commit / dedupe / re-sync

All in `components/QuestionField.tsx`.

### 5.1 The two values

```ts
const [value, setValue] = useState(() => toInputValue(question, answer));   // what is on screen
const stored = toInputValue(question, answer);                              // what the server confirmed
```

`stored` is **recomputed on every render** from the `answer` prop — not state.

| Type | `toInputValue` returns |
|---|---|
| `range` | `isRange(answer?.value_json) ? that : { min: NaN, max: NaN }` |
| no answer | `[]` for multiselect, `''` otherwise |
| `multiselect` | `answer.value_json ?? []` |
| `number` | `answer.value_number ?? ''` — a **string**, since `value_number` is `string \| null` |
| `text` / `select` | `answer.value_text ?? ''` |

### 5.2 Commit triggers

| Type | Trigger |
|---|---|
| `text` | `onBlur` |
| `number` | `onBlur`, with `Number(e.target.value)` |
| `select` | `onChange` |
| `multiselect` | `onChange` |
| `range` | `onBlur`, **only when both bounds are finite** |

Blur for free text, change for discrete choices — every save is a round trip that makes the gate
recompute the phase, so per-keystroke saving would be dozens of requests and a flickering stepper.

```ts
const send = (next: RangeValue) => { if (bothBoundsGiven(next)) commit(next); };
```

Without it, blurring the floor before typing the target would POST `{min: 8000, max: NaN}` and
earn a 400 the user caused by tabbing.

### 5.3 Dedupe

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

**The `isRange` branch is the fix.** The recorded defect: the dedupe compared `String(next)`, and
`String({min,max})` is `"[object Object]"` on both sides, so every band the user typed was judged
unchanged and dropped — invisible to 256 tests, found by using the app. **Verified fixed** — a
range value can never reach the `String()` fallback.

| Guard | Purpose |
|---|---|
| `disabled` | An approved phase cannot save even if an event fires |
| `unchanged` | No round trip for a blur that changed nothing |
| empty string | Blurring an untouched text field must not POST `''` (a 400) |
| empty array | Deselecting the last option is not a save (a 400) |

The last two mean **a field cannot be cleared once answered** — so there is no UI path to
un-answer a question, and therefore no way to move a phase from `awaiting_approval` back to
`in_progress`.

### 5.4 Re-sync — keyed on a scalar, not an object

```ts
const storedKey = Array.isArray(stored)
  ? stored.join(' ')
  : isRange(stored) ? `${stored.min}:${stored.max}` : stored;
useEffect(() => { setValue(stored); }, [storedKey]);
```

React Query hands back a **new object identity** on every refetch, so an effect keyed on `stored`
or `answer` would fire every refetch and overwrite whatever the user was typing.

**This is an intentional exhaustive-deps violation** — `eslint.config.mjs` sets the rule to
`'warn'` specifically so it stays visible rather than silenced. It is one of the 29 lint warnings.

The generalised trap: any comparison falling through to `String()` silently succeeds on objects,
and `String(anything)` type-checks. Both the dedupe and the re-sync key needed a new branch when
`range` was added; the compiler could flag neither.

### 5.5 The full round trip

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

**The response body is discarded** — `onSuccess` ignores `data` and invalidates instead. One
extra round trip, and a guarantee that the phase and the stepper agree.

**There is no optimistic update anywhere** — no `onMutate`, no `setQueryData`.

## 6. `lib/types.ts` — 144 lines, 21 exports

| Group | Types |
|---|---|
| Entities | `User`, `Project`, `Phase`, `PhaseMeta`, `Question`, `Answer`, `Deliverable` |
| Values | `PhaseStatus`, `RangeValue`, `AnswerValue`, `UnvalidatedEntry` |
| Outcome | `GenerationOutcome` |
| Envelopes | `AuthResponse`, `ProjectListResponse`, `ProjectResponse`, `PhaseDetailResponse`, `GateResponse`, `AnswersResponse`, `DocumentListResponse` |
| Labels | `DOC_TITLES`, `PHASE_STATUS_LABELS` |

**These are duplicates, not imports** — no shared package, no code generation.

Faithful: `Answer.value_number` is `string | null` on both sides (both acknowledge pg NUMERIC);
`Answer.value_json` is `string[] | RangeValue | null` on both; `Question.type` is the same
5-member union.

**Not faithful:** `GenerationOutcome.provenance` declares 5 of the server's 10 fields, omitting
`computed`, `fields`, `llmAttempts` and `escalations`. A deliberate narrowing, safe because the
client never round-trips the object — but the type does not describe the payload.

`PHASE_STATUS_LABELS` maps `pending` → **"Locked"**, the only place that word appears.

**The mirror has no automated check.** WORK_PLAN says `checkpoint:day5` asserts every declared key
is present in the response — **that script does not exist in this repository** (D3). `typecheck`
verifies internal consistency; nothing compares client to server.

## 7. Hooks

**`useProject.ts` (50, 5 exports)** — `keys` · `useProjects` (`select: (r) => r.projects` unwraps
the envelope in the cache selector) · `useProject` (`enabled: Number.isFinite(projectId) &&
projectId > 0`, guarding `Number(undefined)`) · `useCreateProject` · `useCreateSeedProject`.
`useProject` does **not** use `select`, so consumers destructure themselves — a cosmetic
inconsistency.

**`usePhase.ts` (42, 3)** — `usePhase` · `useApprovePhase` (4 invalidations) · `useRevisePhase`
(3). Both mutations take `phaseNo` as the **mutation variable**, not a hook argument, so one hook
instance can approve any phase.

**`useAnswers.ts` (19, 1)** — `useSaveAnswer`, taking `(projectId, phaseNo)` at construction and
`{questionId, value}` per call. The smallest file in the client.

**`useDocuments.ts` (36, 3)** — `useDocuments` · `GENERATION_SECONDS = 180` (display copy only;
it drives no timeout) · `useGenerateDocuments` with **`retry: false`**.

This file carries one of the two surviving multi-line comments in `client/src`: generation was
*"measured end to end in the browser at 126-192 s across runs… It read 70 s, and the surrounding
copy asks the user to leave the page open — an estimate less than half the real wait invites them
to give up on a run that is working."*

**`retry: false` is load-bearing** — without it the global default would retry a failed
generation twice, spending two more full sets of LLM tokens against an 8,000-per-minute budget.

## 8. Re-render triggers

| Trigger | What re-renders |
|---|---|
| `AuthContext` value changes | everything under `AuthProvider` |
| `keys.project(id)` invalidated | `PhasePage` (stepper, header), `DocumentsPage` (approval gate) |
| `keys.phase(id, n)` invalidated | `PhasePage`'s questions, answers, `canApprove` |
| `keys.documents(id)` invalidated | `DocumentsPage`'s version list |
| `keys.projects` invalidated | `ProjectsPage` |
| `QuestionField.value` | that one field |
| `PhasePage.savingId` / `fieldErrors` | all `QuestionField`s on the page |
| `Button.hover`/`press`, `Card.hover` | that one control |

`refetchOnWindowFocus: false` — tabbing away and back does not refetch, so a half-typed answer is
never overwritten. `staleTime: 5_000` — navigating between phases within five seconds serves from
cache, while a mutation still forces a fresh read.

---

## Coverage

| File | Lines | Exports | Unit tests |
|---|---:|---:|---:|
| `useProject.ts` | 50 | 5 | 0 |
| `usePhase.ts` | 42 | 3 | 0 |
| `useAnswers.ts` | 19 | 1 | 0 |
| `useDocuments.ts` | 36 | 3 | 0 |
| `AuthContext.tsx` | 56 | 2 | 0 |
| `lib/api.ts` | 44 | 5 | 0 |
| `lib/types.ts` | 144 | 21 | 0 (`tsc` only) |

**There is no client-side unit test runner** — `client/package.json` has no `test` script; the
only client test command is `test:ui` (Playwright). The dedupe and re-sync logic is pure,
self-contained and exactly the shape a unit test would pin; the range-dedupe bug was invisible to
256 tests and would have remained invisible to 260, because none can reach this file.
