# ADR-013: Two market models — consumer installs and B2B licence

## Context

The derivation was written for a consumer funnel: a population, a share of it reachable, a budget
divided by cost-per-install, a conversion rate, cohorts decaying at an app retention rate.

The seed project licenses indoor navigation to shopping centres at $450 a month. Its customer is
a premises, not an install. The consumer funnel gave it a market of 8.2 million people for a
product sellable to a few hundred buildings, and a customer lifetime of 1.05 months by reading
app 30-day retention as a renewal rate. Both are the same class of failure this product exists to
prevent: an answer that is confidently, precisely wrong.

## Decision

`p4q1` selects the model. `marketModelFor()` returns `consumer_installs` or `b2b_licence`, and
the derivation branches:

In the consumer branch the market is people: TAM is population times internet penetration,
narrowed by population segment and platform share; a customer costs CPI divided by the
install-to-paid rate; there is an install-to-paid conversion step; survival comes from app
retention or churn; and store commission applies as published.

In the B2B licence branch the market is premises: TAM is a count of tagged venues, narrowed by
nothing — segments narrow people, not buildings; a customer costs whatever winning one business
customer costs; there is no conversion step, because a signed venue already pays; survival comes
from B2B logo churn; and there is no store commission, because it is sold direct.

Premises are counted from OpenStreetMap via Overpass and from Wikidata, both keyless. They
disagree — 434 against 57 for Israel — because an open map records every tagged premises and an
encyclopaedia only notable ones. Both are carried, the range is reported, and the generous count
is the one used: a conclusion drawn against it cannot be argued down by saying the count was too
conservative.

## Alternative

One funnel with the founder choosing units is simpler, but the arithmetic differs, not just the
label — a signed venue has no conversion step. A third model (marketplace, advertising) will not
fit either branch cleanly, but two models that are each right beat one that is wrong for half the
catalogue, and the branch point is a single function a third can be added to.

## Consequences

- A market ceiling — the whole market at the founder's price — is computed for both models. It
  needs no benchmark, so it can render a verdict in a category with no data at all. On the seed
  project it refuses a $270,000 target against a $195,300 ceiling without a forecast.
- Population segments and platform share are not applied to a venue count.
- Wording follows the model. A founder selling to malls, told his plan fails for want of a
  cost-per-install, would conclude the tool had not understood his business.
- The benchmark files gained `b2b_cac_usd` and `b2b_logo_churn_monthly_pct`, both `tertiary` and
  both flagged PROXY.

## Known gap

Benchmark selection still keys only on category (`p1q2`). A B2B business in a consumer category
pulls consumer CPI and retention into BENCHMARKS CONSULTED even though the derivation ignores
them. The question bank's own help text for `p4q1` says business model predicts retention more
strongly than category, so the code contradicts its own documentation. Resolution deferred.
