# 02d — Services: benchmarks and external sources (minimal)

Three files, **882 lines, 58 exports**: `benchmark.service.ts` (233, 13),
`external.service.ts` (142, 8), `sources.service.ts` (507, 37).
The guardrail layer — what the model is permitted to cite.

---

# 1. `benchmark.service.ts` — 233 lines

## 1.1 Types

| Name | Shape |
|---|---|
| `Confidence` | `primary \| secondary \| tertiary \| placeholder` — **four** tiers |
| `MetricSource` | `publisher, via, url, tier, retrieved` — all nullable |
| `Conflict` | `{ value, source, note }` |
| `Metric` | `value, rangeLow, rangeHigh, unit, confidence, source, note, conflicts` |
| `Resolved` | `Metric` **+** `metricKey, requestedVerticalId, verticalId, usedFallback, usedAlias, isProxy, unvalidated, unvalidatedReason` |
| `BenchmarkFile` | `verticalId, displayName, sector, lastReviewed, metrics` |

The four provenance flags are the four things that must survive resolution — *no sourced figure*,
*borrowed from an adjacent vertical*, *cross-vertical aggregate*, *sources disagree*. Each is a
separate boolean; none is inferred from another.

## 1.2 Exports

| Name | Signature | Notes |
|---|---|---|
| **`resolve`** | `(verticalId, metricKey) => Resolved` | **Never `null`, never throws.** 9 tests |
| `resolveMany` | `(verticalId, keys[]) => Record<string, Resolved>` | No production caller |
| `isUnvalidated` | `(m) => boolean` | No production caller |
| `caveats` | `(m: Resolved) => string[]` | 0-4 sentences. Used by `calculation.fromBenchmark`, `context.renderBenchmarks` |
| `getVertical` · `listVerticals` · `listConflicts` · `listProxies` | — | No production callers |

**Five of the thirteen exports have no production caller** — they are introspection helpers so
the test suite can assert facts about the corpus.

Private: `fail`, `validateMetric`, `load`, `isSourced`, `proxyFlag`, `decorate`, `missing`.

## 1.3 `resolve` — the function that cannot return null

Four-step order (154-176):

1. **Unknown vertical → stop.** `missing(…, "Unknown vertical 'X'.")`. **No fallback** — a typo
   in `vertical_id` would otherwise draw global averages that read as researched.
2. The vertical's own sourced figure.
3. The cross-vertical aggregate under the same key → `usedFallback`.
4. The cross-vertical aggregate under a declared alias → `usedAlias`.
5. Fall through: the vertical's own unsourced metric if it has one, else `missing(...)`.

Step 5's ordering matters — the aggregate is tried *before* the vertical's own placeholder.

```ts
const FALLBACK_ALIASES: Record<string, string[]> = {
  cpi_usd:           ['cpi_range_all_verticals_usd'],
  cpi_ios_usd:       ['cpi_ios_global_usd'],
  cpi_android_usd:   ['cpi_android_global_usd'],
  retention_d1_pct:  ['retention_d1_pct', 'retention_d1_good_pct'],
  retention_d7_pct:  ['retention_d7_pct', 'retention_d7_good_pct'],
  retention_d30_pct: ['retention_d30_pct', 'retention_d30_median_all_pct'],
};
```

Declared, never inferred. **Three entries list the metric key itself first**, which line 167
skips (`if (alias === metricKey) continue;`) — dead weight.

## 1.4 `caveats`

```
if (m.unvalidated) { out.push(reason); return out; }   // exactly one, and stop
if (m.usedFallback) → 'This is a cross-vertical aggregate, not a figure specific to this category.'
if (m.usedAlias)    → `Resolved from the related metric '<usedAlias>'.`
if (m.isProxy)      → m.note ?? 'Borrowed from an adjacent vertical…'
if (m.conflicts)    → `Published sources disagree: … The figure shown is one reported value,
                       not a consensus.`
```

The early return is deliberate — an unvalidated metric gets **exactly one** caveat, its reason,
because the other four would describe a figure that does not exist.

## 1.5 The contract, enforced twice

`validateMetric` re-implements `validate_benchmarks.py`'s rules in TypeScript, at boot:

| Rule | Python (CI) | TypeScript (boot) |
|---|---|---|
| 4 required fields present | ✓ | ✓ |
| `confidence` in the 4-value enum | ✓ | ✓ |
| placeholder ⇒ `value === null` | ✓ | ✓ |
| non-placeholder ⇒ value **and** `source.publisher` set | ✓ | ✓ |
| percent within 0-100 | ✓ | ✓ |
| every taxonomy vertical has a file | ✓ | ✗ — TS checks only that the fallback file exists |
| coverage warnings | ✓ | ✗ |

The duplication is deliberate: a benchmark file edited between the last CI run and the demo would
otherwise reach the model unchecked.

**Asymmetry:** `load()` discovers files by directory scan; the Python validator iterates
`taxonomy.json`. A file not in the taxonomy is validated by TS but ignored by CI; a taxonomy
entry with no file fails CI but not boot.

## 1.6 Verified corpus

| Figure | Verified | Docs claim |
|---|---|---|
| Vertical files | **16** | 16 ✓ |
| Cross-vertical file | 1 (`_cross_vertical_default`) | ✓ |
| Vertical metrics | **194** | 194 ✓ |
| Vertical sourced | **43** | 43 ✓ |
| Cross-vertical metrics | **28** | 28 ✓ |
| Cross-vertical sourced | **26** | 26 ✓ (Master Plan); **21 of 23** in `SOURCES.md` ✗ |
| Tier census | `placeholder` 153 · `secondary` 35 · `tertiary` 31 · `primary` 3 | — |

**`_schema.json` forbids a tier the data uses** — it declares
`"confidence": { "enum": ["primary","secondary","placeholder"] }` while 31 metrics carry
`tertiary`. Nothing reads `_schema.json`, so nothing fails.

---

# 2. `external.service.ts` — 142 lines

The two original ADR-009 sources (World Bank, iTunes) plus the shared cache primitives.

| Name | Signature | Failure mode |
|---|---|---|
| `getCached<T>` | `(source, key) => Promise<T \| null>` | Rejects on DB error — callers wrap in `.catch(() => null)` |
| `setCached` | `(source, key, payload) => Promise<void>` | Rejects on DB error or CHECK violation — **always called with `.catch(() => {})`** |
| `worldBankIndicator` | `(country, indicator) => Promise<WorldBankResult \| null>` | Never throws — cache, then `null`. 8 s timeout |
| `countryList` *(private)* | `() => Promise<WorldBankCountry[]>` | **Throws** on non-OK — the only throwing function here |
| `resolveCountry` | `(name) => Promise<ResolvedCountry \| null>` | Catches `countryList`'s throw, returns `null` |
| `itunesSearch` | `(term, country?, limit?) => Promise<ItunesApp[]>` | Never throws; `[]`. 8 s timeout |

## 2.1 The cache-on-failure pattern

```
try   → fetch (8 s timeout) → parse → setCached(...).catch(() => {}) → return
catch → getCached(...).catch(() => null) → return that (or [] for iTunes)
```

**The `.catch(() => {})` on every write is a silent failure:** a CHECK violation on
`external_cache.source` aborts the insert with no error anywhere, and the only symptom would be
that every call became a live call.

## 2.2 `resolveCountry` — a three-level cache

1. `worldbank / country/<normalised name>` — the resolved triple
2. `worldbank / countries` — the whole 400-row list
3. A live fetch

`countryList` filters `c.region?.id !== 'NA'` to drop World Bank *aggregates*, so "Arab World"
cannot match as a country. Matching is by normalised name, ISO2, or ISO3.

**Failure is silent and consequential** — `null` sends `gatherExternal` to `wbCountry = 'WLD'`
and `storefront = 'US'`. The prompt does say so (`context.ts:123-129`).

## 2.3 A naming defect

`worldBankIndicator`'s parameter is `country: string` and its first statement is
`const countryIso2 = country;`, but every caller passes an **ISO3** code. The World Bank API
accepts both, so only the variable name is wrong. Same misnaming in `fetch-seed-data.ts:12,69`.

## 2.4 What is not here

**No staleness check.** `getCached` selects `payload` only; `fetched_at` has two writes and zero
reads. A cached World Bank figure from 2024 is served indefinitely, and migration 002's index
supports no query.

---

# 3. `sources.service.ts` — 507 lines, 37 exports

Ten Tier-2 approved sources as a registry, plus paired pure parsers and cached fetchers.
**Its header says eight; `SourceId` declares ten** — not updated when `overpass` and
`openexchangerates` joined.

## 3.1 The registry

`SourceId` (10 literals) · `SourceMeta { id, publisher, url, requiresKey, describes }` ·
`SOURCES` (10 entries) · `citationFor(id) => "Publisher — url"`.

`requiresKey: true` on exactly two — `restcountries` and `openexchangerates`. `googlebooks` is
`false` because its key is optional.

**`citationFor` has no production caller** — the citation strings that reach the prompt are built
inline at `context.ts:215-222`.

## 3.2 The transport

| Name | Value / behaviour |
|---|---|
| `TIMEOUT_MS` | `8000` |
| `SLOW_TIMEOUT_MS` | `25000` — Overpass and the Wikidata property-path count |
| `USER_AGENT` | `'biz2code/0.1 (business-validation tool; +https://github.com/biz2code)'` — Wikidata rejects a default agent |
| `viaCache<T>` | fetch → parse → cache → return; on any throw, read the cache |

```ts
const parsed = parse(await res.json());
if (parsed === null) return null;               // an empty answer is NOT cached
await setCached(source, cacheKey, parsed).catch(() => {});
```

**Not caching a `null` parse is deliberate** — an empty answer is a fact about the query, and
caching it would pin the emptiness in place until someone cleared the table by hand.

The two 25-second timeouts are a fix: both queries were silently returning `null` against the
8-second default, and the failure looked exactly like "no such data".

## 3.3 The ten clients

| Source | Parser (pure, exported) | Fetcher | Parser tests | Reachable from the pipeline? |
|---|---|---|---:|---|
| REST Countries | `parseCountryFacts` | `countryFacts(isoCode)` | 4 | **No** — returns `null` unconditionally |
| Eurostat | `parseEurostat` | `eurostatIndicator(dataset, geo)` | 4 | **No** |
| OECD | `parseOecd` | `oecdIndicator(dataflow, key)` | 3 | **No** |
| UN SDG | `parseUnsd` | `unsdSeries(seriesCode, areaM49)` | 3 | **No** |
| Wikidata (entities) | `parseWikidata` | `competitorEntities(name, limit?)` | 3 | **No** |
| data.gov.il | `parseCkan` | `israeliDatasets(query, rows?)` | 3 | **No** |
| Open Exchange Rates | `parseOxr(quote)` — curried | `usdTo(currencyCode)` | 2 | **No** — returns `null` unconditionally |
| Crossref | `parseCrossref` | `crossrefWorks(query, rows?)` | 2 | **No** |
| Google Books | `parseGoogleBooks` | `googleBooksWorks(query, rows?)` | 3 | **No** |
| Overpass | `parseOverpassCount` | `premisesCount` → `retailVenueCount(iso2)` | **0** | **Yes** |
| Wikidata (counts) | `parseWikidataCount` | `entityCountInCountry` → `notableMallCount` | **0** | **Yes**, Israel only |

**The two parsers with no test are the only two whose fetchers run in production.** The suite
covers nine parsers that never run and skips the two that do.

**Interface consolidation** — `Observation {value, period, label}` shared by Eurostat/OECD/UNSD;
`PublishedWork` by Crossref/Google Books; `PremisesCount` by Overpass/Wikidata counts. 10 sources
produce 6 result shapes.

## 3.4 Query-language injection defences

**Overpass QL** (407-419) — an allow-list, not an escape:

```ts
const TAG_FILTER = /^[a-z_:]+=[A-Za-z0-9_:\- ]+$/;
const safe = filters.filter((f) => TAG_FILTER.test(f));
if (!safe.length || !/^[A-Za-z]{2}$/.test(iso2)) return null;
```

**SPARQL** — two different treatments:

- `entityCountInCountry` (443): `if (!/^Q[0-9]+$/.test(classQid) || !/^Q[0-9]+$/.test(countryQid))
  return null;` — a strict allow-list.
- `competitorEntities` (267): `name.replace(/["\\\n\r]/g, ' ')` — an **escape**, because the input
  is a free-text product name. Weaker, and appropriate for the input.

The cache key is derived from the **sanitised** value in both cases, so an injection attempt
cannot poison a legitimate query's cache entry.

## 3.5 `gatherSupplementary` — and why it never runs

`gatherSupplementary(isoCode, competitorNames, problemStatement)` — 42 lines orchestrating five
parallel fetches. **`grep` finds exactly one hit: the definition.** No route, controller, service
or script calls it. No test.

| Source | Reachable from `generateAll`? | Only caller |
|---|---|---|
| `worldbank` | **Yes** | `gatherExternal`, `resolveSegments` |
| `itunes` | **Yes** | `gatherExternal` |
| `overpass` | **Yes** | `derivationInputs.countVenues` |
| `wikidata` | **Yes**, Israel only | `countVenues` → `notableMallCount` |
| `restcountries` | No | `gatherSupplementary`, `probe-sources` |
| `eurostat` · `oecd` · `unsd` | No | `probe-sources` only |
| `datagovil` · `crossref` · `googlebooks` · `openexchangerates` | No | `gatherSupplementary`, `probe-sources` |

**Four of twelve reach a document. Eight are reachable only from the probe script.** The
allow-list is not artificially narrow — it is exactly as wide as the pipeline. ARCHITECTURE.md's
system-context diagram does not describe the current call graph. Tracked as **D16**.

## 3.6 The key removal that disabled data.gov.il

```ts
const REST_COUNTRIES_KEY: string | null = null;
const OPEN_EXCHANGE_RATES_KEY: string | null = null;
const GOOGLE_BOOKS_KEY: string | null = null;
```

The QA note kept `restcountries` because *"`countryFacts` gates the `datagovil` lookup through
`country?.iso2 === 'IL'`, so deleting it would have silently killed a source that works today."*

**Setting the key to `null` achieves exactly what deletion would have:**

```ts
export function countryFacts(isoCode: string): Promise<CountryFacts | null> {
  const key = REST_COUNTRIES_KEY;
  if (!key) return Promise.resolve(null);        // line 143 — always taken
```

so in `gatherSupplementary`: `country` is always `null` → `wantsFx` always falsy → `isIsrael`
always false → **`israeliDatasets` can never be called**.

Moot today, since `gatherSupplementary` has no caller — but the recorded mitigation did not
achieve what it describes.

**`probe:sources` still reports `datagovil` as reachable** because it calls
`israeliDatasets('transport', 3)` directly, bypassing the gate. So the probe output being
unchanged after the key removal is not evidence the pipeline is unaffected.

---

## Coverage

| File | Lines | Exports | Tests | Untested |
|---|---:|---:|---:|---|
| `benchmark.service.ts` | 233 | 13 | **25** | none |
| `external.service.ts` | 142 | 8 | **0** | all 8 — `probe:sources` and live generation only |
| `sources.service.ts` | 507 | 37 | **30** | every fetcher (by design); `parseOverpassCount` and `parseWikidataCount` — the only two parsers whose fetchers run in production; `gatherSupplementary` |

The parser tests are thorough and cover nine sources that never reach a document, while the two
that do have none.
