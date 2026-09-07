/* The eight Tier-2 sources approved on 2026-08-23, as cached clients. */

import { getCached, setCached } from './external.service';

/* ---------------------------------------------------------- the registry --- */

export type SourceId =
  | 'restcountries' | 'eurostat' | 'oecd' | 'unsd'
  | 'wikidata' | 'datagovil' | 'crossref' | 'googlebooks'
  | 'openexchangerates' | 'overpass';

export interface SourceMeta {
  id: SourceId;
  publisher: string;
  url: string;
  requiresKey: boolean;
  describes: string;
}

export const SOURCES: Record<SourceId, SourceMeta> = {
  restcountries: {
    id: 'restcountries', publisher: 'REST Countries', url: 'https://restcountries.com',
    requiresKey: true, describes: 'Country metadata: population, region, currency, M49 code.',
  },
  eurostat: {
    id: 'eurostat', publisher: 'Eurostat', url: 'https://ec.europa.eu/eurostat',
    requiresKey: false, describes: 'EU demographics and economic indicators.',
  },
  oecd: {
    id: 'oecd', publisher: 'OECD', url: 'https://sdmx.oecd.org',
    requiresKey: false, describes: 'Member-country economic indicators.',
  },
  unsd: {
    id: 'unsd', publisher: 'UN Statistics Division (SDG API)', url: 'https://unstats.un.org/sdgapi',
    requiresKey: false, describes: 'Global development indicators.',
  },
  wikidata: {
    id: 'wikidata', publisher: 'Wikidata', url: 'https://query.wikidata.org',
    requiresKey: false, describes: 'Entity and company facts for named competitors.',
  },
  datagovil: {
    id: 'datagovil', publisher: 'data.gov.il', url: 'https://data.gov.il',
    requiresKey: false, describes: 'Israeli public datasets.',
  },
  crossref: {
    id: 'crossref', publisher: 'Crossref', url: 'https://api.crossref.org',
    requiresKey: false, describes: 'Published academic sources supporting a market claim.',
  },
  googlebooks: {
    id: 'googlebooks', publisher: 'Google Books', url: 'https://books.google.com',
    requiresKey: false, describes: 'Published book sources supporting a market claim.',
  },
  openexchangerates: {
    id: 'openexchangerates', publisher: 'Open Exchange Rates', url: 'https://openexchangerates.org',
    requiresKey: true, describes: 'USD conversion for markets that do not price in dollars.',
  },
  overpass: {
    id: 'overpass', publisher: 'OpenStreetMap (Overpass API)', url: 'https://overpass-api.de',
    requiresKey: false,
    describes: 'Counts of physical premises — the addressable market for a business that sells to venues.',
  },
};

export const citationFor = (id: SourceId): string =>
  `${SOURCES[id].publisher} — ${SOURCES[id].url}`;

/* ------------------------------------------------------------- transport --- */

const TIMEOUT_MS = 8000;

const SLOW_TIMEOUT_MS = 25000;

const USER_AGENT = 'biz2code/0.1 (business-validation tool; +https://github.com/biz2code)';

async function viaCache<T>(
  source: SourceId,
  cacheKey: string,
  url: string,
  parse: (raw: unknown) => T | null,
  accept = 'application/json',
  extraHeaders: Record<string, string> = {},
  timeoutMs = TIMEOUT_MS,
): Promise<T | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': USER_AGENT, Accept: accept, ...extraHeaders },
    });
    if (!res.ok) throw new Error(`${source} ${res.status}`);
    const parsed = parse(await res.json());
    if (parsed === null) return null;
    await setCached(source, cacheKey, parsed).catch(() => {});
    return parsed;
  } catch {
    return await getCached<T>(source, cacheKey).catch(() => null);
  }
}

/* ======================================================= REST Countries === */

export interface CountryFacts {
  name: string;
  iso2: string;
  iso3: string;
  m49: string | null;
  population: number | null;
  region: string | null;
  subregion: string | null;
  currencyCode: string | null;
  currencyName: string | null;
}

export function parseCountryFacts(raw: unknown): CountryFacts | null {
  const rows = raw as Array<Record<string, any>> | undefined;
  const c = Array.isArray(rows) ? rows[0] : undefined;
  if (!c?.cca2) return null;
  const currencyCode = c.currencies ? Object.keys(c.currencies)[0] ?? null : null;
  return {
    name: c.name?.common ?? c.cca2,
    iso2: c.cca2,
    iso3: c.cca3 ?? c.cca2,
    m49: c.ccn3 ?? null,
    population: typeof c.population === 'number' ? c.population : null,
    region: c.region ?? null,
    subregion: c.subregion ?? null,
    currencyCode,
    currencyName: currencyCode ? c.currencies?.[currencyCode]?.name ?? null : null,
  };
}

/*
  These three sources need a key this deployment does not carry. Their env vars
  were removed rather than left blank forever, so the keys are declared absent
  here instead. The fetchers stay: restoring a source is a one-line change, and
  countryFacts in particular still gates the datagovil lookup downstream.
 */
const REST_COUNTRIES_KEY: string | null = null;
const OPEN_EXCHANGE_RATES_KEY: string | null = null;
const GOOGLE_BOOKS_KEY: string | null = null;

export function countryFacts(isoCode: string): Promise<CountryFacts | null> {
  const key = REST_COUNTRIES_KEY;
  if (!key) return Promise.resolve(null);
  return viaCache('restcountries', isoCode.toUpperCase(),
    `https://restcountries.com/v5/alpha/${encodeURIComponent(isoCode)}`
    + '?fields=name,cca2,cca3,ccn3,population,region,subregion,currencies',
    parseCountryFacts, 'application/json', { Authorization: `Bearer ${key}` });
}

/* ============================================================= Eurostat === */

export interface Observation {
  value: number;
  period: string | null;
  label: string | null;
}

export function parseEurostat(raw: unknown): Observation | null {
  const doc = raw as Record<string, any> | undefined;
  const values = doc?.value;
  if (!values || typeof values !== 'object') return null;

  const entries = Object.entries(values as Record<string, unknown>)
    .map(([k, v]) => [Number(k), v] as const)
    .filter(([, v]) => typeof v === 'number')
    .sort((a, b) => a[0] - b[0]);
  const last = entries[entries.length - 1];
  if (!last) return null;

  const timeCat = doc?.dimension?.time?.category;
  const periods: string[] = timeCat?.index
    ? (Array.isArray(timeCat.index)
      ? timeCat.index
      : Object.keys(timeCat.index).sort((a, b) => timeCat.index[a] - timeCat.index[b]))
    : [];
  const period = periods.length ? periods[periods.length - 1] ?? null : null;

  return { value: last[1] as number, period, label: doc?.label ?? null };
}

export const eurostatIndicator = (dataset: string, geo: string): Promise<Observation | null> =>
  viaCache('eurostat', `${dataset}/${geo}`,
    'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/'
    + `${encodeURIComponent(dataset)}?format=JSON&geo=${encodeURIComponent(geo)}&lastTimePeriod=1`,
    parseEurostat);

/* ================================================================= OECD === */

export function parseOecd(raw: unknown): Observation | null {
  const doc = raw as Record<string, any> | undefined;
  const series = doc?.data?.dataSets?.[0]?.series ?? doc?.dataSets?.[0]?.series;
  if (!series || typeof series !== 'object') return null;

  const first = Object.values(series)[0] as Record<string, any> | undefined;
  const observations = first?.observations;
  if (!observations || typeof observations !== 'object') return null;

  const indexed = Object.entries(observations)
    .map(([k, v]) => [Number(k), (v as unknown[])?.[0]] as const)
    .filter(([, v]) => typeof v === 'number')
    .sort((a, b) => a[0] - b[0]);
  const last = indexed[indexed.length - 1];
  if (!last) return null;

  const structure = doc?.data?.structure ?? doc?.structure;
  const timeDim = (structure?.dimensions?.observation ?? [])
    .find((d: any) => d.id === 'TIME_PERIOD' || d.id === 'TIME');
  const period = timeDim?.values?.[last[0]]?.id ?? timeDim?.values?.[last[0]]?.name ?? null;

  return { value: last[1] as number, period, label: structure?.name ?? null };
}

export const oecdIndicator = (dataflow: string, key: string): Promise<Observation | null> =>
  viaCache('oecd', `${dataflow}/${key}`,
    `https://sdmx.oecd.org/public/rest/data/${dataflow}/${key}`
    + '?format=jsondata&lastNObservations=1',
    parseOecd);

/* ================================================================= UNSD === */

export function parseUnsd(raw: unknown): Observation | null {
  const doc = raw as Record<string, any> | undefined;
  const rows: any[] = doc?.data ?? [];
  const usable = rows
    .filter((r) => r?.value !== null && r?.value !== undefined && !Number.isNaN(Number(r.value)))
    .sort((a, b) => Number(a.timePeriodStart ?? 0) - Number(b.timePeriodStart ?? 0));
  const last = usable[usable.length - 1];
  if (!last) return null;
  return {
    value: Number(last.value),
    period: last.timePeriodStart ? String(last.timePeriodStart) : null,
    label: last.seriesDescription ?? null,
  };
}

export const unsdSeries = (seriesCode: string, areaM49: string): Promise<Observation | null> =>
  viaCache('unsd', `${seriesCode}/${areaM49}`,
    `https://unstats.un.org/SDGAPI/v1/sdg/Series/Data?seriesCode=${encodeURIComponent(seriesCode)}`
    + `&areaCode=${encodeURIComponent(areaM49)}&pageSize=50`,
    parseUnsd);

/* ============================================================= Wikidata === */

export interface EntityFact {
  qid: string;
  label: string;
  description: string | null;
}

export function parseWikidata(raw: unknown): EntityFact[] | null {
  const rows = (raw as any)?.results?.bindings;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const out: EntityFact[] = [];
  for (const r of rows) {
    const uri: string | undefined = r?.item?.value;
    if (!uri) continue;
    out.push({
      qid: uri.split('/').pop() ?? uri,
      label: r?.itemLabel?.value ?? '',
      description: r?.itemDescription?.value ?? null,
    });
  }
  return out.length ? out : null;
}

export function competitorEntities(name: string, limit = 3): Promise<EntityFact[] | null> {
  const safe = name.replace(/["\\\n\r]/g, ' ').trim();
  if (!safe) return Promise.resolve(null);
  const sparql = `SELECT ?item ?itemLabel ?itemDescription WHERE {
  ?item rdfs:label "${safe}"@en .
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} LIMIT ${Math.max(1, Math.min(10, limit))}`;
  return viaCache('wikidata', safe.toLowerCase(),
    `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`,
    parseWikidata, 'application/sparql-results+json');
}

/* ============================================================ data.gov.il === */

export interface OpenDataset {
  title: string;
  notes: string | null;
  organization: string | null;
  url: string;
}

export function parseCkan(raw: unknown): OpenDataset[] | null {
  const results = (raw as any)?.result?.results;
  if (!Array.isArray(results) || results.length === 0) return null;
  return results.map((d: any) => ({
    title: d?.title ?? d?.name ?? '(untitled)',
    notes: typeof d?.notes === 'string' && d.notes.trim() ? d.notes.trim().slice(0, 400) : null,
    organization: d?.organization?.title ?? null,
    url: d?.name ? `https://data.gov.il/dataset/${d.name}` : 'https://data.gov.il',
  }));
}

export const israeliDatasets = (query: string, rows = 5): Promise<OpenDataset[] | null> =>
  viaCache('datagovil', query.toLowerCase(),
    `https://data.gov.il/api/3/action/package_search?q=${encodeURIComponent(query)}&rows=${rows}`,
    parseCkan);

/* =============================================== Open Exchange Rates === */

export interface FxRate {
  base: string;
  quote: string;
  rate: number;
  asOf: string | null;
}

export function parseOxr(quote: string) {
  return (raw: unknown): FxRate | null => {
    const doc = raw as Record<string, any> | undefined;
    const rate = doc?.rates?.[quote];
    if (typeof rate !== 'number') return null;
    return {
      base: doc?.base ?? 'USD',
      quote,
      rate,
      asOf: doc?.timestamp ? new Date(doc.timestamp * 1000).toISOString().slice(0, 10) : null,
    };
  };
}

export function usdTo(currencyCode: string): Promise<FxRate | null> {
  const key = OPEN_EXCHANGE_RATES_KEY;
  if (!key) return Promise.resolve(null);
  const quote = currencyCode.toUpperCase();
  return viaCache('openexchangerates', quote,
    `https://openexchangerates.org/api/latest.json?app_id=${encodeURIComponent(key)}`
    + `&base=USD&symbols=${encodeURIComponent(quote)}`,
    parseOxr(quote));
}

/* ================================================ Crossref & Google Books === */

export interface PublishedWork {
  title: string;
  authors: string | null;
  year: number | null;
  reference: string;
  via: 'Crossref' | 'Google Books';
}

export function parseCrossref(raw: unknown): PublishedWork[] | null {
  const items = (raw as any)?.message?.items;
  if (!Array.isArray(items) || items.length === 0) return null;
  const out = items.map((w: any): PublishedWork => ({
    title: Array.isArray(w?.title) ? w.title[0] ?? '(untitled)' : w?.title ?? '(untitled)',
    authors: Array.isArray(w?.author) && w.author.length
      ? w.author.slice(0, 3).map((a: any) => [a.given, a.family].filter(Boolean).join(' ')).join(', ')
      : null,
    year: w?.issued?.['date-parts']?.[0]?.[0] ?? null,
    reference: w?.DOI ? `https://doi.org/${w.DOI}` : 'https://api.crossref.org',
    via: 'Crossref',
  }));
  return out.length ? out : null;
}

export function parseGoogleBooks(raw: unknown): PublishedWork[] | null {
  const items = (raw as any)?.items;
  if (!Array.isArray(items) || items.length === 0) return null;
  const out = items.map((b: any): PublishedWork => {
    const v = b?.volumeInfo ?? {};
    const year = typeof v.publishedDate === 'string'
      ? Number(v.publishedDate.slice(0, 4)) || null : null;
    return {
      title: v.title ?? '(untitled)',
      authors: Array.isArray(v.authors) ? v.authors.slice(0, 3).join(', ') : null,
      year,
      reference: v.infoLink ?? v.canonicalVolumeLink ?? 'https://books.google.com',
      via: 'Google Books',
    };
  });
  return out.length ? out : null;
}

export const crossrefWorks = (query: string, rows = 5): Promise<PublishedWork[] | null> =>
  viaCache('crossref', query.toLowerCase(),
    `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(query)}`
    + `&rows=${rows}&select=title,author,issued,DOI`,
    parseCrossref);

export const googleBooksWorks = (query: string, rows = 5): Promise<PublishedWork[] | null> =>
  viaCache('googlebooks', query.toLowerCase(),
    `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}`
    + `&maxResults=${rows}&country=US`
    + (GOOGLE_BOOKS_KEY ? `&key=${encodeURIComponent(GOOGLE_BOOKS_KEY)}` : ''),
    parseGoogleBooks);

/* ============================================= premises, for B2B sizing === */

export interface PremisesCount {
  count: number;
  query: string;
}

export function parseOverpassCount(raw: unknown): PremisesCount | null {
  const el = (raw as any)?.elements?.[0];
  const total = el?.tags?.total;
  const n = Number(total);
  if (!Number.isFinite(n)) return null;
  return { count: n, query: '' };
}

const TAG_FILTER = /^[a-z_:]+=[A-Za-z0-9_:\- ]+$/;

export async function premisesCount(
  iso2: string, filters: string[],
): Promise<PremisesCount | null> {
  const safe = filters.filter((f) => TAG_FILTER.test(f));
  if (!safe.length || !/^[A-Za-z]{2}$/.test(iso2)) return null;

  const clauses = safe
    .map((f) => { const [k, v] = f.split('='); return `nwr["${k}"="${v}"](area.a);`; })
    .join('');
  const ql = `[out:json][timeout:90];area["ISO3166-1"="${iso2.toUpperCase()}"][admin_level=2]->.a;`
    + `(${clauses});out count;`;

  const key = `${iso2.toUpperCase()}/${safe.slice().sort().join(',')}`;
  const got = await viaCache('overpass', key,
    `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(ql)}`,
    parseOverpassCount, 'application/json', {}, SLOW_TIMEOUT_MS);
  return got ? { ...got, query: safe.join(' OR ') } : null;
}

export const retailVenueCount = (iso2: string): Promise<PremisesCount | null> =>
  premisesCount(iso2, ['shop=mall', 'shop=department_store']);

/* ------------------------------------------------ the same, from Wikidata --- */

export function parseWikidataCount(raw: unknown): PremisesCount | null {
  const b = (raw as any)?.results?.bindings?.[0];
  const n = Number(b?.n?.value);
  if (!Number.isFinite(n)) return null;
  return { count: n, query: '' };
}

export async function entityCountInCountry(
  classQid: string, countryQid: string,
): Promise<PremisesCount | null> {
  if (!/^Q[0-9]+$/.test(classQid) || !/^Q[0-9]+$/.test(countryQid)) return null;
  const sparql = `SELECT (COUNT(DISTINCT ?m) AS ?n) WHERE {`
    + ` ?m wdt:P31/wdt:P279* wd:${classQid} ; wdt:P17 wd:${countryQid} . }`;
  const got = await viaCache('wikidata', `count/${classQid}/${countryQid}`,
    `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`,
    parseWikidataCount, 'application/sparql-results+json', {}, SLOW_TIMEOUT_MS);
  return got ? { ...got, query: `${classQid} in ${countryQid}` } : null;
}

export const notableMallCount = (countryQid: string): Promise<PremisesCount | null> =>
  entityCountInCountry('Q11315', countryQid);

/* ================================================== the supplementary pass === */

export interface SupplementaryContext {
  country: CountryFacts | null;
  fx: FxRate | null;
  openDatasets: OpenDataset[] | null;
  competitorEntities: EntityFact[];
  literature: PublishedWork[];
  used: SourceId[];
}

export async function gatherSupplementary(
  isoCode: string | null,
  competitorNames: string[],
  problemStatement: string | null,
): Promise<SupplementaryContext> {
  const used: SourceId[] = [];
  const mark = <T>(id: SourceId, v: T | null): T | null => {
    if (v !== null && (!Array.isArray(v) || v.length > 0)) used.push(id);
    return v;
  };

  const country = isoCode ? mark('restcountries', await countryFacts(isoCode)) : null;

  const wantsFx = country?.currencyCode && country.currencyCode !== 'USD';
  const isIsrael = country?.iso2 === 'IL';

  const [fx, openDatasets, entityLists, crossref, books] = await Promise.all([
    wantsFx ? usdTo(country!.currencyCode!) : Promise.resolve(null),
    isIsrael && problemStatement
      ? israeliDatasets(problemStatement.split(/\s+/).slice(0, 6).join(' '))
      : Promise.resolve(null),
    Promise.all(competitorNames.slice(0, 3).map((n) => competitorEntities(n, 1))),
    problemStatement ? crossrefWorks(problemStatement, 3) : Promise.resolve(null),
    problemStatement ? googleBooksWorks(problemStatement, 3) : Promise.resolve(null),
  ]);

  mark('openexchangerates', fx);
  mark('datagovil', openDatasets);
  const entities = entityLists.flatMap((e) => e ?? []);
  mark('wikidata', entities.length ? entities : null);
  mark('crossref', crossref);
  mark('googlebooks', books);

  return {
    country,
    fx,
    openDatasets,
    competitorEntities: entities,
    literature: [...(crossref ?? []), ...(books ?? [])],
    used,
  };
}
