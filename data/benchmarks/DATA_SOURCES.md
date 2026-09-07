# Data Sources Catalogue

Version 3.0, 2026-08-24. Where biz2code's numbers come from, what is free, and what to add
later.

Twelve sources are approved and wired, ten of them keyless. The rule that governs all of them
(ADR-009) is that the citation allow-list is assembled at runtime from what actually returned
data — a source that answered nothing contributes no citation, and the field renders unvalidated.
That is why widening the set from two to twelve was safe.

`external_cache.source` carries a `CHECK` constraint listing exactly the approved sources. A
source that is not approved cannot be cached and therefore cannot reach a document; approving one
is a migration.

Verify the lot with `npm run probe:sources` — it calls every source live and exits non-zero if a
keyless one fails.

## Tier 1 — Live APIs, wired

**World Bank Indicators v2**, keyless. TAM/SAM/SOM grounding: population, GDP, urbanisation,
internet penetration. ~16,000 indicators, CC-BY with attribution required, annual granularity.

**Apple iTunes Search API**, keyless. Competitor discovery, pricing, ratings, and the store
listing the PRD mines for features. ~20 calls per minute, no CORS so server-side only, iOS only.

**OpenStreetMap via Overpass**, keyless. Premises counts, the TAM for a B2B venue product. Shared
community instance, so cache hard and use one query for all tag filters.

**Wikidata entity counts**, keyless. The same count from an encyclopaedic source, for the range.
Property-path queries need a 25 s timeout, not the default 8 s.

**Eurostat REST**, keyless. EU demographics and economics (JSON-stat). EU member states only.

**OECD SDMX**, keyless. Member-country economic indicators (SDMX-JSON). Dataflow keys are not
guessable; the caller supplies them.

**UN Statistics (SDG API)**, keyless. Global development indicators. Keys on UN M49 codes, not
ISO.

**Wikidata SPARQL**, keyless. Entity facts for named competitors. Exact-label match only, and it
needs a real User-Agent.

**data.gov.il**, keyless. Israeli public datasets (CKAN). The catalogue is Hebrew-indexed.

**Crossref**, keyless. Published academic sources behind a claim.

**Google Books**, optional key. Published book sources behind a claim. The anonymous quota is
shared and often exhausted (429).

**REST Countries**, key required. Country metadata, currency, M49 code. v3.1 was deprecated in
2026; v5 needs `Authorization: Bearer`.

**Open Exchange Rates**, free key. USD conversion for non-USD markets. The free tier is USD-base
only.

## Tier 2 — Approved, not yet wired

- FRED (St. Louis Fed), free key — US macro time series, CPI, rates.
- StatCounter GlobalStats, keyless — iOS/Android share by country, needed to narrow SAM by
  platform.
- National statistics offices (US Census, ONS, CBS Israel), keyless — household spend, business
  counts, age bands.

## Tier 3 — Benchmark publishers (report-only, no free API)

Where the `benchmarks.*.json` figures ultimately originate. None expose a free API; they publish
annual PDFs and web reports, which is why the constants file exists.

- Adjust, Mobile App Trends — free report download.
- AppsFlyer, State of App Marketing and State of Subscriptions — free report download.
- Liftoff, Mobile Ad Creative and the Gaming Apps Report — free report download.
- Sensor Tower, State of Mobile — free summary, paid data.
- Business of Apps, CPI and ARPU research pages — free web.
- UXCam, retention benchmarks — free web.
- Statista, category statistics — freemium, mostly paywalled.

Workflow: download the report, find the figure, update the JSON, set `confidence` to `primary`,
run `validate_benchmarks.py`.

## Tier 4 — Paid APIs (future work)

All out of scope for a one-week MVP on cost grounds.

- Sensor Tower, enterprise pricing — download and revenue estimates.
- data.ai (App Annie), enterprise pricing — market intelligence.
- Adjust or AppsFlyer as customers, usage-based — own-cohort attribution data.
- AppFollow, from ~$111/mo — review management, ASO analytics.
- SerpApi, ~$75/mo — App Store SERP scraping.
- SimilarWeb, paid — web and app traffic estimates.
- Crunchbase, paid — funding and company data.

## Tier 5 — MCP servers

Project decision: APIs preferred, MCP only where no suitable API exists. Not recommended for the
MVP — MCP adds a protocol layer and a failure surface for data already reachable over plain HTTP.
World Bank MCP servers exist but wrap the same free API; a web-search MCP would reintroduce the
ungrounded-citation risk the constants file exists to eliminate.

## Deliberately excluded

- Google Trends — no official API, and unofficial wrappers break and rate-limit.
- Google Play — no official free data API.
- The LLM's own knowledge — the entire point of the guardrail.

## Coverage today

- 43 / 194 vertical metrics sourced across 16 verticals
- 26 / 28 cross-vertical aggregate metrics sourced
- 0 verticals with zero data
- Proxy metrics are flagged `PROXY` in their note and carried into the document verbatim
- Metrics with conflicting published sources record every value, not the chosen one

### The gap that still binds

`install_to_paid_pct` — the rate at which an install becomes a paying customer — is 0 / 16 and
absent from the cross-vertical aggregate. It is the one number that blocks a consumer projection
outright.

It is also a metric that did not exist by that name until v3.0. The file previously held
`store_conversion_pct` with no definition anywhere — no `description`, null in all sixteen
verticals, so nobody ever had to decide what it meant. The industry uses "store conversion" for
page view to install (iOS ~25%); the funnel needs install to paying customer (~1–3%). Using one
where the other belongs overstates paying customers by roughly 25×.

Free sources that would close it, in order of fit:

- Adapty, State of In-App Subscriptions — install-to-trial, trial-to-paid, LTV, churn and renewal
  by category. Free, behind an email, no API.
- Adapty, Apple Ads install-to-paid — install to paid by channel, the derivation's exact step.
  Free, no API.
- RevenueCat, State of Subscription Apps — realized LTV, churn and conversion by category and
  price tier. Free, behind an email, no API.
- ChartMogul, SaaS Capital, Benchmarkit — B2B logo churn, CAC, CAC payback. Free, behind an email,
  no API.

None has an API, free or paid. Category benchmarks exist only as annual reports. What does have
an API is app intelligence — per-app downloads and revenue estimates — via Appfigures at
$9.99/month or Sensor Tower at $30k–150k/year, which is a different quantity: estimates per app,
not medians per category. This is why a curated JSON file is the architecture rather than a
client.

### Confidence tiers

- `primary` — read from the publisher's own report. Android vitals thresholds and every World
  Bank series qualify.
- `secondary` — a real published figure via a summary naming the primary vendor.
- `tertiary` — industry-blog aggregation, vendor unnamed or unclear. Weakest usable tier.
- `placeholder` — `value: null`, renders unvalidated.

### Conflicts recorded, not resolved

**Fintech D30 retention, 2% to 12%.** Adjust 2026 reports 2%; other sources report 10–15%. One
source traces the widely circulated 30 / 17.6 / 11.6 figures to an AppsFlyer 2023 subscription
cohort recycled for three years.

**Social D30 retention, 5% to 22%.** Stored as a band spanning all reported values.

**B2B logo churn, 3.5% against 4–5%.** The all-segment median against the SMB median. SMB is used
because a $450/month licence is an SMB contract, and the all-segment figure is carried as the
conflict.

### Deliberately left unvalidated

LTV:CAC 3:1 and tech debt at 30% of dev effort are rules of thumb, not measured benchmarks. Both
remain placeholders and the prompts are instructed not to assert them. A separate sourced figure
— a 1.5× LTV:CAC campaign viability floor — is stored and used instead.
