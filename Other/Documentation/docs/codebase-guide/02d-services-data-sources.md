# 02d — Services: benchmarks and external sources

Phase 3, backend, part 4. Three files, **882 lines, 58 exports**:
`benchmark.service.ts` (233, 13 exports), `external.service.ts` (142, 8 exports),
`sources.service.ts` (507, 37 exports).

This is the guardrail layer — the modules that decide what the model is permitted to cite. It
also contains the largest gap between what the documentation describes and what the code does.

---

## `server/services/benchmark.service.ts` — 233 lines

**Purpose.** Load every `benchmarks.*.json` at import, validate the honesty contract, and resolve
a `(verticalId, metricKey)` pair into a fully-shaped answer that is never `null` and never
throws.

**[sibling] header:**

> *PURPOSE   Loads benchmarks/\*.json, resolves a metric, falls back cross-vertical.*
> *WHY       The guardrail. The LLM may cite ONLY what this returns.*
> *ADR       ADR-006, ADR-009*

**Related ADR:** ADR-006, ADR-008, ADR-009.

### 1.1 Types

| Name | Shape | Notes |
|---|---|---|
| `Confidence` | `'primary' \| 'secondary' \| 'tertiary' \| 'placeholder'` | **Four** tiers. `assumption` is a calculation-layer tier and never appears in a file |
| `MetricSource` | `publisher, via, url, tier, retrieved` — all nullable | `tier` here is a free-text label in the JSON, distinct from `confidence` |
| `Conflict` | `{ value, source, note }` | An array of these is how disagreement is recorded |
| `Metric` | `value, rangeLow, rangeHigh, unit, confidence, source, note, conflicts` | The raw file shape |
| `Resolved` | `Metric` **plus** `metricKey, requestedVerticalId, verticalId, usedFallback, usedAlias, isProxy, unvalidated, unvalidatedReason` | Eight fields of provenance added on the way out |
| `BenchmarkFile` *(private)* | `verticalId, displayName, sector, lastReviewed, metrics` | |

The four extra flags on `Resolved` are the four things the build guide **[sibling]** says must
survive resolution: *no sourced figure exists*, *borrowed from an adjacent vertical*, *a
cross-vertical aggregate rather than category-specific*, and *published sources disagree*. Each
is a separate boolean; none is inferred from another.

### 1.2 Functions

| Name | Signature | Inputs | Output | Side effects | Failure mode | Tested? | Called by |
|---|---|---|---|---|---|---|---|
| `fail` *(private)* | `(reason) => never` | — | never | none | **throws** `benchmarks are invalid — …` | via the boot tests | `validateMetric`, `load` |
| `validateMetric` *(private)* | `(where, m: Metric) => void` | one metric | — | none | throws on any of 5 contract violations | 3 tests in `describe('the honesty contract, enforced at boot')` | `load` |
| `load` *(private)* | `() => Map<string, BenchmarkFile>` | the directory | keyed by `verticalId` | **directory + file reads at import** | throws before `listen` | `it('loaded every vertical in the taxonomy')` | line 101, once |
| `isSourced` *(private)* | `(m?: Metric) => m is Metric` | — | type guard | none | — | indirectly | `resolve` |
| `proxyFlag` *(private)* | `(m: Metric) => boolean` | — | `note` starts with `PROXY` | none | — | `it('marks a proxy figure as a proxy on the resolved metric')` | `decorate`, `listProxies` |
| `decorate` *(private)* | `(metric, metricKey, requestedVerticalId, fromVerticalId, usedAlias) => Resolved` | — | a `Resolved` | none | cannot fail | — | `resolve` |
| `missing` *(private)* | `(metricKey, requestedVerticalId, reason) => Resolved` | — | a fully-shaped absence | none | cannot fail | `it('shapes a missing metric exactly like a real one')` | `resolve` |
| **`resolve`** | `(verticalId: string, metricKey: string) => Resolved` | ids | **never `null`, never throws** | none | *is* the failure path | **9 tests** in two describes | `calculate`, `derive`, `resolveMany` |
| `resolveMany` | `(verticalId, metricKeys[]) => Record<string, Resolved>` | — | keyed object | none | none | 1 test | not used in production — see below |
| `isUnvalidated` | `(m: Pick<Resolved,'value'\|'confidence'>) => boolean` | — | boolean | none | none | `it('isUnvalidated agrees with the resolved flag')` | not used in production |
| `caveats` | `(m: Resolved) => string[]` | — | 0-4 sentences | none | none | 3 tests | `calculation.fromBenchmark`, `prompts/context.renderBenchmarks` |
| `getVertical` | `(verticalId) => BenchmarkFile \| null` | — | the file or null | none | returns null | — | not used in production |
| `listVerticals` | `() => string[]` | — | sorted, excluding the fallback | none | none | `it('loaded every vertical in the taxonomy')` | not used in production |
| `listConflicts` | `() => Array<{verticalId, metricKey, conflicts}>` | — | every conflicting metric | none | none | 2 tests | not used in production |
| `listProxies` | `() => Array<{verticalId, metricKey, note}>` | — | every PROXY metric | none | none | 2 tests | not used in production |

**Five of the thirteen exports have no production caller.** `resolveMany`, `isUnvalidated`,
`getVertical`, `listVerticals`, `listConflicts` and `listProxies` are called only from
[benchmark.service.test.ts](../../../../server/services/benchmark.service.test.ts). They are
introspection helpers that exist so the test suite can assert facts about the corpus — a
legitimate purpose, worth naming so a reader does not hunt for the caller.

### 1.3 The function that cannot return null

```ts
export function resolve(verticalId: string, metricKey: string): Resolved
```

Its four-step order (lines 154-176):

1. **Unknown vertical → stop.** `if (!own) return missing(…, \`Unknown vertical '${verticalId}'.\`)`.
   No fallback. ADR-013's reasoning: a typo in `vertical_id` would otherwise draw global averages
   that read as researched. Asserted by `it('refuses to fall back for an unknown vertical')`.
2. **The vertical's own sourced figure**, if `isSourced`.
3. **The cross-vertical aggregate under the same key**, if sourced. Flagged `usedFallback`.
4. **The cross-vertical aggregate under a declared alias**, if sourced. Flagged `usedAlias`.
5. **Fall through:** if the vertical *has* the metric but unsourced, return that (so the caller
   sees the vertical's own placeholder rather than a generic absence); otherwise `missing(...)`.

Step 5's ordering matters — `it('a placeholder in the vertical does not block a sourced
aggregate')` asserts that the aggregate is tried *before* the vertical's own placeholder is
returned.

**The alias table** (lines 104-111):

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

Declared, never inferred — the build guide **[sibling]** argues that a "try a similar-looking
key" rule would let an iOS-only figure answer a request for a blended one silently.

**Three of the six entries contain the metric key itself as their first alias**, which line 167
explicitly skips (`if (alias === metricKey) continue;`). Those three self-entries are dead
weight: `retention_d1_pct`, `retention_d7_pct` and `retention_d30_pct` each list themselves
before the real alias. Harmless, but it means the table reads as if it has 6 useful aliases when
it has 6 keys and 6 usable aliases spread unevenly.

### 1.4 `caveats` — the sentences that reach the document

```ts
if (m.unvalidated) { out.push(reason); return out; }   // exactly one, and stop
if (m.usedFallback) → 'This is a cross-vertical aggregate, not a figure specific to this category.'
if (m.usedAlias)    → `Resolved from the related metric '${m.usedAlias}'.`
if (m.isProxy)      → m.note ?? 'Borrowed from an adjacent vertical…'
if (m.conflicts)    → `Published sources disagree: 2 (Adjust); 12 (…). The figure shown is one
                       reported value, not a consensus.`
```

The early return on line 192 is deliberate — an unvalidated metric gets **exactly one** caveat,
its reason, because the other four would be statements about a figure that does not exist.
Asserted by `it('gives an unvalidated figure exactly one caveat: why')`.

### 1.5 The contract, enforced twice

`validateMetric` (lines 66-82) re-implements
[validate_benchmarks.py](../../../../data/benchmarks/validate_benchmarks.py)'s rules 1-5 in
TypeScript, at boot:

| Rule | Python (CI) | TypeScript (boot) |
|---|---|---|
| 4 required fields present | ✓ | ✓ |
| `confidence` in the 4-value enum | ✓ | ✓ |
| placeholder ⇒ `value === null` | ✓ | ✓ |
| non-placeholder ⇒ value present **and** `source.publisher` set | ✓ | ✓ |
| percent within 0-100 | ✓ | ✓ |
| every taxonomy vertical has a file | ✓ | ✗ — TS checks only that the **fallback** file exists (line 97) |
| coverage warnings (proxy / conflict counts) | ✓ (warnings) | ✗ |

The duplication is deliberate — the build guide **[sibling]**: *"a benchmark file edited on the
demo laptop between the last CI run and the demo would otherwise reach the model unchecked."*
Verified as genuinely duplicated, not shared.

**One asymmetry worth knowing.** `load()` discovers files by directory scan
(`readdirSync(...).filter(f => f.startsWith('benchmarks.') && f.endsWith('.json') && f !==
'benchmarks.index.json')`, line 85-86) while the Python validator iterates `taxonomy.json`. So a
benchmark file **not** listed in the taxonomy is loaded and validated by TypeScript but ignored
by CI; a taxonomy entry with **no** file fails CI but not boot. The two checks cover different
sets.

### 1.6 Verified corpus figures

```bash
node -e "…"   # parsed every data/benchmarks/benchmarks.*.json
```

| Figure | Verified | Docs claim |
|---|---|---|
| Vertical files | **16** | 16 ✓ |
| Cross-vertical file | 1 (`_cross_vertical_default`) | ✓ |
| Vertical metrics | **194** | 194 ✓ |
| Vertical metrics sourced (`value !== null`) | **43** | 43 ✓ |
| Cross-vertical metrics | **28** | 28 ✓ (Master Plan) |
| Cross-vertical sourced | **26** | 26 ✓ (Master Plan); **21 of 23** in [SOURCES.md](../../../../data/benchmarks/SOURCES.md) ✗ |
| Tier census across all files | `placeholder` 153 · `secondary` 35 · `tertiary` 31 · `primary` 3 | — |

**`_schema.json` forbids a tier the data uses.**
[data/benchmarks/_schema.json](../../../../data/benchmarks/_schema.json) declares
`"confidence": { "enum": ["primary", "secondary", "placeholder"] }` — 31 metrics carry
`tertiary`. Both real validators accept `tertiary`, so nothing fails; the JSON Schema is simply
stale and would reject the corpus if anything ever ran it. Nothing does — `grep -rn "_schema"`
finds no reader. Details in [04-content-layer.md](04-content-layer.md).

---

## `server/services/external.service.ts` — 142 lines

**Purpose.** The two original ADR-009 sources — World Bank Indicators and the Apple iTunes Search
API — plus the shared cache primitives every other source client uses.

**Its own header (present):** `/* World Bank + iTunes clients, cached in external_cache. */`

**Related ADR:** ADR-009.

| Name | Signature | Inputs | Output | Side effects | Failure mode | Tested? | Called by |
|---|---|---|---|---|---|---|---|
| `getCached<T>` | `(source: string, key: string) => Promise<T \| null>` | — | payload or null | **DB read** | rejects on a DB error — callers wrap it in `.catch(() => null)` | no unit test | `worldBankIndicator`, `resolveCountry`, `itunesSearch`, `sources.viaCache` |
| `setCached` | `(source, key, payload) => Promise<void>` | — | — | **DB upsert** | rejects on a DB error or a `CHECK` violation — **always called with `.catch(() => {})`** | no unit test | the same four |
| `WorldBankResult` | interface | — | — | — | — | — | — |
| `worldBankIndicator` | `(country: string, indicator: string) => Promise<WorldBankResult \| null>` | ISO2 **or** ISO3 | one observation | **network + cache write**, 8 s timeout | **never throws** — falls back to cache, then `null` | no unit test | `gatherExternal`, `resolveSegments` |
| `ResolvedCountry` | interface | — | — | — | — | — | — |
| `normalise` *(private)* | `(s: string) => string` | — | lower-case, letters and spaces only | none | — | — | `resolveCountry` |
| `countryList` *(private)* | `() => Promise<WorldBankCountry[]>` | — | up to 400 countries, aggregates filtered out | **network + cache** | **throws** on a non-OK response — the only throwing function in the file | no unit test | `resolveCountry` |
| `resolveCountry` | `(name: string \| null) => Promise<ResolvedCountry \| null>` | the p2q2 answer | iso2/iso3/name | **network + cache** | catches `countryList`'s throw and returns `null` | no unit test | `gatherExternal` |
| `ItunesApp` | interface | — | — | — | — | — | — |
| `itunesSearch` | `(term, country?, limit?) => Promise<ItunesApp[]>` | — | apps, `[]` on failure | **network + cache**, 8 s | never throws; returns `[]` | no unit test | `gatherExternal` |

### 2.1 The cache-on-failure pattern

Both fetchers share one shape (World Bank at lines 42-65, iTunes at 130-141):

```
try   → fetch (8 s timeout) → parse → setCached(...).catch(() => {}) → return
catch → getCached(...).catch(() => null) → return that (or [] for iTunes)
```

**The `.catch(() => {})` on every write is the silent-failure the migration-002 comment
identifies:** a `CHECK` violation on `external_cache.source` would abort the insert with no
error anywhere, and the only symptom would be that every call became a live call.

### 2.2 `resolveCountry` — a three-level cache

1. `worldbank / country/<normalised name>` — the resolved triple, cached directly.
2. `worldbank / countries` — the whole 400-row list, cached by `countryList`.
3. A live fetch of the list.

`countryList` filters `c.region?.id !== 'NA'` (line 83) to drop World Bank *aggregates* (which
carry region `NA`), so "Arab World" cannot be matched as a country. Matching is by normalised
name, ISO2, or ISO3 (lines 97-100).

**Failure is silent and consequential.** `resolveCountry` returning `null` sends
`gatherExternal` to `wbCountry = 'WLD'` and `storefront = 'US'`
([generation.service.ts:99-100](../../../../server/services/generation.service.ts)) — the world
aggregate and the US App Store. The prompt does say so
([context.ts:123-129](../../../../server/prompts/context.ts)), which is the honest handling
ARCHITECTURE describes.

### 2.3 Two naming defects

`worldBankIndicator`'s parameter is `country: string` and its first statement is
`const countryIso2 = country;` (line 40) — but every caller passes an **ISO3** code
(`gatherExternal` passes `resolved?.iso3 ?? 'WLD'`; `resolveSegments` passes `countryIso3`). The
World Bank API accepts both, so the behaviour is correct and only the local variable name is
wrong. The same misnaming appears in
[fetch-seed-data.ts:12,69](../../../../server/scripts/fetch-seed-data.ts).

### 2.4 What is *not* here

There is **no staleness check**. `getCached` selects `payload` only (line 10-13); `fetched_at` is
written but never read anywhere in the codebase (`grep -rn "fetched_at" server --include="*.ts"`
→ two writes, zero reads). A cached World Bank figure from 2024 is served indefinitely, and the
index migration 002 added for staleness queries supports no query.

---

## `server/services/sources.service.ts` — 507 lines, 37 exports

**Purpose.** The ten Tier-2 approved sources as a registry plus paired pure parsers and cached
fetchers.

**Its own header (present):** `/* The eight Tier-2 sources approved on 2026-08-23, as cached
clients. */` — **the file says eight; `SourceId` declares ten.** The header was not updated when
`overpass` and `openexchangerates` joined.

**Related ADR:** ADR-009 amendment, ADR-013.

### 3.1 The registry

| Name | Signature | Output | Tested? |
|---|---|---|---|
| `SourceId` | union of 10 string literals | — | — |
| `SourceMeta` | `{ id, publisher, url, requiresKey, describes }` | — | — |
| `SOURCES` | `Record<SourceId, SourceMeta>` | 10 entries | 2 tests: `it('gives every source a publisher and a resolvable url')`, `it('marks exactly the two sources that need a key')` |
| `citationFor` | `(id: SourceId) => string` | `"Publisher — url"` | `it('formats a citation as publisher then url')` |

`requiresKey: true` on exactly two — `restcountries` and `openexchangerates`. `googlebooks` is
`false` because its key is optional (the anonymous quota exists but is shared).

**`citationFor` has no production caller.** `grep -rn "citationFor" server` → the definition, one
test. The citation strings that actually reach the prompt are built inline in
[context.ts:215-222](../../../../server/prompts/context.ts).

### 3.2 The transport

| Name | Signature | Behaviour | Tested? |
|---|---|---|---|
| `TIMEOUT_MS` *(private)* | `8000` | default | — |
| `SLOW_TIMEOUT_MS` *(private)* | `25000` | Overpass and the Wikidata property-path count | — |
| `USER_AGENT` *(private)* | `'biz2code/0.1 (business-validation tool; +https://github.com/biz2code)'` | Wikidata rejects a default agent | — |
| `viaCache<T>` *(private)* | `(source, cacheKey, url, parse, accept?, extraHeaders?, timeoutMs?) => Promise<T \| null>` | fetch → parse → cache → return; on any throw, read the cache | no direct test |

```ts
const parsed = parse(await res.json());
if (parsed === null) return null;               // an empty answer is NOT cached
await setCached(source, cacheKey, parsed).catch(() => {});
```

**Not caching a `null` parse is deliberate** — Coding Guide §3.2 **[sibling]**: *"An empty answer
is a fact about the query, not a payload worth keeping, and caching it would pin the emptiness in
place until someone cleared the table by hand."*

The two 25-second timeouts are the fix Coding Guide §3.3 **[sibling]** describes: both queries
were silently returning `null` against the 8-second default, and the failure looked exactly like
"no such data".

### 3.3 The ten clients — parser and fetcher, paired

Every source follows the same two-function shape. The parsers are pure and fixture-tested; the
fetchers touch the network and are exercised only by `probe:sources`.

| Source | Parser (pure, exported) | Fetcher | Parser tests | Fetcher reachable from the pipeline? |
|---|---|---|---|---|
| REST Countries | `parseCountryFacts` | `countryFacts(isoCode)` | **4** | **No** — and returns `null` unconditionally, §5 |
| Eurostat | `parseEurostat` | `eurostatIndicator(dataset, geo)` | **4** | **No** |
| OECD | `parseOecd` | `oecdIndicator(dataflow, key)` | **3** | **No** |
| UN SDG | `parseUnsd` | `unsdSeries(seriesCode, areaM49)` | **3** | **No** |
| Wikidata (entities) | `parseWikidata` | `competitorEntities(name, limit?)` | **3** | **No** |
| data.gov.il | `parseCkan` | `israeliDatasets(query, rows?)` | **3** | **No** |
| Open Exchange Rates | `parseOxr(quote)` — a **curried** parser | `usdTo(currencyCode)` | **2** | **No** — returns `null` unconditionally |
| Crossref | `parseCrossref` | `crossrefWorks(query, rows?)` | **2** | **No** |
| Google Books | `parseGoogleBooks` | `googleBooksWorks(query, rows?)` | **3** | **No** |
| Overpass | `parseOverpassCount` | `premisesCount(iso2, filters)` → `retailVenueCount(iso2)` | **0** | **Yes** — `derivationInputs.countVenues` |
| Wikidata (counts) | `parseWikidataCount` | `entityCountInCountry(classQid, countryQid)` → `notableMallCount(countryQid)` | **0** | **Yes** — Israel only |

**Two parsers have no test.** `parseOverpassCount` and `parseWikidataCount` are the only two of
the eleven with no fixture test — and they are the only two whose fetchers are reachable from
generation. The test suite covers nine parsers that never run in production and skips the two
that do.

**Interface consolidation.** `Observation` (`{value, period, label}`) is shared by Eurostat, OECD
and UNSD; `PublishedWork` by Crossref and Google Books; `PremisesCount` by Overpass and Wikidata
counts. So 10 sources produce 6 distinct result shapes.

### 3.4 Query-language injection defences

Two of the clients interpolate into a query language, and both validate first — Coding Guide §3.4
**[sibling]** treats these as SQL-equivalent.

**Overpass QL** ([sources.service.ts:407-419](../../../../server/services/sources.service.ts)):

```ts
const TAG_FILTER = /^[a-z_:]+=[A-Za-z0-9_:\- ]+$/;
const safe = filters.filter((f) => TAG_FILTER.test(f));
if (!safe.length || !/^[A-Za-z]{2}$/.test(iso2)) return null;
```

An allow-list, not an escape. A rejected filter is dropped; a rejected country returns `null`,
i.e. the same result as any other failure.

**SPARQL** — two different treatments:

- `entityCountInCountry` (line 443): `if (!/^Q[0-9]+$/.test(classQid) || !/^Q[0-9]+$/.test(countryQid)) return null;` — a strict allow-list.
- `competitorEntities` (line 267): `name.replace(/["\\\n\r]/g, ' ')` — an **escape**, not an
  allow-list, because the input is a free-text product name. It removes the four characters that
  could break out of the quoted literal. Weaker than the Q-number check, and appropriate for the
  input; worth knowing the two are not the same defence.

The cache key is derived from the sanitised value in both cases (`safe.slice().sort().join(',')`,
`safe.toLowerCase()`), so an injection attempt cannot poison a cache entry for a legitimate
query.

### 3.5 `gatherSupplementary` — and why it never runs

| Name | Signature | Output | Side effects | Failure mode | Tested? | Called by |
|---|---|---|---|---|---|---|
| `SupplementaryContext` | interface, 6 fields | — | — | — | — | — |
| `gatherSupplementary` | `(isoCode, competitorNames, problemStatement) => Promise<SupplementaryContext>` | country, fx, datasets, entities, literature, `used[]` | **network ×5** | every call is individually null-safe | **no test** | **nothing** |

```bash
grep -rn "gatherSupplementary" server client --include="*.ts" --include="*.tsx"
# → server/services/sources.service.ts:466   (the definition)
```

**One hit: the definition.** No route, controller, service or script calls it. It is 42 lines of
orchestration — the `mark()` helper that records which sources actually returned data, the
`Promise.all` of five parallel fetches, the Israel gate on data.gov.il — and none of it executes.

**This is why the twelve-source claim does not survive contact with the code.** Tracing every
source id to its call site:

| Source | Reachable from `generateAll`? | Only caller |
|---|---|---|
| `worldbank` | **Yes** | `gatherExternal`, `resolveSegments` |
| `itunes` | **Yes** | `gatherExternal` |
| `overpass` | **Yes** | `derivationInputs.countVenues` |
| `wikidata` | **Yes**, Israel only | `derivationInputs.countVenues` → `notableMallCount` |
| `restcountries` | No | `gatherSupplementary`, `probe-sources` |
| `eurostat` | No | `probe-sources` only |
| `oecd` | No | `probe-sources` only |
| `unsd` | No | `probe-sources` only |
| `datagovil` | No | `gatherSupplementary`, `probe-sources` |
| `crossref` | No | `gatherSupplementary`, `probe-sources` |
| `googlebooks` | No | `gatherSupplementary`, `probe-sources` |
| `openexchangerates` | No | `gatherSupplementary`, `probe-sources` |

**Four of twelve reach a document. Eight are reachable only from the live probe script.**

This is consistent with — and explains —
[context.ts:208-225](../../../../server/prompts/context.ts), where `allowedCitations` can only
ever add World Bank, Overpass, Wikidata and iTunes. The allow-list is not artificially narrow; it
is exactly as wide as the pipeline. ARCHITECTURE.md §2's system-context diagram, which shows
Eurostat, OECD, UNSD, Crossref, data.gov.il and Google Books feeding the Express process, does
not describe the current call graph.

Tracked as **D16** in [07-gaps-and-drift.md](07-gaps-and-drift.md).

### 3.6 The key removal that disabled data.gov.il

The [QA-Assessment-2026-08-24 follow-up](../qa/QA-Assessment-2026-08-24.md) records removing three
env vars and replacing them with local constants
([sources.service.ts:131-139](../../../../server/services/sources.service.ts)):

```ts
/*
  These three sources need a key this deployment does not carry. … The fetchers stay:
  restoring a source is a one-line change, and countryFacts in particular still gates the
  datagovil lookup downstream.
 */
const REST_COUNTRIES_KEY: string | null = null;
const OPEN_EXCHANGE_RATES_KEY: string | null = null;
const GOOGLE_BOOKS_KEY: string | null = null;
```

The QA note's stated reason for keeping `restcountries` was:

> *"Full removal was considered and rejected: `countryFacts` gates the `datagovil` lookup through
> `country?.iso2 === 'IL'`, so deleting `restcountries` would have silently killed a source that
> works today."*

**Setting the key to `null` achieves exactly what deleting the fetcher would have.** Traced:

```ts
export function countryFacts(isoCode: string): Promise<CountryFacts | null> {
  const key = REST_COUNTRIES_KEY;
  if (!key) return Promise.resolve(null);        // line 143 — always taken
  …
}
```

so in `gatherSupplementary`:

```ts
const country = isoCode ? mark('restcountries', await countryFacts(isoCode)) : null;   // always null
const wantsFx = country?.currencyCode && country.currencyCode !== 'USD';               // always falsy
const isIsrael = country?.iso2 === 'IL';                                               // always false
…
isIsrael && problemStatement ? israeliDatasets(...) : Promise.resolve(null),           // never called
```

**`israeliDatasets` can never be called from `gatherSupplementary`.** The dependency the QA note
identified is real; nulling the key severed it just as thoroughly as deletion would have.

In practice this changes nothing today, because `gatherSupplementary` itself has no caller — but
it means the mitigation recorded in the QA document did not achieve what it describes, and if
`gatherSupplementary` were ever wired in, `datagovil` would still be dead until a REST Countries
key is supplied.

**`probe:sources` continues to report `datagovil` as reachable** because it calls
`israeliDatasets('transport', 3)` directly
([probe-sources.ts:51](../../../../server/scripts/probe-sources.ts)), bypassing the gate. The QA
note's observation that the probe output was "byte-for-byte what it was before the key removal"
is therefore correct and not evidence that the pipeline is unaffected.

---

## Coverage summary for this section

| File | Lines | Exports | Unit tests | Untested exports |
|---|---|---|---|---|
| `benchmark.service.ts` | 233 | 13 | **25** | none — all 13 have at least one test |
| `external.service.ts` | 142 | 8 | **0** | all 8. Covered only by `probe:sources` and live generation |
| `sources.service.ts` | 507 | 37 | **30** | `citationFor` is tested; **every fetcher** is untested (by design — they need a network); `parseOverpassCount` and `parseWikidataCount` are untested **parsers**, and are the only two whose fetchers run in production; `gatherSupplementary` is untested and uncalled |

The shape of the gap is worth stating plainly: the parser tests are thorough and cover nine
sources that never reach a document, while the two parsers that do reach one have none.

---

*Next: [02e-services-generation.md](02e-services-generation.md) — the LLM boundary.*
