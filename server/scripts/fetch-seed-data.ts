

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { competitorSearchTerms } from '../services/competitorTerms';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_PATH = path.join(__dirname, '..', '..', 'data', 'seed-project.json');


async function worldBank(countryIso2: string, indicator: string) {
  const url = `https://api.worldbank.org/v2/country/${countryIso2}/indicator/${indicator}` +
              `?format=json&per_page=5&mrv=1`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`World Bank ${res.status}`);
  const json = await res.json() as [unknown, Array<{
    country: { value: string }; indicator: { value: string };
    value: number | null; date: string;
  }> | null];
  const entry = json[1]?.[0];
  if (!entry) throw new Error('World Bank: no data returned');
  return {
    country: entry.country.value, indicator, indicatorName: entry.indicator.value,
    value: entry.value, year: Number(entry.date), _status: 'FETCHED',
  };
}

async function itunes(term: string, country: string) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}` +
              `&country=${country}&entity=software&limit=5`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`iTunes ${res.status}`);
  const json = await res.json() as { resultCount: number; results: unknown[] };
  return { ...json, _status: 'FETCHED' };
}


async function resolveCountry(name: string) {
  const res = await fetch('https://api.worldbank.org/v2/country?format=json&per_page=400',
    { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`World Bank country list ${res.status}`);
  const json = await res.json() as [unknown, Array<{
    id: string; iso2Code: string; name: string; region: { id: string };
  }> | null];
  const norm = (v: string) => v.trim().toLowerCase().replace(/[^a-z ]/g, '');
  const match = (json[1] ?? []).find((c) => c.region?.id !== 'NA' && norm(c.name) === norm(name));
  if (!match) throw new Error(`could not resolve country "${name}"`);
  return { iso2: match.iso2Code, iso3: match.id, name: match.name };
}

const answerFor = (seed: any, questionId: string): string | null =>
  seed.answers.find((a: any) => a.questionId === questionId)?.valueText ?? null;


async function buildEntries(seed: any) {
  const country = await resolveCountry(answerFor(seed, 'p2q2') ?? 'Israel');
  console.log(`  country: "${answerFor(seed, 'p2q2')}" -> ${country.iso3}/${country.iso2}`);

  const entries: Array<{ source: string; cacheKey: string; payload: unknown; note: string }> = [];

  for (const [indicator, what] of [
    ['SP.POP.TOTL', 'population, for market sizing in the MRD'],
    ['IT.NET.USER.ZS', 'internet penetration, for TAM grounding in the MRD'],
  ] as const) {
    entries.push({
      source: 'worldbank',
      cacheKey: `${country.iso3}/${indicator}`,
      payload: await worldBank(country.iso3, indicator),
      note: `${country.name} ${what}. Pre-cached so the demo survives a bad network.`,
    });
    await new Promise((r) => setTimeout(r, 500));
  }

  const terms = competitorSearchTerms(answerFor(seed, 'p2q4'));
  console.log(`  competitors from p2q4: ${terms.length ? terms.join(', ') : '(none named)'}`);

  for (const term of terms) {
    entries.push({
      source: 'itunes',
      cacheKey: `${term}/${country.iso2}`,
      payload: await itunes(term, country.iso2),
      note: `Competitor lookup for p2q4 ("${term}"), ${country.iso2} storefront. ` +
            'iTunes is ~20 req/min and has no CORS, so this is fetched server-side and cached.',
    });
    await new Promise((r) => setTimeout(r, 500));
  }

  return entries;
}

async function main() {
  const seed = JSON.parse(readFileSync(SEED_PATH, 'utf8'));

  try {
    seed.externalCache = await buildEntries(seed);
    for (const e of seed.externalCache) console.log(`  OK    ${e.source} :: ${e.cacheKey}`);
    writeFileSync(SEED_PATH, `${JSON.stringify(seed, null, 2)}
`);
    console.log(`
Done. ${seed.externalCache.length} entries written to seed-project.json.`);
    console.log('Now run `npm run db:seed` to load them into external_cache.');
  } catch (err) {
    console.error(`
FAILED — ${(err as Error).message}`);
    console.error('seed-project.json was left untouched. Re-run when the network is back.');
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
