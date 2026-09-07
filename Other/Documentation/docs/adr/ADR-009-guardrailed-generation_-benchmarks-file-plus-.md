# ADR-009: Guardrailed generation — a benchmarks file plus an approved API set

## Context

No free API publishes app-industry benchmarks; they live in vendor reports. Unconstrained
generation would invent figures — the exact failure biz2code argues against.

## Decision

The LLM may cite only (a) the user's own answers, (b) `benchmarks/*.json`, (c) responses from the
approved API set. Anything else renders unvalidated. At the outset the API set was two keyless
sources: World Bank Indicators and the Apple iTunes Search API.

## Alternatives

Web-search or RAG grounding gives broader coverage but reintroduces unverifiable citations. A
paid benchmark API is authoritative but starts at $111/month, out of budget. A narrow, auditable
source set beats a broad, unverifiable one for a product whose pitch is epistemic discipline.

## Consequences

- The guardrail is a file you can open on stage.
- Coverage is thin: 43 of 194 vertical metrics sourced; the rest render unvalidated.
- iTunes has no CORS headers and allows ~20 req/min, so calls are server-side and cached.
- Where sources conflict (fintech, social), the document must surface the disagreement.

## Amendment, v3.0: the approved set is now twelve sources

The rule is unchanged, and is why widening is safe: the allow-list is still assembled at runtime
from what actually returned data. Widening adds sources that may be cited when they return data;
it does not license a citation the prompt did not carry.

Approved for, and auth as found on 2026-08-23:

- REST Countries — country metadata, currency, UN M49 code. Key required: v3.1 deprecated, v5
  wants a Bearer token.
- Eurostat — EU demographics and economics. Keyless.
- OECD SDMX — member-country economic indicators. Keyless.
- UN Statistics (SDG API) — global development indicators. Keyless.
- Wikidata SPARQL — entity facts and counts. Keyless.
- OpenStreetMap via Overpass — counts of premises, for B2B sizing. Keyless.
- data.gov.il — Israeli public datasets. Keyless.
- Open Exchange Rates — USD conversion for non-USD markets. Free-tier key.
- Crossref and Google Books — published sources behind a market claim. Keyless, and a shared
  quota respectively.
