# ADR-012: The founder states objectives; the market is derived

## Context

Three questions asked the user for measurements he could not have: the size of his reachable
market (`p2q3`), the rate at which users would convert (`p4q3`), and how long a paying customer
would stay (`p4q6`).

Every economic figure descended from those three. `paying_users` was
`reachable_market × conversion_pct` — a guess multiplied by a guess, presented with the authority
of arithmetic. The documents then narrated his own assumptions back at him, so there was nothing
independent to validate against.

## Decision

The founder is asked for objectives and decisions only, never for a market estimate.

- Objectives: the revenue band that makes the product worth building, the adoption target, the
  horizon.
- Decisions: the price he intends to charge, what he can spend to build and to reach users, the
  business model, the platforms, the target group.

The market is derived from published sources in `derivation.service.ts`, and the two are compared
to produce a verdict. An objective is never an input to a projection, only ever compared against
one — a goal that could feed a forecast would produce a forecast that agrees with it. A test
asserts exactly this: two runs differing only in the stated objective produce identical
projections.

## Alternatives

Keeping the questions and labelling the answers as assumptions was the existing behaviour; the
label was already there and did not help. Asking and then cross-checking against a derived figure
anchors the founder to his own number, and still demands expertise he does not have.

The cost of deriving is real: a category with thin data now produces an unvalidated projection
where it previously produced a confident wrong one. That is the trade the product is named for.

## Consequences

- `p2q3`, `p4q3` and `p4q6` are retired. Their ids are never reused — a retired id meaning
  something new later is the kind of quiet breakage no test catches.
- `p4q8` asks for a band, not a point: a floor below which the founder would stop, and a target
  he is aiming at. Asked separately those produced two unrelated numbers. The band also replaced
  an arbitrary 0.6 ratio in the verdict — "ambitious" now means clears your floor, misses your
  target.
- The economics layer takes paying customers, customer lifetime and cost-per-customer from the
  derivation rather than computing them from answers.
- The verdict — proceed, revise the objective, or do not proceed — is the product's actual
  output. Everything else is the working.
