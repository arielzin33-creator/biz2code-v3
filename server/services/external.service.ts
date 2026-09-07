/* World Bank + iTunes clients, cached in external_cache. */

import { query } from '../db/query';

const WORLD_BANK_BASE = 'https://api.worldbank.org/v2';
const ITUNES_BASE = 'https://itunes.apple.com/search';

// ---------------------------------------------------------------- cache ---
export async function getCached<T>(source: string, key: string): Promise<T | null> {
  const row = await query<{ payload: T }>(
    'SELECT payload FROM external_cache WHERE source = $1 AND cache_key = $2',
    [source, key],
  );
  return row[0]?.payload ?? null;
}

export async function setCached(source: string, key: string, payload: unknown) {
  await query(
    `INSERT INTO external_cache (source, cache_key, payload, fetched_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (source, cache_key)
     DO UPDATE SET payload = $3, fetched_at = now()`,
    [source, key, JSON.stringify(payload)],
  );
}

// ------------------------------------------------------------ World Bank ---
export interface WorldBankResult {
  country: string;
  indicator: string;
  indicatorName: string | null;
  value: number | null;
  year: number | null;
}

export async function worldBankIndicator(
  country: string,
  indicator: string,
): Promise<WorldBankResult | null> {
  const countryIso2 = country;
  const cacheKey = `${country}/${indicator}`;
  try {
    const url = `${WORLD_BANK_BASE}/country/${countryIso2}/indicator/${indicator}` +
                `?format=json&per_page=5&mrv=1`;   
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`World Bank ${res.status}`);
    const json = (await res.json()) as [unknown, Array<{
      country: { value: string }; indicator: { value: string };
      value: number | null; date: string;
    }> | null];
    const entry = json[1]?.[0];
    if (!entry) return null;
    const result: WorldBankResult = {
      country: entry.country.value,
      indicator,
      indicatorName: entry.indicator.value,
      value: entry.value,
      year: Number(entry.date),
    };
    await setCached('worldbank', cacheKey, result).catch(() => {}); 
    return result;
  } catch (err) {
    const cached = await getCached<WorldBankResult>('worldbank', cacheKey).catch(() => null);
    return cached;
  }
}

export interface ResolvedCountry { iso2: string; iso3: string; name: string }

const normalise = (s: string) => s.trim().toLowerCase().replace(/[^a-z ]/g, '');

interface WorldBankCountry { id: string; iso2Code: string; name: string; region: { id: string } }

async function countryList(): Promise<WorldBankCountry[]> {
  const cached = await getCached<WorldBankCountry[]>('worldbank', 'countries').catch(() => null);
  if (cached?.length) return cached;

  const res = await fetch(`${WORLD_BANK_BASE}/country?format=json&per_page=400`,
    { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`World Bank ${res.status}`);
  const json = (await res.json()) as [unknown, WorldBankCountry[] | null];

  const countries = (json[1] ?? []).filter((c) => c.region?.id !== 'NA');
  if (countries.length) await setCached('worldbank', 'countries', countries).catch(() => {});
  return countries;
}

export async function resolveCountry(name: string | null): Promise<ResolvedCountry | null> {
  if (!name?.trim()) return null;
  const cacheKey = `country/${normalise(name)}`;

  const cached = await getCached<ResolvedCountry>('worldbank', cacheKey).catch(() => null);
  if (cached) return cached;

  try {
    const wanted = normalise(name);
    const match = (await countryList()).find((c) =>
      normalise(c.name) === wanted
      || c.iso2Code.toLowerCase() === wanted
      || c.id.toLowerCase() === wanted);

    if (!match) return null;
    const resolved: ResolvedCountry = { iso2: match.iso2Code, iso3: match.id, name: match.name };
    await setCached('worldbank', cacheKey, resolved).catch(() => {});
    return resolved;
  } catch {
    return null;   
  }
}

// --------------------------------------------------------------- iTunes ---
export interface ItunesApp {
  trackName: string;
  artistName: string;
  price: number;
  formattedPrice: string | null;
  averageUserRating: number | null;
  userRatingCount: number | null;
  primaryGenreName: string;
  trackViewUrl: string;
  description?: string;
}

export async function itunesSearch(
  term: string,
  country = 'US',
  limit = 5,
): Promise<ItunesApp[]> {
  const cacheKey = `${term}/${country}`;
  try {
    const url = `${ITUNES_BASE}?term=${encodeURIComponent(term)}&country=${country}` +
                `&entity=software&limit=${limit}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`iTunes ${res.status}`);
    const json = (await res.json()) as { results: ItunesApp[] };
    await setCached('itunes', cacheKey, json.results).catch(() => {});
    return json.results;
  } catch {
    const cached = await getCached<ItunesApp[]>('itunes', cacheKey).catch(() => null);
    return cached ?? [];
  }
}
