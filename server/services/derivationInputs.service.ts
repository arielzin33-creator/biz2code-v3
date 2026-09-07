/* Assembles DerivationInputs from the answers and the approved sources. */

import { worldBankIndicator, type WorldBankResult } from './external.service';
import { retailVenueCount, notableMallCount } from './sources.service';
import { getSegmentFilters } from './questionBank.service';
import type { AnswerRow } from './answer.service';
import {
  marketModelFor, type DerivationInputs, type SegmentFactor, type VenueCounts,
} from './derivation.service';

export const DERIVATION_QUESTIONS = {
  platforms: 'p1q4',
  segments: 'p2q6',
  pricePerMonth: 'p4q2',
  businessModel: 'p4q1',
  acquisitionBudget: 'p4q7',
  objectiveRevenue: 'p4q8',   
  objectiveUsers: 'p4q9',
  horizon: 'p4q10',
} as const;

function num(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function horizonMonths(text: string | null | undefined): number | null {
  const n = Number(String(text ?? '').match(/\d+/)?.[0]);
  return Number.isFinite(n) ? n : null;
}

interface Band { min: number | null; max: number | null }

function band(value: unknown): Band {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { min: null, max: null };
  const v = value as Record<string, unknown>;
  return { min: num(v.min as never), max: num(v.max as never) };
}

async function resolveSegments(
  labels: string[], countryIso3: string,
): Promise<SegmentFactor[]> {
  const filters = getSegmentFilters();
  const out: SegmentFactor[] = [];

  for (const label of labels.slice(0, 2)) {          
    const spec = filters[label];
    if (!spec) continue;                              
    if (spec.kind === 'none' || !spec.indicator) {
      out.push({ label, kind: 'none', indicator: null, value: null, year: null });
      continue;
    }
    const wb: WorldBankResult | null = await worldBankIndicator(countryIso3, spec.indicator);
    out.push({
      label,
      kind: spec.kind,
      indicator: spec.indicator,
      value: wb?.value ?? null,
      year: wb?.year ?? null,
    });
  }
  return out;
}

async function countVenues(iso2: string | null): Promise<VenueCounts | null> {
  if (!iso2) return null;
  const [osm, wd] = await Promise.all([
    retailVenueCount(iso2).catch(() => null),
    iso2.toUpperCase() === 'IL' ? notableMallCount('Q801').catch(() => null) : Promise.resolve(null),
  ]);
  if (!osm && !wd) return null;
  return {
    high: osm?.count ?? wd?.count ?? null,
    highSource: osm ? `OpenStreetMap, ${osm.query}` : wd ? 'Wikidata' : null,
    low: wd?.count ?? osm?.count ?? null,
    lowSource: wd ? 'Wikidata, notable shopping centres' : osm ? `OpenStreetMap, ${osm.query}` : null,
  };
}

export interface ExternalForDerivation {
  worldBank: WorldBankResult[];
  country: { iso2: string; iso3: string; name: string } | null;
}

export async function buildDerivationInputs(
  verticalId: string,
  answers: AnswerRow[],
  external: ExternalForDerivation,
): Promise<DerivationInputs> {
  const byId = new Map(answers.map((a) => [a.question_id, a]));
  const q = DERIVATION_QUESTIONS;

  const businessModel = byId.get(q.businessModel)?.value_text ?? null;
  const revenue = band(byId.get(q.objectiveRevenue)?.value_json);

  const find = (code: string) => external.worldBank.find((w) => w.indicator === code)?.value ?? null;
  const population = find('SP.POP.TOTL');
  const internetPct = find('IT.NET.USER.ZS');
  const populationYear =
    external.worldBank.find((w) => w.indicator === 'SP.POP.TOTL')?.year ?? null;

  const segmentLabels = (byId.get(q.segments)?.value_json as string[] | null) ?? [];
  const segments = external.country
    ? await resolveSegments(Array.isArray(segmentLabels) ? segmentLabels : [], external.country.iso3)
    : [];

  const venues = marketModelFor(businessModel) === 'b2b_licence'
    ? await countVenues(external.country?.iso2 ?? null)
    : null;

  return {
    verticalId,
    countryName: external.country?.name ?? null,
    population,
    populationYear,
    internetPct,
    segments,
    platformSharePct: null,
    platformShareSource: null,
    pricePerMonth: num(byId.get(q.pricePerMonth)?.value_number),
    acquisitionBudget: num(byId.get(q.acquisitionBudget)?.value_number),
    horizonMonths: horizonMonths(byId.get(q.horizon)?.value_text),
    businessModel,
    venues,
    objectiveRevenue: revenue.max,     
    objectiveFloor: revenue.min,       
    objectiveUsers: num(byId.get(q.objectiveUsers)?.value_number),
  };
}
