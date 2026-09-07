# Data Source Options — closing the unvalidated gap

Status: for review, prepared 2026-08-23. Which statistics sources should biz2code connect to so
that ~90% of generated document fields carry a citation instead of an `unvalidated` badge.

## 1. What is actually unvalidated

Two separate numbers get conflated when people say "most of it is unvalidated".

### 1a. Benchmark cells — 151 of 194 are placeholders

`data/benchmarks/*.json` holds 16 verticals × ~12 metrics. Counted from the files:

Sourced, out of 16 verticals each: `retention_d30_pct` 15, `retention_d1_pct` 8,
`retention_d7_pct` 6, `cpi_usd` 5, `arpu_12mo_blended_usd` 4, `retention_d365_pct` 1,
`cpi_ios_usd` 1, `cpi_android_usd` 1, and zero for `trial_to_paid_pct`, `ltv_usd`,
`churn_monthly_pct` and `store_conversion_pct`. That is 43 sourced against 151 missing.

Four keys are empty across every vertical. Those four alone are 64 of the 151 gaps, and they
drive LTV, payback and unit economics.

### 1b. Document fields — 17 of 23 unvalidated

From the last recorded run (`docs/qa/evidence/generation-probe.json`, 2026-08-22). The three
templates declare 5 + 7 + 11 = 23 fields; seventeen came back flagged, for three different
reasons:

**Eleven have no source for the figure, and new data would fix all of them:**
`mrd.revenue_potential_by_segment`, `mrd.market_audience_sizing`, `prd.dev_cost`,
`prd.technical_health`, `bp.budget_engineering`, `bp.budget_infrastructure`,
`bp.budget_monthly_tco`, `bp.revenue_unit_economics`, `bp.revenue_rpv`,
`bp.revenue_extrapolation`, `bp.revenue_projected_growth`.

**Two are partly sourceable:** `prd.ux_vitals`, `mrd.segmentation_personas`.

**Four are unvalidated by instruction rather than by data**, so no data purchase changes them —
they need a prompt and policy decision: `mrd.market_requirements`, `prd.rice`,
`bp.product_weaknesses`, `bp.final_summary_outcome`.

Connecting data can take 17 → 4, i.e. 74% unvalidated → ~17%. Getting under 10% needs the prompt
work as well. Both are in §4.

### 1c. Three structural choke points

1. No monetisation data at all. `trial_to_paid`, `ltv`, `churn`, `store_conversion` are empty
   everywhere, which is why `bp.revenue_*` is uniformly unvalidated.
2. No cost-side data. Nothing grounds a developer salary, a cloud bill, or a quality target.
3. No category market size. The World Bank gives population and internet penetration, not "the
   Israeli food-delivery market". `mrd.market_audience_sizing` has a denominator, no numerator.

## 2. The source catalogue

Grouped by which gap each closes. Each was checked for auth and access in August 2026. Tier
is the confidence label a figure from that source would carry.

### Group A — Mobile app monetisation and retention by category

Closes the four all-empty metric keys. Highest-value group.

**RevenueCat, State of Subscription Apps 2026.** Fills `trial_to_paid_pct`,
`churn_monthly_pct`, `ltv_usd` (realized), `store_conversion_pct`, retention curves and ARPU,
broken out by app category. Free, email for the PDF; a 338-page report plus per-category pages.
Secondary tier, roughly a day of manual reading into JSON.

**AppsFlyer, State of App Marketing.** CPI, retention D1–D30 and remarketing, by vertical and
country. Free behind an email, annual PDF. Secondary tier, about half a day.

**Adjust, Mobile App Trends.** Retention by vertical, session data. Free behind an email, annual
PDF. Secondary tier, about half a day.

**Liftoff reports.** CPI and install-to-purchase, by vertical. Free behind an email, annual PDF.
Secondary tier, about half a day.

**Business of Apps research pages.** `cpi_usd`, `cpi_ios_usd`, `cpi_android_usd` and ARPU per
category. Free web pages, no auth. Tertiary tier, about half a day.

**Sensor Tower, State of Mobile.** Category downloads and consumer spend, market size by category
and country. Free summary behind an email, annual PDF. Secondary tier, about half a day.

RevenueCat is the top recommendation: it is the only free source publishing subscription
economics — trial conversion, renewal churn, realized LTV — segmented by app category. Those are
exactly the four keys empty in all 16 verticals. One ingest plausibly converts 60–90 of the 151
empty cells.

### Group B — Public-company comparables

The only free primary-tier route.

**SEC EDGAR XBRL API** (`data.sec.gov/api/xbrl/companyfacts`, `/frames`). Fills
`arpu_12mo_blended_usd`, `churn_monthly_pct`, paying-user counts and revenue, read from the
filer's own 10-K/10-Q. Keyless, free, JSON REST at 10 req/s. Primary tier, 1–2 days of work.

Most verticals have a listed pure-play disclosing ARPU or revenue-per-payer as a headline metric:

dating: Match Group, Bumble. streaming: Netflix, Spotify. social_media: Meta, Snap, Pinterest.
media_news: New York Times. productivity: Dropbox. fintech: Robinhood, SoFi. food_delivery:
DoorDash. travel: Airbnb, Booking. ecommerce_retail: Etsy, Shopify. education: Duolingo,
Coursera. real_estate: Zillow, CoStar. health_fitness: Peloton. b2b_saas: Atlassian, HubSpot,
Asana.

A listed leader's ARPU is not the category median — it is the top of the category. That is a
labelling problem, and the existing `isProxy` machinery already handles it.

### Group C — Market sizing, macro and demographics

All are free. Auth is noted only where a key is needed.

- **World Bank WDI** (already wired) — population, internet %, GDP, urbanisation. REST, CC-BY.
  Primary.
- **IMF, OECD SDMX, Eurostat REST** — GDP, household consumption, ICT spend. REST/SDMX. Primary.
- **National statistics offices** (CBS Israel / `data.gov.il`, US Census, ONS) — household spend
  by category, business counts, age bands. REST/CSV. Primary.
- **DataReportal, Digital 2026** — device ownership, app usage hours, adoption by country. Report
  plus slides. Secondary.
- **Our World in Data** — long-run development and tech-adoption series. CSV/API. Primary.
- **StatCounter GlobalStats** — iOS vs Android share by country. CSV download. Secondary.
- **OpenStreetMap Overpass API** — bottom-up TAM: count actual venues in the named market. REST,
  ODbL. Secondary.
- **FRED**, free key — inflation and CPI for multi-year cost escalation. REST. Primary.
- **Frankfurter / ECB rates** — currency conversion for non-USD markets. REST. Primary.

Overpass is the only source here producing a defensible bottom-up market size rather than a
top-down guess, and it directly serves the demo project.

### Group D — Cost side

Closes `prd.dev_cost` and the three budget fields.

- **US BLS OEWS** (`api.bls.gov`), free key — software developer wages by metro and occupation.
  REST. Primary.
- **Eurostat labour cost / CBS Israel wage series**, keyless — the same for the EU and Israel.
  REST/CSV. Primary.
- **Stack Overflow Developer Survey**, keyless — self-reported comp by country and stack. CSV,
  ODbL. Tertiary.
- **AWS Price List Bulk API**, keyless — real compute, storage and egress unit prices, no AWS
  account needed. Public JSON. Primary.
- **GCP Cloud Billing Catalog / Azure Retail Prices** — the same for other clouds; Azure is
  keyless, GCP needs a key. REST. Primary.

### Group E — Quality and performance targets

- **Google Play Android vitals thresholds**, keyless and free — published numeric thresholds from
  the platform owner: user-perceived crash 1.09%, ANR 0.47%, per-device crash 8%, slow cold start.
  Primary.
- **Apple App Store Review Guidelines and HIG**, keyless and free — qualitative expectations, no
  numeric SLO. Tertiary.
- **Chrome UX Report (CrUX)**, free key — Core Web Vitals field data, web and PWA only. Primary.

A free win. [documents.ts:169](../server/prompts/documents.ts) currently instructs the model that
no sourced targets exist for these. That is factually wrong — Google publishes exact thresholds.
A benchmark entry plus a prompt edit removes one guaranteed-unvalidated field from every
document.

### Group F — Competitive and app-store data

- **Apple iTunes Search API** (already wired), keyless and free — iOS competitors, price,
  ratings. ~20 req/min, iOS only.
- **Apple App Store Transparency Report**, keyless and free — apps per category, downloads,
  developer counts, by region. Annual and coarse.
- **`google-play-scraper`** (npm), keyless and free — the Android half: pricing, installs,
  ratings. Unofficial, unmaintained, breaks on layout changes, and against Google's ToS. Not
  recommended.
- **Appfigures API**, key, from ~$10/mo — app intelligence across both stores. The cheapest
  legitimate route to Google Play data.
- **SerpApi / Bright Data**, key, $75/mo and up — store SERP scraping at scale, licensed.
- **Sensor Tower / data.ai**, key, enterprise pricing — download and revenue estimates. Out of
  budget.

### Group G — Weak-tier signal sources

Only worth wiring if §5's new tier is adopted. Directional, not measurements.

- Wikipedia Pageviews API, keyless and free — a demand proxy for a topic or competitor.
- Crunchbase / Dealroom free tier, key, freemium — funding rounds as a market-validation signal.
- Statista free tier, keyless — headline category statistics, mostly paywalled.
- Reddit and Stack Exchange APIs, free — problem-prevalence evidence for the MRD.

## 3. Deliberately still excluded

- Google Trends — no official API, and unofficial wrappers rate-limit and break.
- The LLM's own knowledge — the entire premise of the product.
- Generic web-search grounding — reintroduces the unverifiable citation ADR-009 prevents.
- Scraping Google Play in-product — ToS exposure and silent breakage; use Appfigures instead.

## 4. Recommended path to ≥90%

**Phase 1 — free, no new dependency, ~2 days. 74% unvalidated → ~35%**

1. RevenueCat SoSA 2026 → benchmark JSONs. Fills `trial_to_paid_pct`, `churn_monthly_pct`,
   `ltv_usd`, `store_conversion_pct`. Est. 60–90 of 151 cells.
2. Business of Apps + AppsFlyer → CPI and ARPU. Est. 40–55 cells.
3. Android vitals thresholds → new `crash_rate_threshold_pct` / `anr_rate_threshold_pct`
   metrics, plus the prompt edit. Fixes `prd.technical_health` outright.

Benchmark coverage goes from 22% to ~85–95%, and four revenue fields gain sourced inputs.

**Phase 2 — two new keyless APIs, ~3 days. ~35% → ~17%**

4. SEC EDGAR XBRL for primary-tier ARPU/churn comparables per vertical.
5. AWS Price List Bulk plus BLS OEWS for the three budget fields.
6. A national statistics office (CBS Israel first) for the market-size numerator.

**Phase 3 — prompt and policy, ~1 day. ~17% → ~9%**

7. Change the four "mark this field unvalidated" instructions to distinguish "no figure exists"
   from "this is a reasoned judgement". Conflating them is what produces the 74%.
8. `bp.product_weaknesses` and `bp.final_summary_outcome` should inherit "contains unvalidated
   inputs" rather than being flagged wholesale.

Landing point: ~2 of 23 fields unvalidated, ≈91% validated. The two that remain (personas, RICE
impact/confidence) are genuinely unmeasurable.

## 5. The tier change this requires

Figures may come from a weaker source as long as the document says so, but the current scheme
cannot express that: the one honest tier below `tertiary` is `placeholder`, which means no number
at all.

Proposal: add `indicative`, ranked between `tertiary` and `placeholder` — a real published number
from an aggregator, vendor blog, or single-company comparable, not verified against a primary
report. Rendered with the number and a visible warning naming the source and its weakness. Never
presented as a measurement.

`placeholder` still means `value: null`, so nothing may invent a number.

Three places must change together, and they currently disagree:

- [validate_benchmarks.py:44](../data/benchmarks/validate_benchmarks.py#L44) accepts primary,
  secondary, tertiary, placeholder.
- [benchmark.service.ts:87](../server/services/benchmark.service.ts#L87) accepts the same four.
- [_schema.json](../data/benchmarks/_schema.json) accepts only primary, secondary and placeholder
  — already stale, since `tertiary` is missing yet 8 benchmark files use it.

The `_schema.json` enum is out of date today, independent of this proposal.

Also needed: `calculation.service.ts` ranks tiers in `TIERS` (weakest wins), so `indicative` must
be inserted there, and `UnvalidatedBadge.tsx` needs a softer variant so the UI can distinguish
weakly sourced from not sourced.

## 6. Decisions needed

1. Which Group A report to ingest first. Recommendation: RevenueCat, on category coverage.
2. SEC EDGAR, yes or no. Free, keyless, the only primary-tier option — but it grounds category
   ARPU in a single listed leader, which must be labelled as such.
3. Google Play data: Appfigures (~$10/mo) or stay iOS-only. Scraping is not recommended.
4. Adopt the `indicative` tier? Without it, weaker sources cannot be used at all.
5. Approve the Phase 3 prompt change. The four instruction-driven flags are ~17 percentage points
   of the current figure and cost nothing but a decision.
