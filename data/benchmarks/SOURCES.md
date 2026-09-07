# Benchmark Data Layer — sourcing and honesty contract

A curated, inspectable set of industry benchmark constants the LLM is hard-constrained to cite
from. It exists because no free API serves app-industry benchmarks (ARPU by vertical, retention
curves, LTV:CAC) — those live in Adjust, Liftoff and Sensor Tower reports, at enterprise pricing
or ~$111/month and up.

## The contract

1. Every metric carries `value`, `unit`, `confidence` and `source`.
2. `confidence` is one of `primary`, `secondary` or `placeholder`.
3. A `placeholder` has `value` of `null`. A placeholder never invents a number.
4. Anything not a placeholder has a value present and `source.publisher` set.
5. Percent metrics are within 0–100.
6. Every vertical in `taxonomy.json` has a file.

Enforced by `validate_benchmarks.py`, which exits 1 on violation. It runs in CI.

## Confidence tiers

- `primary` — read directly from the publisher's own report or page.
- `secondary` — a real published figure reached via a summary that cites the primary vendor.
  Verify before quoting in a graded deliverable.
- `placeholder` — not yet sourced. `value` is `null`, the app renders unvalidated, and the LLM is
  forbidden from asserting a figure.

## Coverage

43 of 194 vertical metrics sourced across 16 verticals (up from 7). 21 of 23 cross-vertical
metrics sourced. No vertical is empty.

That is deliberate. Seeding 137 invented numbers to make the files look complete would reproduce
the hallucination failure biz2code exists to prevent.

Full catalogue of sources, tiers and future additions: `DATA_SOURCES.md`.

### The demo vertical uses proxy data

`navigation_local` — indoor navigation, the seed project — has no navigation-specific published
benchmarks. Its two figures are borrowed from the adjacent Travel & Local / utilities band and
are flagged `PROXY` in the JSON. Every other metric renders unvalidated.

Worth saying out loud on stage: the app declares where a number came from and refuses to dress a
proxy up as a measurement.

### Two metrics have conflicting sources

Fintech D30 (published 2%–12%) and Social D30 (published 5%–22%). Both carry a `conflicts` array
listing every reported value and its origin, and the generated documents surface the disagreement
rather than silently picking one.

## Deliberately excluded

Two figures in the original template are rules of thumb, not measured benchmarks, and are left as
placeholders rather than asserted: LTV:CAC 3:1, and tech debt at 30% of dev effort. Source them
or leave them unvalidated; do not let the LLM state them as fact.

## Live APIs — a complement, not a replacement

**World Bank Indicators v2**, keyless. TAM/SAM/SOM grounding: population, GDP, urbanisation,
internet penetration. ~16,000 indicators, CC-BY, attribution required.

**Apple iTunes Search**, keyless. Competitor discovery, pricing, ratings, category. ~20 calls per
minute, no CORS, so server-side only.

Neither covers monetisation benchmarks. That gap is why this file exists.

## Maintenance

1. Find a figure in a report you trust.
2. Set `value`, set `confidence` to `primary` or `secondary`, fill `source`.
3. Update `lastReviewed`.
4. Run `python3 validate_benchmarks.py`.

Benchmarks age fast — one vertical in the seed data was reported as declining sharply year over
year. Re-check `lastReviewed` before every serious use.
