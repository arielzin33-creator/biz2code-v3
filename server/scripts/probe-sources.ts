/* Calls every approved source once, live, and reports what came back. */

import {
  countryFacts, eurostatIndicator, oecdIndicator, unsdSeries,
  competitorEntities, israeliDatasets, usdTo, crossrefWorks, googleBooksWorks,
  retailVenueCount, notableMallCount,
  SOURCES, type SourceId,
} from '../services/sources.service';
import { pool } from '../db/pool';

interface Row { id: SourceId; ok: boolean; skipped: boolean; detail: string; ms: number }

async function timed<T>(fn: () => Promise<T>): Promise<[T | null, number]> {
  const t0 = Date.now();
  try { return [await fn(), Date.now() - t0]; } catch { return [null, Date.now() - t0]; }
}

async function main(): Promise<void> {
  const rows: Row[] = [];
  const run = async (
    id: SourceId, skip: boolean, fn: () => Promise<unknown>, describe: (v: any) => string,
  ) => {
    if (skip) {
      rows.push({ id, ok: true, skipped: true, ms: 0, detail: 'skipped — no key configured' });
      return;
    }
    const [value, ms] = await timed(fn);
    const empty = value === null || (Array.isArray(value) && value.length === 0);
    rows.push({
      id, ok: !empty, skipped: false, ms,
      detail: empty ? 'no data returned' : describe(value),
    });
  };

  await run('restcountries', true, () => countryFacts('ISR'),
    (c) => `${c.name} — pop ${c.population?.toLocaleString('en-US')}, M49 ${c.m49}, ${c.currencyCode}`);

  await run('eurostat', false, () => eurostatIndicator('isoc_ci_ifp_iu', 'DE'),
    (o) => `${o.value} (${o.period ?? 'no period'})`);

  await run('oecd', false,
    () => oecdIndicator('OECD.CFE.EDS,DSD_REG_DEMO@DF_DENSITY', 'all'),
    (o) => `${o.value} (${o.period ?? 'no period reported by this dataflow'})`);

  await run('unsd', false, () => unsdSeries('IT_USE_ii99', '376'),
    (o) => `${o.value} (${o.period ?? 'no period'}) — ${o.label ?? ''}`.trim());

  await run('wikidata', false, () => competitorEntities('Waze', 1),
    (e) => `${e[0].qid} ${e[0].label} — ${e[0].description ?? 'no description'}`);

  await run('datagovil', false, () => israeliDatasets('transport', 3),
    (d) => `${d.length} dataset(s), first: ${d[0].title}`);

  await run('openexchangerates', true, () => usdTo('ILS'),
    (f) => `1 USD = ${f.rate} ${f.quote} (${f.asOf ?? 'undated'})`);

  await run('crossref', false, () => crossrefWorks('indoor positioning retail navigation', 3),
    (w) => `${w.length} work(s), first: ${w[0].title.slice(0, 60)}`);

  await run('googlebooks', false, () => googleBooksWorks('wayfinding retail environments', 3),
    (w) => `${w.length} work(s), first: ${w[0].title.slice(0, 60)}`);

  await run('overpass', false, () => retailVenueCount('IL'),
    (v) => `${v.count.toLocaleString('en-US')} venues (${v.query})`);

  await run('wikidata', false, () => notableMallCount('Q801'),
    (v) => `${v.count.toLocaleString('en-US')} notable shopping centres in Israel`);

  const pad = Math.max(...rows.map((r) => r.id.length));
  console.log('\nAPPROVED SOURCES — live probe\n');
  for (const r of rows) {
    const mark = r.skipped ? '  -  ' : r.ok ? '  ok ' : ' FAIL';
    console.log(`${mark} ${r.id.padEnd(pad)}  ${String(r.ms).padStart(5)}ms  ${r.detail}`);
  }

  const failed = rows.filter((r) => !r.ok && !r.skipped);
  const skipped = rows.filter((r) => r.skipped);
  console.log(`\n${rows.length - failed.length - skipped.length} reachable, `
    + `${failed.length} failed, ${skipped.length} skipped.`);
  if (failed.length)
    console.log(`\nUnreachable: ${failed.map((f) => SOURCES[f.id].publisher).join(', ')}. `
      + 'Any document that would have cited these renders unvalidated instead.');

  await pool.end();
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => {});
  process.exit(1);
});
