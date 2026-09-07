# 03a — Frontend: structure, pages and components (minimal)

Twelve files, **1,590 lines**: 4 pages (732), 5 domain/layout components (681), 3 UI primitives
(279), entry + router (84).

**Stack:** React 18.3, Vite 6, React Router 7, TanStack Query 5, `lucide-react`. No CSS
framework, no component library, no Redux. Every component styles itself with an inline
`CSSProperties` object referencing custom properties from `styles/tokens.css` (126 lines).

## Component tree

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
                    ├── /projects/:projectId/documents
                    │                   → ProtectedRoute → AppShell → DocumentsPage
                    │                                                  ├── Card ×(1 + N)
                    │                                                  ├── Badge (Latest)
                    │                                                  └── UnvalidatedBadge ×U
                    ├── /                → Navigate to /projects
                    └── *                → Navigate to /projects
```

---

## `main.tsx` — 36 lines

Provider order: `QueryClient` → `Auth` → `Router` → `App`. `AuthProvider` sits **outside** the
router because `ProtectedRoute` calls `useAuth()`.

```ts
retry: (failureCount, error) => {
  if (error instanceof ApiError && (error.status === 401 || error.status === 404)) return false;
  return failureCount < 2;
},
refetchOnWindowFocus: false,
staleTime: 5_000,
```

| Default | Reason |
|---|---|
| `retry` 2, never on 401/404 | Both are settled answers — retrying a 401 delays the login redirect; a 404 cannot succeed |
| `refetchOnWindowFocus: false` | A gate that recomputes when the user tabs back would fight in-progress typing |
| `staleTime: 5 s` | Short enough that an invalidation is visible, long enough that navigation does not refetch |

`retry` applies to **queries only** — `useGenerateDocuments` sets `retry: false` explicitly,
because a retried generation would spend a second set of LLM tokens.

## `App.tsx` — 48 lines

```ts
if (restoring) return <main …>Restoring your session…</main>;
if (!user)     return <Navigate to="/login" replace state={{ from: location.pathname }} />;
return <AppShell>{children}</AppShell>;
```

Without the `restoring` check, a page reload would render `user === null` for one frame and
bounce a signed-in user to `/login`.

**`state: { from: location.pathname }` is recorded and never used** — `LoginPage` navigates to
`/projects` unconditionally. The return-to-intended-page mechanism is half-built.

**The catch-all redirects rather than 404s.** There is no 404 page; an unauthenticated user
hitting a bad URL goes `*` → `/projects` → `/login`.

## `components/AppShell.tsx` — 181 lines

Fixed navy sidebar with brand, contextual navigation, signed-in user, sign-out.

**Active-route derivation is by string inspection**, not `NavLink`:

```ts
const onProjects  = pathname === '/projects';
const onPhase     = pathname.includes('/phase/');
const onDocuments = pathname.endsWith('/documents');
```

The Phases and Documents links only appear when `params.projectId` exists, so the sidebar is
contextual. `phaseNo` defaults to `'1'`, so the Phases link from the Documents page returns to
phase 1, not the last phase visited.

**Layout:** a 288 px `position: sticky` aside at `100vh` beside a `flex: 1, minWidth: 0` main.
The `minWidth: 0` is what allows the main column to scroll horizontally rather than forcing the
flex container wider — no horizontal overflow at 390 px.

The brand is an `<img alt="biz2code">`, **not a heading** — each page supplies its own `<h1>`.
Sign-out is a bare `<button>`, not the `Button` primitive, because it needs the inverse-on-navy
palette.

## `pages/LoginPage.tsx` — 172 lines

State: `mode: 'login' | 'register'`, `email`, `password`, `error`, `busy`.

**Redirect-if-authenticated:** `if (!restoring && user) return <Navigate to="/projects" replace />;`
— the `!restoring` guard mirrors `ProtectedRoute`'s.

**One form, two verbs:** `await (mode === 'login' ? login(email, password) : register(email,
password))`. `busy` is local `useState`, not a mutation flag, because `login`/`register` are
`AuthContext` methods.

Form semantics verified: `type=email` / `type=password`, `required`, `autocomplete`, labels bound
by `for`/`id`, exactly one `<h1>`.

## `pages/ProjectsPage.tsx` — 170 lines

`STATUS_TONE` (`in_progress|complete|archived` → `info|success|neutral`) · `STATUS_LABEL`.
State: `name`, `formError`.

Both creation paths navigate immediately to `/projects/${id}/phase/1` — no confirmation.
`busy` combines both mutations so one in flight disables the other; `loading` is per-button.
**A project row links to its `current_phase`**, not phase 1 — returning resumes where the gate
left off.

**A verified copy error** (line 118): *"…with **16 of its 21** answers already filled in…"*.
The seed file holds 23 answers, 5 with `clearOnDemo`, so **18** are pre-filled. This is the third
different figure for the same fact — `16 of 21` here, `19 of 24` in README/INSTALL, `19 of the
24` in the seed file's own `demoProtocol.purpose`. None matches. The *"remaining five"* half is
correct.

## `pages/PhasePage.tsx` — 186 lines — the main screen

State: `fieldErrors: Record<string,string>`, `savingId: string | null`, `gateError: string | null`.

### The redirect guard

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
`keys.project`; for one render the cached `current_phase` is still 1 while the user navigates to
phase 2, and without the guard the effect would bounce them back. The redirect is one-directional
— a user can always navigate *back* to an approved phase.

### Other behaviour

- `fieldErrors` is keyed by `questionId`, so a 400 on one question does not clear another's error
  or block the form. `savingId` holds one id at a time. Both cleared per-save.
- **Approve navigates to the server's answer**, never `phaseNo + 1`:
  `if (result.nextPhase) navigate(…/phase/${result.nextPhase}); else navigate(…/documents);`
- `const locked = phase.data.phase.status === 'approved';` is passed to every `QuestionField` as
  `disabled`, becoming `<fieldset disabled>` — one attribute for all five input types, and it
  cannot be forgotten on a branch added later.

## `pages/DocumentsPage.tsx` — 204 lines

**The client-side approval gate is display logic, not a control:**
`const allApproved = project.data?.phases.every((p) => p.status === 'approved') ?? false;`
The server enforces it independently in `assertAllPhasesApproved`.

**Grouping newest-first** — a `Map<version, Deliverable[]>`, then `[...keys].sort((a,b) => b-a)`.
Only the first group gets the `Latest` badge, and only when more than one version exists — the
ADR-007 demonstration.

**Download is a plain `<a href download>`** pointing at `downloadUrl(projectId, doc.id)`. No
fetch, no blob — the cookie goes with the request because it is same-origin through the Vite
proxy.

**The unvalidated block** renders one `UnvalidatedBadge` per entry with `expanded`, above copy
stating the guarantee: *"They appear in the document with this marker, not omitted."*

`GENERATION_SECONDS` = **180** (raised from 70), appearing twice with different pending/idle copy.
The progress bar is `aria-hidden` and **indeterminate** — a 35 %-wide div with a `b2c-slide`
animation. It communicates *working*, not progress, which is honest: a synchronous POST gives no
progress signal.

## `components/PhaseStepper.tsx` — 107 lines

**The layout fix:** `gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))'` — four equal
columns that collapse together rather than wrapping 3-then-1.

```ts
const reachable = phase.phase_no <= project.current_phase;   // from the project
const isCurrent = phase.phase_no === current;
const colour    = COLOURS[phase.status];                     // from the phase
```

An unreachable phase renders as a `<div aria-disabled>` at `opacity: 0.6` with an explanatory
title; a reachable one is a `<Link>` with `aria-current="step"` when current. The locked state is
conveyed by element type, ARIA, colour **and** text — not colour alone.

`COLOURS` maps `awaiting_approval` and `revising` to the same `--warning-text`, distinguished by
the label from `PHASE_STATUS_LABELS`. An approved phase shows a filled `✓`; others the number.

## `components/QuestionField.tsx` — 250 lines

Props: `question, answer, onSave, saving, disabled, error`. State: `value`.
Commit logic in [03b](03b-frontend-state.md) §5.

| Type | Element | Commits on | Notes |
|---|---|---|---|
| `text` | `<textarea rows={3}>` | `onBlur` | `resize: vertical` |
| `select` | `<select>` + `"Choose one…"` empty option | `onChange` | One click is the whole interaction |
| `multiselect` | `role="group"` div of checkbox pills | `onChange` | Selected pills get a cyan border and tint |
| `number` | `<input type="number">`, `min`/`max` from the bank | `onBlur` | Renders unit and range as a hint |
| `range` | `role="group"`, two labelled number inputs | `onBlur`, **only when both bounds are finite** | An IIFE, the only one in the file |

**The accessibility fix:**

```ts
const isGroup = question.type === 'multiselect' || question.type === 'range';
<label htmlFor={isGroup ? undefined : id} id={`${id}-label`} …>
<div id={id} role="group" aria-labelledby={`${id}-label`}>
```

Recorded as *"the only defect in application code"* in that QA sweep: for `multiselect` and
`range` the outer `<label for>` pointed at a nonexistent element, so clicking the question text
did nothing and the group had no accessible name. Affects `p1q4`, `p2q6`, `p3q4`, `p4q5`, `p4q8`
— exactly the four multiselect questions and the one range question.

The saving indicator is `<span role="status" aria-live="polite">` inside the label.
The range labels are prose: *"Floor — below this you would stop"* / *"Target — what you are
aiming at"*.

## `components/ApprovalGate.tsx` — 102 lines

Props: `phase, questions, answers, canApprove, onApprove, onRevise, busy, error`.
State: `confirmingRevise`.

**It names the unanswered questions rather than counting them:**

```ts
const answered = new Set(answers.map((a) => a.question_id));
const missing  = questions.filter((q) => q.required && !answered.has(q.questionId));
```

This is a **display** of the same rule, not a second decision — the button's `disabled` comes
from the server's `canApprove` prop, never from `missing.length`. The distinction matters:
when `missing.length === 0` but `canApprove` is false, the component explains *"Every question
here is answered, but an earlier phase is not approved."* — which it could not have derived from
the phase's own questions.

**Revise is two-step:** a ghost button reveals *"Reopen this phase for editing?"* with
`Yes, revise` (danger) and `Cancel`.

**The approved state explains the consequence before the action:** *"the documents already
generated are kept, and regenerating adds a new version beside them."*

Status messages use `role="status" aria-live="polite"`; the error uses `role="alert"`.

## `components/UnvalidatedBadge.tsx` — 41 lines — D20

```ts
export function kindFromReason(reason: string): BadgeKind {
  const text = reason.toUpperCase();
  if (text.includes('DISAGREE') || text.includes('CONFLICT')) return 'conflict';
  if (text.includes('PROXY')) return 'proxy';
  return 'unvalidated';
}
```

`STYLES`: `UNVALIDATED`/danger · `PROXY`/warning · `SOURCES DISAGREE`/accent.

**Two of the three kinds are unreachable.** The only caller passes `entry.reason` from
`Deliverable.unvalidated`, and those reasons are written in exactly three places
(`generation.service.ts:205-209`):

- `"Generation failed for this document. …"`
- `"The model returned no content for this field."`
- `"The model reported that it could not fully source this field from the approved data."`

None contains `PROXY`, `DISAGREE` or `CONFLICT`, so `kindFromReason` **always returns
`'unvalidated'`** in production.

The proxy and conflict caveats *are* computed — `benchmark.caveats()` produces both — but they
flow into the prompt and the Key Figures **Basis** column, not into `Deliverable.unvalidated`.
The component preserves the distinction; the data reaching it does not carry it.

---

## `components/ui/` — 3 primitives, 279 lines

None knows anything about biz2code's domain.

**`Button.tsx` (134)** — 5 variants (`primary`, `secondary`, `ghost`, `quiet`, `danger`) × 3
sizes (`sm`, `md`, `lg`). `const inert = disabled || loading;` — a loading button is disabled, so
a double submit is impossible without extra state at the call site. `loading` **replaces**
`iconLeft` with `<Spin />`. Hover and press are React state, not CSS pseudo-classes, because the
styles are inline; `onMouseLeave` clears both. `type` defaults to `'button'`, preventing an
accidental form submit.

**`Card.tsx` (95)** — `title?, subtitle?, accent?, actions?, footer?, padding?, interactive?`.
`title` is `ReactNode`, so it shadows the HTML `title` attribute — hence `Omit<…, 'title'>`.
`interactive` changes shadow/border/cursor but adds no click handler; the caller wraps it in a
`<Link>`. `accent` renders a 4 × 44 px bar — **no current caller uses it**. The header renders
`<h3>`.

**`Badge.tsx` (50)** — 6 tones (`info`, `success`, `warning`, `danger`, `neutral`, `accent`),
each a background/text/border triple. `whiteSpace: 'nowrap'`, which is why `UnvalidatedBadge`
puts the reason *outside* the badge. Design rule: *"Flat fill + hairline border — never the gloss
gradient"* (that belongs to `Button`'s primary/secondary only).

## Styling

| File | Lines | Contents |
|---|---:|---|
| `styles/tokens.css` | 126 | Navy and cyan scales, semantic surface/text/border tokens, radii, shadows, transitions, type sizes, `--container-max` |
| `index.css` | 91 | Reset, base typography, the `b2c-spin` and `b2c-slide` keyframes |

Everything else is inline — no CSS modules, no styled-components, no utility classes. The trade
is explicit: styles readable beside their markup, at the cost of no pseudo-class support.

**Brand accents differ by surface:** cyan-500 `#13A8E2` on the dark UI (6.95:1), navy-500
`#154F6B` on the white document page (8.89:1). The document colours live in
`docx.service.ts:17-23`, not in `tokens.css` — two palettes maintained separately, in different
languages, with no shared source.
