

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../db/pool';
import { query } from '../db/query';

interface CacheEntry {
  source: 'worldbank' | 'itunes';
  cacheKey: string;

  payload: { _status?: string; results?: unknown[] } | null;
  note?: string | null;
}

interface SeedFile {
  project: { name: string };
  answers: Array<{ clearOnDemo: boolean }>;
  externalCache: CacheEntry[];
}

const SEED_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'seed-project.json',
);
const seed = JSON.parse(readFileSync(SEED_PATH, 'utf8')) as SeedFile;

async function main() {
  console.log(`Seeding: ${seed.project.name}`);

  const prefill = seed.answers.filter((a) => !a.clearOnDemo);
  console.log(
    `  ${prefill.length} answers pre-filled, ` +
    `${seed.answers.length - prefill.length} left blank for the live demo ` +
    `(loaded per-project by the "Start from the example project" button)`,
  );

  const entries = seed.externalCache ?? [];
  if (entries.length === 0) {
    console.log('  no cached API responses in the seed file — nothing to load');
    return;
  }

  let loaded = 0;
  let skipped = 0;

  for (const entry of entries) {

    if (entry.payload?._status !== 'FETCHED') {
      console.log(`  SKIP  ${entry.source}/${entry.cacheKey} — ${entry.payload?._status ?? 'no payload'}`);
      skipped += 1;
      continue;
    }


    const payload = entry.source === 'itunes' && Array.isArray(entry.payload.results)
      ? entry.payload.results
      : entry.payload;

    await query(
      `INSERT INTO external_cache (source, cache_key, payload, fetched_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (source, cache_key)
       DO UPDATE SET payload = $3, fetched_at = now()`,
      [entry.source, entry.cacheKey, JSON.stringify(payload)],
    );
    console.log(`  ok    ${entry.source}/${entry.cacheKey}`);
    loaded += 1;
  }

  console.log(`\n  ${loaded} cached response${loaded === 1 ? '' : 's'} loaded, ${skipped} skipped.`);

  if (skipped > 0) {
    console.log(
      '  Run `npx tsx server/scripts/fetch-seed-data.ts` to replace the placeholders\n' +
      '  with real responses, then re-run this. Until then those calls go to the\n' +
      '  live APIs at generation time and fail to "unvalidated" if the network is down.',
    );
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => pool.end());
