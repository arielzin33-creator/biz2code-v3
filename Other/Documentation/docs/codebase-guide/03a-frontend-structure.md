# 03a — Frontend: structure, pages and components

Phase 3, frontend. Twelve files, **1,590 lines**: 4 pages (732), 5 domain/layout components
(681), 3 UI primitives (279), plus the entry and router (84).

State management is [03b](03b-frontend-state.md).

**Stack, observed:** React 18.3, Vite 6, React Router 7, TanStack Query 5, `lucide-react` for
icons. No CSS framework, no component library, no Redux. Every component styles itself with an
inline `CSSProperties` object referencing custom properties from
[client/src/styles/tokens.css](../../../../client/src/styles/tokens.css) (126 lines).

---

## The component tree, page by page

```
main.tsx
└── React.StrictMode
    └── QueryClientProvider
        └── AuthProvider
            └── BrowserRouter
                └── App                                      (Routes)
                    ├── /login          → LoginPage           (no shell)
                    ├── /projects       → ProtectedRoute → AppShell → ProjectsPage
                    │                                                  ├── Card ×(1 + N)
                    │                                                  ├── Button ×2
                    │                                                  └── Badge ×N
                    ├── /projects/:projectId/phase/:phaseNo
                    │                   → ProtectedRoute → AppShell → PhasePage
                    │                                                  ├── PhaseStepper
                    │                                                  ├── QuestionField ×Q
                    │                                                  └── ApprovalGate
                    │                                                       ├── Card
                    │                                                       └── Button ×1..3
                    ├── /projects/:projectId/documents
                    │                   → ProtectedRoute → AppShell → DocumentsPage
                    │                                                  ├── Card ×(1 + N)
                    │                                                  ├── Button ×1
                    │                                                  ├── Badge (Latest)
                    │                                                  └── UnvalidatedBadge ×U
                    │                                                       └── Badge
                    ├── /                → Navigate to /projects
                    └── *                → Navigate to /projects
```

Four routes, one catch-all, one redirect. `AppShell` wraps every authenticated page; `LoginPage`
deliberately does not use it.

---

## `client/src/main.tsx` — 36 lines

**Purpose.** Mount the provider stack and configure React Query's global defaults.

| Name | Signature | Output | Side effects | Tested? |
|---|---|---|---|---|
| `queryClient` *(private)* | `QueryClient` | — | none at construction | via every browser test |
| *(module body)* | — | — | `createRoot(...).render(...)` | `journey.spec.ts` loads the page |

**Provider order** — `QueryClient` → `Auth` → `Router` → `App`. `AuthProvider` sits **outside**
the router because `ProtectedRoute` calls `useAuth()` and would otherwise have no context. It
sits **inside** `QueryClientProvider` even though it does not use React Query, which is harmless.

**Three global query defaults** (lines 14-22):

```ts
retry: (failureCount, error) => {
  if (error instanceof ApiError && (error.status === 401 || error.status === 404)) return false;
  return failureCount < 2;
},
refetchOnWindowFocus: false,
staleTime: 5_000,
```

| Default | Value | Reason |
|---|---|---|
| `retry` | 2, except never on 401/404 | Both are settled answers — retrying a 401 delays the redirect to login and retrying a 404 cannot succeed |
| `refetchOnWindowFocus` | `false` | A gate that recomputes when the user tabs back would fight in-progress typing |
| `staleTime` | 5 s | Short enough that a mutation's invalidation is visible, long enough that navigation does not refetch |

Note `retry` applies to **queries only**. `useGenerateDocuments` sets `retry: false` explicitly
([useDocuments.ts:30](../../../../client/src/hooks/useDocuments.ts)) because a retried generation
would spend a second set of LLM tokens.

---

## `client/src/App.tsx` — 48 lines

**Purpose.** Routes and the route guard.

| Name | Signature | Props | Returns | Side effects | Tested? |
|---|---|---|---|---|---|
| `ProtectedRoute` *(private)* | `({ children }: { children: ReactNode })` | children | a `<Navigate>`, a loading `<main>`, or `<AppShell>{children}</AppShell>` | none | route-guard checks in [extended-qa.spec.ts](../../../../client/tests/extended-qa.spec.ts) |
| `App` | `() => JSX.Element` | none | `<Routes>` | none | every browser test |

**`ProtectedRoute`'s three-way branch** (lines 17-25) — and the middle branch is the interesting
one:

```ts
if (restoring) return <main …>Restoring your session…</main>;
if (!user)     return <Navigate to="/login" replace state={{ from: location.pathname }} />;
return <AppShell>{children}</AppShell>;
```

Without the `restoring` check, a page reload would render `user === null` for one frame and bounce
a signed-in user to `/login`. That is the flag WORK_PLAN Day 5 describes; it is set in
`AuthContext` and cleared in the `/auth/me` promise's `finally`.

**`state: { from: location.pathname }` is recorded and never used.** `LoginPage` navigates to
`/projects` unconditionally after a successful sign-in
([LoginPage.tsx:29](../../../../client/src/pages/LoginPage.tsx)) and never reads
`location.state.from`. The return-to-intended-page mechanism is half-built.

**The catch-all redirects rather than 404s** (line 45): `<Route path="*" element={<Navigate
to="/projects" replace />} />`. There is no 404 page. An unauthenticated user hitting a bad URL
therefore goes `*` → `/projects` → `ProtectedRoute` → `/login`, which is two redirects but lands
correctly.

---

## `client/src/components/AppShell.tsx` — 181 lines

**Purpose.** The frame: a fixed navy sidebar with brand, contextual navigation, the signed-in
user, and sign-out.

**Its own header (present):** `/* The app frame: fixed navy sidebar + scrolling main content. */`

| Name | Signature | Props | State | Responsibilities | Tested? |
|---|---|---|---|---|---|
| `initials` *(private)* | `(email: string) => string` | — | — | first two characters of the local part, upper-cased | no test |
| `NavItem` *(private)* | `({ to, icon, label, active })` | 4 | none | one sidebar link; `active` drives weight and background | indirectly |
| `AppShell` | `({ children }: { children: ReactNode })` | 1 | none | layout, active-route derivation, sign-out | every authenticated browser test |

**Active-route derivation is by string inspection** (lines 60-62), not by `NavLink`:

```ts
const onProjects  = pathname === '/projects';
const onPhase     = pathname.includes('/phase/');
const onDocuments = pathname.endsWith('/documents');
```

**The Phases and Documents links only appear when `params.projectId` exists** (line 92), so the
sidebar is contextual: on `/projects` it shows one item, inside a project it shows three.

`phaseNo` defaults to `'1'` (line 58), so the Phases link from the Documents page returns to
phase 1 rather than to the phase the user was last on.

**Layout:** a 288 px `position: sticky` aside at `100vh` beside a `flex: 1, minWidth: 0` main.
The `minWidth: 0` is what allows the main column's children to scroll horizontally rather than
forcing the flex container wider — the mechanism behind the QA sweep's *"Mobile at 390px reports
`scrollWidth` 390: no horizontal overflow"*.

**The brand is an `<img alt="biz2code">`, not a heading** (lines 82-86). The QA assessment
records a browser test that searched for `getByRole('heading', { name: 'biz2code' })` and could
never match; that assertion was repointed. Each page supplies its own `<h1>`.

**Sign-out is a bare `<button>`, not the `Button` primitive** (lines 152-172) — it needs the
inverse-on-navy palette, which `Button`'s five variants do not cover.

---

## `client/src/pages/LoginPage.tsx` — 172 lines

**Purpose.** Combined sign-in and registration.

**Its own header (present):** `/* Login and register. */`

| Name | Signature | Props | State | Responsibilities | Tested? |
|---|---|---|---|---|---|
| `LoginPage` | `() => JSX.Element` | none | `mode: 'login' \| 'register'`, `email`, `password`, `error`, `busy` | one form for two operations | login flow in both specs |

**Redirect-if-authenticated** (line 21): `if (!restoring && user) return <Navigate to="/projects"
replace />;`. The `!restoring` guard mirrors `ProtectedRoute`'s — without it, an already-signed-in
user hitting `/login` would see the form flash before redirecting.

**One form, two verbs** (line 27): `await (mode === 'login' ? login(email, password) :
register(email, password))`. The submit handler, the field set and the error surface are shared;
only the called context method and the button label change.

**`busy` is local `useState`, not a mutation flag** — because `login`/`register` are
`AuthContext` methods, not React Query mutations. It is set before the call and cleared in
`finally` (lines 25, 32).

The QA sweep verified the form semantics directly: `type=email` / `type=password`, `required`,
`autocomplete`, labels bound by `for`/`id`, and exactly one `<h1>` ("Sign in").

---

## `client/src/pages/ProjectsPage.tsx` — 170 lines

**Purpose.** List the user's projects; create a new one; load the example.

**Its own header (present):** `/* Project list plus the New Project button. */`

| Name | Signature | State | Responsibilities | Tested? |
|---|---|---|---|---|
| `STATUS_TONE` *(private)* | `Record<Project['status'], Tone>` | — | maps `in_progress \| complete \| archived` → `info \| success \| neutral` | — |
| `STATUS_LABEL` *(private)* | `Record<Project['status'], string>` | — | display strings | — |
| `ProjectsPage` | `() => JSX.Element` | `name`, `formError` | list, create, seed | project creation in both specs |

**Both creation paths navigate immediately** (lines 38, 47):
`navigate(\`/projects/${project.id}/phase/1\`)`. There is no intermediate confirmation.

**`busy` combines both mutations** (line 55) so one in flight disables the other; `loading` is
passed per-button so only the pressed one spins.

**A project row links to its `current_phase`, not to phase 1** (line 139) — so returning to a
project resumes where the gate left off.

**A verified copy error.** Line 118:

> *"An indoor-navigation app with **16 of its 21** answers already filled in — the remaining five
> are the ones worth typing yourself."*

The seed file holds **23** answers, **5** carry `clearOnDemo: true`, so **18** are pre-filled:

```bash
node -e "const s=require('./data/seed-project.json');
         console.log(s.answers.length, s.answers.filter(a=>!a.clearOnDemo).length)"
# → 23 18
```

This is the third different figure for the same fact in the repository — `16 of 21` here,
`19 of 24` in [README.md](../../../../README.md) and [INSTALL.md](../../../../INSTALL.md), and
`19 of the 24` in the seed file's own `demoProtocol.purpose`. None matches. The *"remaining five"*
half of the sentence is correct.

---

## `client/src/pages/PhasePage.tsx` — 186 lines — the main screen

**Purpose.** Render one phase's questions and its gate.

**Its own header (present):** `/* The main screen. Renders a phase's questions and its gate. */`

| Name | Signature | State | Responsibilities | Tested? |
|---|---|---|---|---|
| `PhasePage` | `() => JSX.Element` | `fieldErrors: Record<string,string>`, `savingId: string \| null`, `gateError: string \| null` | redirect guard, per-question save, approve, revise | the whole journey in both specs |
| `save` *(private)* | `(questionId, value) => Promise<void>` | — | per-question mutation + error capture | ✓ |
| `onApprove` *(private)* | `() => Promise<void>` | — | approve, then navigate | ✓ |
| `onRevise` *(private)* | `() => Promise<void>` | — | revise in place | ✓ |
| `wrap` *(private)* | `const` style object | — | — | — |

### The redirect guard — WORK_PLAN Day 5's bug 1

```ts
useEffect(() => {
  if (project.isFetching) return;                 // ← the fix
  const current = project.data?.project.current_phase;
  if (current && phaseNo > current) {
    navigate(`/projects/${projectId}/phase/${current}`, { replace: true });
  }
}, [project.data, project.isFetching, phaseNo, projectId, navigate]);
```

**Line 32 is the whole fix.** After approving phase 1, `useApprovePhase` invalidates
`keys.project`; for one render the cached `current_phase` is still 1 while the user is navigating
to phase 2, and without the `isFetching` guard the effect would bounce them back. Holding the
redirect while the query refetches is what WORK_PLAN describes.

The redirect is one-directional: it only fires when `phaseNo > current`. A user can always
navigate *back* to an approved phase.

### Per-question error isolation

`fieldErrors` is keyed by `questionId`, so a 400 on one question does not clear another's error
or block the rest of the form. `savingId` holds one id at a time, so the *"· saving…"* indicator
appears on exactly the field being written.

Both are cleared per-save (line 66) rather than globally.

### Approve navigates to the next thing

```ts
const result = await approve.mutateAsync(phaseNo);
if (result.nextPhase) navigate(`/projects/${projectId}/phase/${result.nextPhase}`);
else                  navigate(`/projects/${projectId}/documents`);
```

**The destination comes from the server's response**, not from `phaseNo + 1`. So the client never
computes the gate's next state.

### `locked` drives read-only mode

`const locked = phase.data.phase.status === 'approved';` (line 62) is passed to every
`QuestionField` as `disabled`, which becomes `<fieldset disabled>` — one attribute for all five
input types. Coding Guide §6.4 **[sibling]**: *"one attribute instead of a disabled prop threaded
through five branches, and it cannot be forgotten on a branch added later."*

---

## `client/src/pages/DocumentsPage.tsx` — 204 lines

**Purpose.** Generate documents, list them grouped by version, download them, and show the
unvalidated fields.

**Its own header (present):** `/* Generated documents: list, versions, download. */`

| Name | Signature | State | Responsibilities | Tested? |
|---|---|---|---|---|
| `DocumentsPage` | `() => JSX.Element` | `error: string \| null` | gate on approval, generate, group, download | 2 generation tests (300 s timeout) |
| `run` *(private)* | `() => Promise<void>` | — | mutate + capture the error | ✓ |

**The approval gate is client-side too** (line 22):
`const allApproved = project.data?.phases.every((p) => p.status === 'approved') ?? false;`
— a UI convenience. The server enforces it independently in `assertAllPhasesApproved`, so this is
display logic, not a control.

**Grouping newest-first** (lines 32-36): a `Map<version, Deliverable[]>` built from the list, then
`[...keys].sort((a, b) => b - a)`. Only the first group gets the `Latest` badge, and only when
more than one version exists — so v1 alone is not labelled, but v1 beside v2 is. That is the
ADR-007 demonstration.

**Download is a plain `<a href download>`** (lines 152-172) pointing at
`downloadUrl(projectId, doc.id)`. No fetch, no blob — the browser handles it, and the cookie goes
with the request because it is same-origin through the Vite proxy.

**The unvalidated block** (lines 177-194) renders one `UnvalidatedBadge` per entry with
`expanded`, so the reason is shown in full rather than as a tooltip. The copy above it states the
guarantee: *"They appear in the document with this marker, not omitted."*

**`GENERATION_SECONDS` appears twice** (lines 82, 83) with different surrounding copy for the
pending and idle states — the pending version adds *"please leave this page open."* The value is
180, raised from 70 by the QA follow-up.

**The progress bar is `aria-hidden` and indeterminate** (lines 86-96) — a 35 %-wide div with a CSS
`b2c-slide` animation. It communicates *working*, not *progress*, which is honest: there is no
progress signal from a synchronous POST.

---

## `client/src/components/PhaseStepper.tsx` — 107 lines

**Purpose.** The four phases, their statuses, and which is current.

**Its own header (present):** `/* Shows the four phases and the current position. */`

| Name | Signature | Props | State | Tested? |
|---|---|---|---|---|
| `COLOURS` *(private)* | `Record<Phase['status'], string>` | — | — | — |
| `PhaseStepper` | `({ project, phases, phaseMeta, current })` | 4 | none | stepper assertions in `journey.spec.ts` |

**The layout is WORK_PLAN Day 5's bug 2 fix** (line 28):

```ts
gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))'
```

`auto-fit` with a `1fr` maximum makes four equal columns that collapse together rather than
wrapping 3-then-1. The bug WORK_PLAN describes — *"The stepper wrapped 3-then-1, reading as two
groups"* — is closed by this one declaration.

**Reachability is read from the project, status from the phase** (lines 36-38):

```ts
const reachable = phase.phase_no <= project.current_phase;
const isCurrent = phase.phase_no === current;
const colour    = COLOURS[phase.status];
```

An unreachable phase renders as a `<div aria-disabled>` with `opacity: 0.6` and a title
explaining why; a reachable one is a `<Link>` with `aria-current="step"` when current. So the
locked state is conveyed by element type, ARIA, colour **and** text — not colour alone.

An approved phase shows a filled circle with `✓`; others show the phase number.

**`COLOURS` maps `awaiting_approval` and `revising` to the same `--warning-text`** — the two
"needs your attention" states share a colour, distinguished by the label underneath from
`PHASE_STATUS_LABELS`.

---

## `client/src/components/QuestionField.tsx` — 250 lines

**Purpose.** Render one question by type, hold local edit state, and decide when to commit.

**Its own header (present):** `/* Renders one question by its type: text | select | multiselect |
number | range. */`

Full state and commit analysis is in [03b-frontend-state.md](03b-frontend-state.md) §5. Structure
here.

| Name | Signature | Props | State | Tested? |
|---|---|---|---|---|
| `isRange` *(private)* | `(v: unknown) => v is RangeValue` | — | — | indirectly |
| `toInputValue` *(private)* | `(question, answer) => string \| string[] \| RangeValue` | — | — | indirectly |
| `bothBoundsGiven` *(private)* | `(r: RangeValue) => boolean` | — | — | indirectly |
| `labelStyle`, `inputStyle` *(private)* | `CSSProperties` | — | — | — |
| `QuestionField` | `({ question, answer, onSave, saving, disabled, error })` | 6 | `value` | 5 types × the journey |

**Five rendering branches**, one per type (lines 113-243):

| Type | Element | Commits on | Notes |
|---|---|---|---|
| `text` | `<textarea rows={3}>` | `onBlur` | `resize: vertical` |
| `select` | `<select>` with a `"Choose one…"` empty option | `onChange` | A single click is the whole interaction |
| `multiselect` | `role="group"` div of checkbox pills | `onChange` | Selected pills get a cyan border and tinted background |
| `number` | `<input type="number">` with `min`/`max` from the bank | `onBlur` | Renders the unit and range as a hint |
| `range` | `role="group"` with two labelled number inputs | `onBlur`, **only when both bounds are finite** | An IIFE, the only one in the file |

**The accessibility fix from the QA sweep** (lines 79-98, 138, 230):

```ts
const isGroup = question.type === 'multiselect' || question.type === 'range';
…
<label htmlFor={isGroup ? undefined : id} id={`${id}-label`} …>
…
<div id={id} role="group" aria-labelledby={`${id}-label`}>
```

The QA assessment records this as *"the only defect in application code"* in that sweep: for
`multiselect` and `range` the outer `<label for>` pointed at an element that did not exist, so
clicking the question text did nothing and the control group had no accessible name. Both group
types now get `role="group"` plus `aria-labelledby`, and the label drops `htmlFor`. Affected
`p1q4`, `p2q6`, `p3q4`, `p4q5` and `p4q8` — verified: those are exactly the four multiselect
questions and the one range question in the bank.

**The saving indicator is a live region** (lines 104-106): `<span role="status"
aria-live="polite">` inside the label, so a screen reader announces *"saving…"* without moving
focus.

**The range labels are prose, not abbreviations** (line 232): *"Floor — below this you would
stop"* and *"Target — what you are aiming at"* — the two halves ADR-012 argues must be asked
together.

---

## `client/src/components/ApprovalGate.tsx` — 102 lines

**Purpose.** The approve/revise control, and the reason approval is unavailable.

**Its own header (present):** `/* Approve / Revise controls at the foot of a phase. */`

| Name | Signature | Props | State | Tested? |
|---|---|---|---|---|
| `ApprovalGate` | `({ phase, questions, answers, canApprove, onApprove, onRevise, busy, error })` | 8 | `confirmingRevise: boolean` | approve/revise in both specs |

**It names the unanswered questions rather than counting them** (lines 67-76):

```ts
const answered = new Set(answers.map((a) => a.question_id));
const missing  = questions.filter((q) => q.required && !answered.has(q.questionId));
…
<ul>{missing.map((q) => <li key={q.questionId}>{q.text}</li>)}</ul>
```

This is the one place the client re-derives something the server also computes. It is a
**display** of the same rule, not a second decision — the button's `disabled` state comes from
the server's `canApprove` prop (line 81), never from `missing.length`. The distinction matters:
lines 88-93 handle the case where `missing.length === 0` but `canApprove` is still false, and
explain it correctly — *"Every question here is answered, but an earlier phase is not approved."*
The client could not have derived that from the phase's own questions.

**Revise is two-step** (lines 47-63): a ghost button reveals an inline confirmation with *"Reopen
this phase for editing?"*, `Yes, revise` (danger) and `Cancel`. `confirmingRevise` is the only
local state in the component.

**The approved state explains the consequence before the action** (lines 42-46): *"the documents
already generated are kept, and regenerating adds a new version beside them."* ADR-007, stated in
the UI at the point the user is about to trigger it.

Both status messages use `role="status" aria-live="polite"`; the error uses `role="alert"`.

---

## `client/src/components/UnvalidatedBadge.tsx` — 41 lines

**Purpose.** Render the guardrail, in one of three kinds.

**Its own header (present):** `/* Renders the guardrail visibly wherever a figure could not be
sourced. */`

| Name | Signature | Output | Tested? |
|---|---|---|---|
| `BadgeKind` | `'unvalidated' \| 'proxy' \| 'conflict'` | — | — |
| `STYLES` *(private)* | `Record<BadgeKind, {label, tone}>` | `UNVALIDATED`/danger · `PROXY`/warning · `SOURCES DISAGREE`/accent | — |
| `kindFromReason` | `(reason: string) => BadgeKind` | a kind | no test |
| `UnvalidatedBadge` | `({ kind?, reason?, expanded? })` | a `Badge` plus optional expanded text | badge assertions in `extended-qa.spec.ts` |

```ts
export function kindFromReason(reason: string): BadgeKind {
  const text = reason.toUpperCase();
  if (text.includes('DISAGREE') || text.includes('CONFLICT')) return 'conflict';
  if (text.includes('PROXY')) return 'proxy';
  return 'unvalidated';
}
```

**Two of the three kinds are unreachable.** The only caller is
[DocumentsPage.tsx:189](../../../../client/src/pages/DocumentsPage.tsx), which passes
`entry.reason` from `Deliverable.unvalidated`. Those reasons are written in exactly three places
([generation.service.ts:205-209](../../../../server/services/generation.service.ts)):

- `"Generation failed for this document. …"`
- `"The model returned no content for this field."`
- `"The model reported that it could not fully source this field from the approved data."`

None contains `PROXY`, `DISAGREE` or `CONFLICT`, so `kindFromReason` **always returns
`'unvalidated'`** in production. The `PROXY` and `SOURCES DISAGREE` variants exist, are styled,
and never render.

WORK_PLAN Day 5 records the intent: *"`UnvalidatedBadge` in three kinds: unvalidated, proxy, and
sources disagree. Flattening them would discard the distinction the benchmark layer works to
preserve."* The component preserves the distinction; the data reaching it does not carry it. The
proxy and conflict caveats *are* computed — `benchmark.caveats()` produces both — but they flow
into the prompt and the Key Figures **Basis** column
([figures.ts:25-29](../../../../server/prompts/figures.ts)), not into
`Deliverable.unvalidated`.

Tracked as **D20** in [07-gaps-and-drift.md](07-gaps-and-drift.md).

`title={reason}` on the badge gives a native tooltip; `expanded` additionally renders the reason
as text beneath. The Documents page always passes `expanded`.

---

## `client/src/components/ui/` — 3 primitives, 279 lines

These are the Design System components, ported to TypeScript. None knows anything about
biz2code's domain.

### `Button.tsx` — 134 lines

| Name | Props | State | Notes |
|---|---|---|---|
| `Button` | `variant?, size?, iconLeft?, iconRight?, loading?, fullWidth?` + all `ButtonHTMLAttributes` except `style` | `hover`, `press` | `type` defaults to `'button'` |
| `Spin` *(private)* | none | none | a 14 px CSS-animated ring using `currentColor` |

5 variants (`primary`, `secondary`, `ghost`, `quiet`, `danger`) × 3 sizes (`sm`, `md`, `lg`).

`const inert = disabled || loading;` (line 74) — a loading button is disabled, so a double
submit is impossible without extra state at the call site. `loading` replaces `iconLeft` with
`<Spin />` rather than adding to it.

Hover and press are **React state**, not CSS pseudo-classes, because the styles are inline. The
effects are a 1 px lift on hover and a brightness filter on press; `onMouseLeave` clears both, so
a drag-out cannot leave the button stuck pressed.

`type` defaulting to `'button'` prevents the accidental form submit that an unlabelled
`<button>` inside a `<form>` would cause — relevant on `ProjectsPage`, where the seed button sits
outside the form but the New Project button is `type="submit"`.

### `Card.tsx` — 95 lines

| Name | Props | State | Notes |
|---|---|---|---|
| `Card` | `title?, subtitle?, accent?, actions?, footer?, padding?, interactive?` | `hover` | `title` is `ReactNode`, so it overrides the HTML `title` attribute — hence `Omit<…, 'title'>` |

`interactive` switches the shadow and border on hover and sets `cursor: pointer`. It does not
add a click handler — the caller wraps the card in a `<Link>`, as `ProjectsPage` does.

`accent` renders a 4 × 44 px navy or cyan bar above the content. No current caller uses it.

The header renders `<h3>` for `title` — worth knowing, because a Card inside a page whose own
heading is `<h2>` produces the right document outline by accident rather than by construction.

### `Badge.tsx` — 50 lines

| Name | Props | State | Notes |
|---|---|---|---|
| `Badge` | `tone?, dot?, icon?` + `HTMLAttributes<HTMLSpanElement>` except `style` | none | 6 tones |

Six tones (`info`, `success`, `warning`, `danger`, `neutral`, `accent`), each a triple of
background / text / border custom properties. `whiteSpace: 'nowrap'`, so a long label widens the
pill rather than wrapping — which is why `UnvalidatedBadge` puts the reason *outside* the badge.

The header comment states the design rule: *"Flat fill + hairline border — never the gloss
gradient"* — the gradient belongs to `Button`'s primary/secondary variants only.

---

## Styling

Two stylesheets, 217 lines total:

| File | Lines | Contents |
|---|---|---|
| [client/src/styles/tokens.css](../../../../client/src/styles/tokens.css) | 126 | Every custom property: the navy and cyan scales, semantic surface/text/border tokens, radii, shadows, transitions, type sizes, `--container-max` |
| [client/src/index.css](../../../../client/src/index.css) | 91 | Reset, base typography, and the two keyframes (`b2c-spin`, `b2c-slide`) the components reference |

Everything else is inline. There are no CSS modules, no styled-components and no utility classes.
The trade is explicit: a component's styles are readable in one place beside its markup, at the
cost of no pseudo-class support — which is why `Button` and `Card` track hover in React state.

**Brand accents differ by surface**, per the Design System doc: cyan-500 `#13A8E2` on the dark
UI (6.95:1), navy-500 `#154F6B` on the white document page (8.89:1). The document colours live in
[docx.service.ts:17-23](../../../../server/services/docx.service.ts), not in `tokens.css` — the
two palettes are maintained separately, in different languages, with no shared source.

---

*Next: [03b-frontend-state.md](03b-frontend-state.md).*
