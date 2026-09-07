# The Gated Specification Method

A method for producing validated specifications before code is written. Version 1.0. biz2code is
one implementation of it, not its definition.

## 1. What this is, and when to use it

The method turns an unvalidated idea into a specification a builder can act on, by forcing a
sequence of human-approved decisions before construction begins.

It exists to close a specific gap: the person with the idea usually lacks the analytical training
to test it, and the person with the training lacks the time. Unexamined ideas then reach
construction, where mistakes are most expensive to correct.

Use it when:

- The cost of building the wrong thing substantially exceeds the cost of examining it first.
- The originator of an idea and its implementer are different people, or different roles held by
  the same person at different times.
- Machine assistance is available for drafting, but its output must be trustworthy.
- A written artefact is required for a decision, an approval, or a handover.

Do not use it when the build is cheaper than the analysis (prototype instead), when requirements
are genuinely emergent, or when no one is empowered to approve — gates then become queues.

## 2. Paradigm stance

Twelve positions, stated as commitments so a deviation is a visible decision rather than drift.

1. **Process** — linear and gated. No stage begins before its predecessor is approved.
2. **System structure** — layered monolith. One unit of deployment, internally ordered by
   responsibility.
3. **Interface organisation** — layer-based, by level of responsibility and dependency, not by
   file kind.
4. **Core state** — finite state machine. Explicit states and permitted transitions, not an
   accumulation of flags.
5. **Data** — relational. Entities and relationships declared in advance, enforced by the store.
6. **Interface style** — request–response. No implicit background coupling.
7. **Identity** — stateless token. Authority travels with the request.
8. **Artefact persistence** — immutable and versioned. Revision produces a new version.
9. **Validation** — human-in-the-loop. A person, not a rule, closes each gate.
10. **Machine assistance** — constrained generation. The machine writes into a fixed structure,
    citing only an approved source set.
11. **Verification** — test-after, invariant-first.
12. **Documentation** — decision records plus living documents.

Positions 8, 9 and 10 are load-bearing. Abandon any one and the method stops producing
trustworthy artefacts.

## 3. Principles

**3.1 The gate is the product.** Everything else is machinery around one rule: a stage may not
begin until its predecessor has been approved by a person. That rule must live in exactly one
place. Distributing it across the interface, the storage layer and the business logic is the most
common way this method is adopted in name and abandoned in practice.

**3.2 Questions are fixed; answers are not.** The questions asked at each stage are authored in
advance, reviewed like any other artefact, and changed deliberately — never generated on demand.
A machine cannot reliably infer which analysis a particular idea requires; a gate that generates
its own criteria is not a gate. The cost is adaptability: an unusual idea will be asked some
questions that do not fit. Determinism is the feature.

**3.3 Nothing is asserted that cannot be sourced.** Every figure in an output artefact must trace
to one of three origins: an answer the person gave, a curated reference set with provenance per
entry, or a response from an approved external source. Anything else is marked unvalidated and
rendered as such — not omitted. An absent figure looks like an oversight; a figure marked
unvalidated is information.

**3.4 Where sources disagree, report the disagreement.** Published figures for the same measure,
in the same period, routinely differ by an order of magnitude. Silently choosing one fabricates
consensus. Record every value, its origin and its date, and let the reader judge.

**3.5 Arithmetic is computed, never generated.** Any figure derived from other figures is
calculated deterministically and handed to the generator as a fact to narrate. A number that
changes between runs of the same inputs is not a finding. A computed value inherits the
confidence of its weakest input — confidence does not launder.

**3.6 Revision creates; it does not destroy.** Changing an answer produces a new version of every
affected artefact; the previous version remains. An approval workflow whose outputs can be
silently mutated is not an approval workflow, and the version history is the evidence that gates
were passed.

## 4. The method

### 4.1 Structure

Work proceeds through stages. Each has a fixed set of questions, a defined state, and one gate at
its end.

```
      ┌─────────────────────────────────────────────┐
      │                                             │
      ▼                                             │
  ┌────────┐    ┌──────────┐    ┌──────┐   revise   │
  │ Answer │───▶│ Complete?│───▶│ Gate │────────────┘
  └────────┘    └──────────┘    └──────┘
                     │ no           │ approve
                     └──────────┐   ▼
                                │  next stage
                                ▼
                          remain in stage
```

### 4.2 Stage states

Five, and only these:

- `pending` — not yet reachable; a prior stage is unapproved
- `in progress` — reachable, questions partially answered
- `awaiting approval` — all required questions answered, no decision yet
- `approved` — a person approved it, timestamped
- `revising` — previously approved or complete, and an answer is being changed

### 4.3 The two invariants

> I1. A stage reaches `approved` only when every required question has an answer.
>
> I2. Progress advances only from an `approved` stage, and only by one.

Implement these once. Test these first.

### 4.4 Artefact generation

Generation runs after the final gate, not per stage: artefacts frequently depend on one another,
and partial artefacts create state that must be merged.

Generate in dependency order. If artefact C synthesises material from A and B, then A and B are
produced first. Establish this order before implementation.

For each generated section:

1. Assemble the permitted context — answers, reference data, computed values, approved external
   responses.
2. Constrain the generator to that context explicitly.
3. On malformed output, mark that section unavailable and continue.
4. Record provenance per field.
5. Write a new version; never overwrite.

### 4.5 Failure is local

No single failure aborts generation. An external source that does not respond falls back to the
reference set; a reference entry that does not exist renders unvalidated; a generator that
returns unusable output marks its section unavailable. A partially complete artefact that is
honest about its gaps is more useful than a complete one that is quietly wrong.

## 5. The reference set

A curated collection of the figures the method is permitted to cite. It is authored content:
reviewed, versioned, and diffable alongside the implementation.

Every entry carries a value or an explicit null, a unit, a confidence tier, its source
(publisher, route, date retrieved), and any conflicting values with their own origins.

- Primary — read from the publisher's own material.
- Secondary — a real published figure obtained via a summary that names the original publisher.
- Tertiary — an aggregation whose original source is unnamed or unclear. Usable, and the weakest
  tier.
- Placeholder — not sourced. Value is null, and it renders unvalidated.

The contract, enforced automatically: a placeholder may never carry a value. This is the single
rule that prevents the reference set decaying into invention, and it must be checked
mechanically, not by discipline.

Expect coverage to be poor. A reference set covering a quarter of its intended fields is normal,
because the remainder renders unvalidated rather than fabricated. Padding it to look complete
defeats its purpose.

Keep it inspectable. It should be possible to open it in front of a sceptical reader and show
exactly what the system was permitted to assert — an argument unavailable if the data is hidden
inside a store.

## 6. Roles

One person may hold all three at different moments; the value lies in knowing which one is
currently occupied.

The **Originator** supplies the idea and answers the questions, with no gate authority. The
**Approver** judges whether a stage's answers are sufficient, and closes gates. The
**Implementer** receives the final artefacts and builds, with no gate authority.

The purpose is to make the Originator reason like an Approver, and the Approver reason like an
Implementer, before the Implementer is asked to commit effort.

## 7. Failure modes

- **Ceremonial gates.** Signature: every stage approved immediately, unread. Prevention:
  approval requires a recorded decision, not a click.
- **Generated questions.** Signature: questions vary between runs. Prevention: author them and
  version them.
- **Silent omission.** Signature: missing figures simply absent. Prevention: render unvalidated
  explicitly, with a reason.
- **Manufactured consensus.** Signature: one value where sources disagree. Prevention: record all
  values and their origins.
- **Generated arithmetic.** Signature: numbers differ between identical runs. Prevention: compute
  deterministically and forbid recalculation.
- **Confidence laundering.** Signature: weak input, confident output. Prevention: results inherit
  their weakest input's tier.
- **Padded reference set.** Signature: suspiciously complete coverage. Prevention: enforce the
  placeholder contract mechanically.
- **Scattered gate logic.** Signature: the rule appears in several places. Prevention: one module
  owns state transitions.
- **Destructive revision.** Signature: prior versions vanish. Prevention: version rows and files,
  never overwrite.
- **Aborting pipelines.** Signature: one failure loses everything. Prevention: fail locally, mark
  and continue.

## 8. Adoption checklist

- [ ] Questions are authored in advance and version-controlled
- [ ] Exactly one module may change stage state
- [ ] Invariants I1 and I2 have automated tests
- [ ] Stage state is one of the five defined values
- [ ] Revision produces a new version; nothing is overwritten
- [ ] Every generated figure traces to answer, reference set, or approved source
- [ ] Unsourced figures render unvalidated, with a reason, and are not omitted
- [ ] Conflicting sources are reported as conflicts
- [ ] Derived figures are computed, not generated
- [ ] Computed values inherit their weakest input's confidence
- [ ] The placeholder contract is enforced by an automated check
- [ ] The reference set is inspectable without a database
- [ ] Generation runs in declared dependency order
- [ ] No single failure aborts generation
- [ ] Significant decisions have recorded alternatives and consequences

## 9. What this method does not do

It does not determine whether an idea is good. It determines whether an idea has been examined,
and makes the examination legible to someone who was not present for it.

It does not remove judgement. It relocates judgement to points where it is recorded rather than
assumed.

It does not make generated content true. It makes the boundary between the sourced and the
unsourced visible.
