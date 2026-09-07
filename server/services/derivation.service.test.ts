/* Tests the derivation layer — the market the founder is no longer asked to estimate. */

import { describe, it, expect } from 'vitest';
import {
  tamPeople, samPeople, installsPerMonth, monthlySurvival, project,
  judge, levers, derive,
  tamVenues, marketCeilingRevenue, marketModelFor, B2B_MODEL,
  type DerivationInputs, type SegmentFactor,
} from './derivation.service';
import { unavailable, type Computed } from './calculation.service';

const bench = (value: number, unit: string): Computed => ({
  value, unit, confidence: 'secondary', unvalidated: false, unvalidatedReason: null,
  inputs: [`benchmark:test.${unit}`], usedBenchmark: true, caveats: [],
});
const gone = (unit = 'number') => unavailable('test input is missing', unit, ['test missing']);

const seg = (over: Partial<SegmentFactor> = {}): SegmentFactor => ({
  label: 'Working-age adults (15–64)',
  kind: 'percent_of_population',
  indicator: 'SP.POP.1564.TO.ZS',
  value: 60,
  year: 2024,
  ...over,
});

const inputs = (over: Partial<DerivationInputs> = {}): DerivationInputs => ({
  verticalId: 'navigation_local',
  countryName: 'Israel',
  population: 10_000_000,
  populationYear: 2024,
  internetPct: 90,
  segments: [],
  platformSharePct: null,
  platformShareSource: null,
  pricePerMonth: 3,
  acquisitionBudget: 1500,
  horizonMonths: 12,
  businessModel: 'Subscription',
  venues: null,
  objectiveRevenue: 8000,
  objectiveUsers: 5000,
  objectiveFloor: null,
  ...over,
});

/* ==================================================================== TAM === */

describe('tamPeople', () => {
  it('is population narrowed to the people who are online', () => {
    const t = tamPeople(inputs());
    expect(t.value).toBe(9_000_000);            
    expect(t.unvalidated).toBe(false);
  });

  it('names the market and the year in its caveats', () => {
    const t = tamPeople(inputs());
    expect(t.caveats.join(' ')).toContain('Israel');
    expect(t.caveats.join(' ')).toContain('2024');
  });

  it('stops rather than guessing when population is missing', () => {
    const t = tamPeople(inputs({ population: null }));
    expect(t.unvalidated).toBe(true);
    expect(t.value).toBeNull();
    expect(t.unvalidatedReason).toContain('population');
  });

  it('stops rather than assuming everyone is online', () => {
    const t = tamPeople(inputs({ internetPct: null }));
    expect(t.unvalidated).toBe(true);
    expect(t.unvalidatedReason).toContain('internet');
  });
});

/* ==================================================================== SAM === */

describe('samPeople', () => {
  it('scales the market by a percentage segment', () => {
    const i = inputs({ segments: [seg({ value: 60 })] });
    expect(samPeople(tamPeople(i), i).value).toBeCloseTo(5_400_000);   
  });

  it('takes the complement for "Men"', () => {
    const i = inputs({
      segments: [seg({ label: 'Men', kind: 'complement_of_percent', value: 49.5 })],
    });
    expect(samPeople(tamPeople(i), i).value).toBeCloseTo(9_000_000 * 0.505);
  });

  it('lets a headcount segment REPLACE the base instead of scaling it', () => {
    const i = inputs({
      segments: [seg({
        label: 'Registered businesses (B2B)', kind: 'absolute_count',
        indicator: 'IC.BUS.NREG', value: 62_000,
      })],
    });
    const s = samPeople(tamPeople(i), i);
    expect(s.value).toBe(62_000);               
    expect(s.caveats.join(' ')).toContain('replaces');
  });

  it('states the independence assumption when two segments are combined', () => {
    const i = inputs({
      segments: [
        seg({ label: 'Women', kind: 'percent_of_population', value: 50 }),
        seg({ label: 'People living in cities', indicator: 'SP.URB.TOTL.IN.ZS', value: 92 }),
      ],
    });
    const s = samPeople(tamPeople(i), i);
    expect(s.value).toBeCloseTo(9_000_000 * 0.5 * 0.92);
    expect(s.caveats.join(' ')).toContain('independent');
  });

  it('stops when the country has no figure for the chosen segment', () => {
    const i = inputs({ segments: [seg({ value: null })] });
    const s = samPeople(tamPeople(i), i);
    expect(s.unvalidated).toBe(true);
    expect(s.unvalidatedReason).toContain('Working-age adults');
  });

  it('says so when platform share is unsourced, rather than silently covering all devices', () => {
    const i = inputs({ platformSharePct: null });
    expect(samPeople(tamPeople(i), i).caveats.join(' ')).toContain('Not narrowed by platform');
  });

  it('applies platform share when it is sourced', () => {
    const i = inputs({ platformSharePct: 47, platformShareSource: 'StatCounter' });
    expect(samPeople(tamPeople(i), i).value).toBeCloseTo(9_000_000 * 0.47);
  });

  it('passes an unvalidated TAM straight through', () => {
    const i = inputs({ population: null, segments: [seg()] });
    expect(samPeople(tamPeople(i), i).unvalidated).toBe(true);
  });
});

/* ================================================================ installs === */

describe('installsPerMonth', () => {
  it('is the acquisition budget divided by the category cost-per-install', () => {
    expect(installsPerMonth(inputs(), bench(1.5, 'USD')).value).toBe(1000);
  });

  it('projects zero paid installs for a zero budget, and says growth is unforecastable', () => {
    const r = installsPerMonth(inputs({ acquisitionBudget: 0 }), bench(1.5, 'USD'));
    expect(r.value).toBe(0);
    expect(r.unvalidated).toBe(false);
    expect(r.caveats.join(' ')).toContain('word of mouth');
  });

  it('stops when the category has no sourced cost-per-install', () => {
    const r = installsPerMonth(inputs(), gone('USD'));
    expect(r.unvalidated).toBe(true);
    expect(r.unvalidatedReason).toContain('cost-per-install');
  });

  it('refuses to divide by a zero cost-per-install', () => {
    expect(installsPerMonth(inputs(), bench(0, 'USD')).unvalidated).toBe(true);
  });
});

/* ================================================================ survival === */

describe('monthlySurvival', () => {
  it('prefers a published monthly churn figure', () => {
    const s = monthlySurvival(bench(8, 'percent'), bench(4.5, 'percent'));
    expect(s.value).toBeCloseTo(0.92);
  });

  it('falls back to D30 retention and admits that reading is a proxy', () => {
    const s = monthlySurvival(gone('percent'), bench(4.5, 'percent'));
    expect(s.value).toBeCloseTo(0.045);
    expect(s.caveats.join(' ')).toContain('installs still opening the app');
  });

  it('stops when neither figure is published', () => {
    expect(monthlySurvival(gone('percent'), gone('percent')).unvalidated).toBe(true);
  });

  it('refuses a churn of 100%', () => {
    expect(monthlySurvival(bench(100, 'percent'), gone('percent')).unvalidated).toBe(true);
  });
});

/* ============================================================== projection === */

describe('project', () => {
  const run = (months: number, survival: number) => project(
    bench(1000, 'installs/month'),   
    bench(10, 'percent'),            
    bench(survival, 'fraction'),
    bench(5, 'USD/month'),
    bench(30, 'percent'),
    months,
  );

  it('accumulates cohorts and decays them', () => {
    const { points } = run(3, 0.5);
    expect(points[0]!.payers).toBeCloseTo(100);              
    expect(points[1]!.payers).toBeCloseTo(150);              
    expect(points[2]!.payers).toBeCloseTo(175);              
  });

  it('applies the store commission to revenue', () => {
    const { points } = run(1, 0.5);
    expect(points[0]!.netRevenue).toBeCloseTo(100 * 5 * 0.7);
  });

  it('converges rather than growing without limit', () => {
    const { points } = run(60, 0.5);
    expect(points[59]!.payers).toBeCloseTo(200, 5);          
  });

  it('produces no points at all when an input is unvalidated, and names the blocker', () => {
    const blocked = project(gone(), bench(10, 'percent'), bench(0.5, 'fraction'),
      bench(5, 'USD/month'), bench(30, 'percent'), 12);
    expect(blocked.points).toHaveLength(0);
    expect(blocked.blocked?.unvalidated).toBe(true);
  });
});

/* ================================================================= verdict === */

describe('judge', () => {
  const derived = (v: number) => bench(v, 'USD/month');

  it('calls a met objective supported', () => {
    const v = judge('revenue', 'USD/month', 5000, derived(6000), 12);
    expect(v.code).toBe('supported');
    expect(v.ratio).toBeCloseTo(1.2);
  });

  it('calls a near miss ambitious rather than unsupported', () => {
    expect(judge('revenue', 'USD/month', 10000, derived(8000), 12).code).toBe('ambitious');
  });

  it('calls a wide miss unsupported', () => {
    const v = judge('revenue', 'USD/month', 100000, derived(8000), 12);
    expect(v.code).toBe('unsupported');
    expect(v.detail).toContain('8%');
  });

  it('refuses to judge against an unvalidated projection', () => {
    const v = judge('revenue', 'USD/month', 5000, gone('USD/month'), 12);
    expect(v.code).toBe('undeterminable');
    expect(v.unvalidated).toBe(true);
  });

  it('refuses to judge when no objective was given', () => {
    expect(judge('revenue', 'USD/month', null, derived(6000), 12).code).toBe('undeterminable');
  });
});

/* ================================================================== levers === */

describe('levers', () => {
  const points = Array.from({ length: 60 }, (_, i) => ({
    month: i + 1, payers: (i + 1) * 100, netRevenue: (i + 1) * 500,
  }));

  it('says nothing when the objective is already met', () => {
    expect(levers(5000, bench(6000, 'USD/month'), 1500, bench(2000, 'people'), 3,
      bench(30, 'percent'), points, 12)).toHaveLength(0);
  });

  it('back-solves the budget, the price and the time', () => {
    const out = levers(16000, bench(8000, 'USD/month'), 1500, bench(2000, 'people'), 3,
      bench(30, 'percent'), points, 12);
    const byName = Object.fromEntries(out.map((l) => [l.name, l.detail]));
    expect(byName.Budget).toContain('3,000');            
    expect(byName.Price).toContain('11.43');             
    expect(byName.Time).toContain('month 32');           
  });

  it('warns rather than back-solving when the derived figure is unavailable', () => {
    const out = levers(16000, gone('USD/month'), 1500, bench(2000, 'people'), 3,
      bench(30, 'percent'), points, 12);
    expect(out[0]!.unvalidated).toBe(true);
  });

  it('says more time will not help when the projection never reaches the objective', () => {
    const flat = points.map((p) => ({ ...p, netRevenue: 100 }));
    const out = levers(16000, bench(100, 'USD/month'), 1500, bench(2000, 'people'), 3,
      bench(30, 'percent'), flat, 12);
    expect(out.find((l) => l.name === 'Time')!.detail).toContain('does not reach');
  });
});

/* ============================================== the whole run, real data === */

describe('derive, against the real benchmark files', () => {
  it('sizes TAM and SAM from the World Bank figures it was given', () => {
    const r = derive(inputs({ segments: [seg({ value: 60 })] }));
    expect(r.tam.value).toBe(9_000_000);
    expect(r.sam.value).toBeCloseTo(5_400_000);
  });

  it('never lets an objective influence the projection it is judged against', () => {
    const modest = derive(inputs({ objectiveRevenue: 1 }));
    const wild = derive(inputs({ objectiveRevenue: 100_000_000 }));
    expect(modest.derivedMonthlyRevenue.value).toEqual(wild.derivedMonthlyRevenue.value);
    expect(modest.somPayers.value).toEqual(wild.somPayers.value);
  });

  it('reports a verdict of some kind for every run', () => {
    const r = derive(inputs());
    expect(['supported', 'ambitious', 'unsupported', 'undeterminable'])
      .toContain(r.verdicts.overall.code);
    expect(r.verdicts.overall.headline.length).toBeGreaterThan(0);
  });

  it('blames the missing benchmark, not the idea, when the chain cannot complete', () => {
    const r = derive(inputs());
    if (r.verdicts.overall.code === 'undeterminable')
      expect(r.verdicts.overall.detail).toContain('not a finding about');
  });

  it('honours the horizon it was given', () => {
    const r = derive(inputs({ horizonMonths: 24 }));
    expect(r.horizonMonths).toBe(24);
    if (r.points.length) expect(r.points).toHaveLength(24);
  });

  it('clamps a nonsensical horizon to at least one month', () => {
    expect(derive(inputs({ horizonMonths: 0 })).horizonMonths).toBe(1);
  });
});

/* ======================================================= the B2B funnel === */

const b2b = (over: Partial<DerivationInputs> = {}): DerivationInputs => inputs({
  businessModel: B2B_MODEL,
  pricePerMonth: 450,
  venues: {
    low: 57, lowSource: 'Wikidata, notable shopping centres',
    high: 434, highSource: 'OpenStreetMap, shop=mall OR shop=department_store',
  },
  objectiveRevenue: 270_000,
  ...over,
});

describe('marketModelFor', () => {
  it('routes a B2B licence to the premises funnel', () => {
    expect(marketModelFor(B2B_MODEL)).toBe('b2b_licence');
  });

  it('routes everything else, including an undecided model, to the consumer funnel', () => {
    for (const m of ['Subscription', 'Advertising', 'Not yet decided', null])
      expect(marketModelFor(m)).toBe('consumer_installs');
  });
});

describe('tamVenues', () => {
  it('reports the generous count so a conclusion drawn against it cannot be argued down', () => {
    const t = tamVenues(b2b());
    expect(t.value).toBe(434);
    expect(t.unit).toBe('venues');
  });

  it('carries the second, smaller count and explains the disagreement', () => {
    const joined = tamVenues(b2b()).caveats.join(' ');
    expect(joined).toContain('57');
    expect(joined).toContain('range of 57-434');
  });

  it('does not claim a disagreement when both sources agree', () => {
    const t = tamVenues(b2b({ venues: { low: 90, lowSource: 'a', high: 90, highSource: 'b' } }));
    expect(t.caveats.join(' ')).not.toContain('disagree');
  });

  it('copes with only one source answering', () => {
    expect(tamVenues(b2b({ venues: { low: null, lowSource: null, high: 12, highSource: 'osm' } })).value)
      .toBe(12);
    expect(tamVenues(b2b({ venues: { low: 12, lowSource: 'wd', high: null, highSource: null } })).value)
      .toBe(12);
  });

  it('stops when no source counted anything', () => {
    expect(tamVenues(b2b({ venues: null })).unvalidated).toBe(true);
    expect(tamVenues(b2b({ venues: { low: null, lowSource: null, high: null, highSource: null } }))
      .unvalidated).toBe(true);
  });
});

describe('marketCeilingRevenue', () => {
  const venues = (n: number): Computed => ({
    value: n, unit: 'venues', confidence: 'secondary', unvalidated: false,
    unvalidatedReason: null, inputs: ['overpass'], usedBenchmark: false, caveats: [],
  });

  it('is the whole market at the price the founder set', () => {
    const c = marketCeilingRevenue(venues(434), bench(450, 'USD/month'), bench(0, 'percent'));
    expect(c.value).toBe(195_300);
  });

  it('deducts commission when one applies', () => {
    expect(marketCeilingRevenue(venues(100), bench(10, 'USD/month'), bench(30, 'percent')).value)
      .toBeCloseTo(700);
  });

  it('ignores an unsourced commission rather than blocking, since that only widens the bound', () => {
    const c = marketCeilingRevenue(venues(100), bench(10, 'USD/month'), gone('percent'));
    expect(c.value).toBe(1000);
    expect(c.unvalidated).toBe(false);
  });

  it('says plainly that nobody achieves 100% share', () => {
    expect(marketCeilingRevenue(venues(10), bench(5, 'USD/month'), bench(0, 'percent'))
      .caveats.join(' ')).toContain('upper bound, not a forecast');
  });

  it('stops when the market or the price is unavailable', () => {
    expect(marketCeilingRevenue(gone('venues'), bench(450, 'USD/month'), bench(0, 'percent'))
      .unvalidated).toBe(true);
    expect(marketCeilingRevenue(venues(434), gone('USD/month'), bench(0, 'percent'))
      .unvalidated).toBe(true);
  });
});

describe('derive, on a B2B licence', () => {
  it('sizes the market in venues, not people', () => {
    const r = derive(b2b());
    expect(r.model).toBe('b2b_licence');
    expect(r.tam.unit).toBe('venues');
    expect(r.tam.value).toBe(434);
  });

  it('does not narrow premises by population segments or platform share', () => {
    const withFilters = derive(b2b({
      segments: [seg({ value: 60 })], platformSharePct: 47, platformShareSource: 'StatCounter',
    }));
    expect(withFilters.sam.value).toBe(434);      
  });

  it('deducts no app-store commission from a direct sale', () => {
    expect(derive(b2b()).marketCeiling.value).toBe(434 * 450);
  });

  it('refuses an objective larger than the entire market', () => {
    const r = derive(b2b({ objectiveRevenue: 270_000 }));
    expect(r.ceilingBreached).toBe(true);
    expect(r.verdicts.overall.code).toBe('unsupported');
    expect(r.verdicts.overall.headline).toContain('larger than the market');
    expect(r.verdicts.overall.detail).toContain('195,300');
  });

  it('lets the ceiling outrank a working projection', () => {
    const r = derive(b2b({ objectiveRevenue: 270_000 }));
    expect(r.derivedMonthlyRevenue.unvalidated).toBe(false);
    expect(r.verdicts.overall.headline).toContain('larger than the market');
  });

  it('does not fire the ceiling for an objective inside the market', () => {
    const r = derive(b2b({ objectiveRevenue: 20_000 }));
    expect(r.ceilingBreached).toBe(false);
    expect(r.verdicts.overall.headline).not.toContain('larger than the market');
  });

  it('speaks about business customers, not installs, when a figure is missing', () => {
    const r = installsPerMonth(b2b(), gone('USD'), 'b2b_licence');
    expect(r.unvalidatedReason).toContain('business customer');
    expect(r.unvalidatedReason).not.toContain('cost-per-install');
    expect(r.unit).toBe('venues/month');
  });

  it('applies no install-to-paid step, because a signed venue already pays', () => {
    const r = derive(b2b());
    expect(r.storeConversionPct.value).toBe(100);
    expect(r.storeConversionPct.caveats.join(' ')).toContain('already a paying customer');
  });

  it('takes licence renewal from B2B churn, never from app retention', () => {
    const r = derive(b2b());
    expect(r.monthlySurvival.value).toBeCloseTo(0.955, 3);
    expect(r.impliedLifetimeMonths.value).toBeGreaterThan(12);
  });
});

describe('the ceiling applies to consumer products too', () => {
  it('catches a consumer objective larger than the addressable market', () => {
    const r = derive(inputs({
      population: 1000, internetPct: 100, pricePerMonth: 1, objectiveRevenue: 5000,
    }));
    expect(r.ceilingBreached).toBe(true);
    expect(r.verdicts.overall.detail).toContain('every customer in it');
  });
});
