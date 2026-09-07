/* TAM -> SAM -> SOM, a month-by-month projection, and the verdict that compares the founder's objectives against all of it. */

import {
  combine, unavailable, assumption, fromBenchmark,
  type Computed,
} from './calculation.service';
import { resolve as resolveBenchmark, type Resolved } from './benchmark.service';

/* ------------------------------------------------------------- inputs --- */

export interface SegmentFactor {
  label: string;
  kind: 'none' | 'percent_of_population' | 'complement_of_percent' | 'absolute_count';
  indicator: string | null;
  value: number | null;
  year: number | null;
}

export type MarketModel = 'consumer_installs' | 'b2b_licence';

export const B2B_MODEL = 'Sold to businesses (B2B licence)';

export const marketModelFor = (businessModel: string | null): MarketModel =>
  businessModel === B2B_MODEL ? 'b2b_licence' : 'consumer_installs';

export interface VenueCounts {
  low: number | null;
  lowSource: string | null;
  high: number | null;
  highSource: string | null;
}

export interface DerivationInputs {
  verticalId: string;
  countryName: string | null;
  population: number | null;
  populationYear: number | null;
  internetPct: number | null;
  segments: SegmentFactor[];
  platformSharePct: number | null;
  platformShareSource: string | null;
  pricePerMonth: number | null;
  acquisitionBudget: number | null;
  horizonMonths: number | null;
  businessModel: string | null;
  venues: VenueCounts | null;
  objectiveRevenue: number | null;   
  objectiveFloor: number | null;     
  objectiveUsers: number | null;     
}

/* --------------------------------------------------------- the funnel --- */

export function tamPeople(input: DerivationInputs): Computed {
  if (input.population === null)
    return unavailable(
      'No population figure was retrieved for this market, so the total addressable market cannot be sized.',
      'people', ['worldbank:SP.POP.TOTL']);
  if (input.internetPct === null)
    return unavailable(
      'No internet-penetration figure was retrieved for this market, so the addressable population cannot be narrowed to people who are online.',
      'people', ['worldbank:SP.POP.TOTL', 'worldbank:IT.NET.USER.ZS']);

  const pop: Computed = {
    value: input.population, unit: 'people', confidence: 'primary',
    unvalidated: false, unvalidatedReason: null,
    inputs: ['worldbank:SP.POP.TOTL'], usedBenchmark: false,
    caveats: [`Population of ${input.countryName ?? 'the world aggregate'}`
      + `${input.populationYear ? `, ${input.populationYear}` : ''}, World Bank.`],
  };
  const online: Computed = {
    value: input.internetPct, unit: 'percent', confidence: 'primary',
    unvalidated: false, unvalidatedReason: null,
    inputs: ['worldbank:IT.NET.USER.ZS'], usedBenchmark: false,
    caveats: [`${input.internetPct}% of that population uses the internet, World Bank.`],
  };
  return combine([pop, online], 'people', ([p, pct]) => (p as number) * ((pct as number) / 100));
}

export function samPeople(tam: Computed, input: DerivationInputs): Computed {
  if (tam.unvalidated) return tam;

  let running = tam;

  for (const seg of input.segments) {
    if (seg.kind === 'none') continue;

    if (seg.value === null)
      return unavailable(
        `No published figure for "${seg.label}" in this market`
        + `${seg.indicator ? ` (${seg.indicator})` : ''}, so the market cannot be narrowed to that group.`,
        'people', [...running.inputs, `worldbank:${seg.indicator ?? seg.label}`]);

    if (seg.kind === 'absolute_count') {
      running = {
        value: seg.value, unit: 'people', confidence: 'primary',
        unvalidated: false, unvalidatedReason: null,
        inputs: [...running.inputs, `worldbank:${seg.indicator}`],
        usedBenchmark: false,
        caveats: [...running.caveats,
          `Narrowed to "${seg.label}" — ${seg.value.toLocaleString('en-US')}`
          + `${seg.year ? ` in ${seg.year}` : ''}, World Bank. This is a headcount, so it replaces `
          + 'the population base rather than scaling it.'],
      };
      continue;
    }

    const pct = seg.kind === 'complement_of_percent' ? 100 - seg.value : seg.value;
    const factor: Computed = {
      value: pct, unit: 'percent', confidence: 'primary',
      unvalidated: false, unvalidatedReason: null,
      inputs: [`worldbank:${seg.indicator}`], usedBenchmark: false,
      caveats: [`Narrowed to "${seg.label}" — ${pct.toFixed(1)}% of the population`
        + `${seg.year ? ` in ${seg.year}` : ''}, World Bank.`],
    };
    running = combine([running, factor], 'people', ([n, p]) => (n as number) * ((p as number) / 100));
    if (running.unvalidated) return running;
  }

  const applied = input.segments.filter((s) => s.kind !== 'none');
  if (applied.length > 1)
    running.caveats = [...running.caveats,
      `Two groups were combined (${applied.map((s) => `"${s.label}"`).join(' and ')}). `
      + 'Multiplying their shares assumes the two are independent of one another, which is an '
      + 'approximation — the real overlap is not published.'];

  if (input.platformSharePct === null) {
    running.caveats = [...running.caveats,
      'Not narrowed by platform: no sourced device-share figure exists for this market, so this '
      + 'figure covers all devices rather than only the platforms you named.'];
    return running;
  }

  const platform: Computed = {
    value: input.platformSharePct, unit: 'percent', confidence: 'secondary',
    unvalidated: false, unvalidatedReason: null,
    inputs: [`platform-share:${input.countryName ?? 'world'}`], usedBenchmark: false,
    caveats: [`${input.platformSharePct}% of devices in this market run the platforms you named`
      + `${input.platformShareSource ? ` (${input.platformShareSource})` : ''}.`],
  };
  return combine([running, platform], 'people', ([n, p]) => (n as number) * ((p as number) / 100));
}

export function installsPerMonth(
  input: DerivationInputs, cpi: Computed,
  model: MarketModel = 'consumer_installs',
): Computed {
  const b2b = model === 'b2b_licence';
  const unit = b2b ? 'venues/month' : 'installs/month';
  const acquired = b2b ? 'business customers' : 'installs';
  const unitCost = b2b ? 'cost to acquire one business customer' : 'cost-per-install';

  if (input.acquisitionBudget === null)
    return unavailable('The monthly acquisition budget was not answered.', unit,
      ['p4q7 acquisition_budget']);

  if (input.acquisitionBudget === 0)
    return {
      value: 0, unit, confidence: 'assumption',
      unvalidated: false, unvalidatedReason: null,
      inputs: ['p4q7 acquisition_budget'], usedBenchmark: false,
      caveats: [`You plan to spend nothing on acquisition, so no paid ${acquired} are projected. `
        + 'Organic growth and founder-led selling are real, but nothing published lets either be '
        + 'forecast for a product that does not exist yet, so this projection covers paid '
        + 'acquisition only and understates a product that spreads by word of mouth.'],
    };

  const budget = assumption(input.acquisitionBudget, 'USD/month', 'p4q7 acquisition_budget');
  if (cpi.unvalidated || cpi.value === null)
    return unavailable(
      `No sourced ${unitCost} exists for this category, so the number of ${acquired} the budget `
      + 'buys cannot be derived.',
      unit, ['p4q7 acquisition_budget', ...cpi.inputs]);
  if (cpi.value === 0)
    return unavailable(`A ${unitCost} of zero would imply unlimited ${acquired}.`, unit, cpi.inputs);

  return combine([budget, cpi], unit, ([b, c]) => (b as number) / (c as number));
}

export function monthlySurvival(churn: Computed, retentionD30: Computed): Computed {
  if (!churn.unvalidated && churn.value !== null) {
    if (churn.value >= 100)
      return unavailable('A monthly churn of 100% leaves no customers to project.',
        'fraction', churn.inputs);
    return combine([churn], 'fraction', ([c]) => 1 - (c as number) / 100);
  }
  if (retentionD30.unvalidated || retentionD30.value === null)
    return unavailable(
      'No sourced churn or 30-day retention figure exists for this category, so customers cannot '
      + 'be projected forward month by month.',
      'fraction', [...churn.inputs, ...retentionD30.inputs]);

  const survival = combine([retentionD30], 'fraction', ([r]) => (r as number) / 100);
  if (!survival.unvalidated)
    survival.caveats = [...survival.caveats,
      'Derived by reading the category\'s 30-day retention as a monthly survival rate. That '
      + 'benchmark counts installs still opening the app, not customers still paying, so it is '
      + 'a proxy — no tracked category publishes a monthly churn figure.'];
  return survival;
}

/* ------------------------------------------------------ premises (B2B) --- */

export function tamVenues(input: DerivationInputs): Computed {
  const v = input.venues;
  if (!v || (v.low === null && v.high === null))
    return unavailable(
      'No sourced count of venues exists for this market, so the number of businesses that could '
      + 'buy this cannot be established.',
      'venues', ['overpass', 'wikidata']);

  const high = v.high ?? v.low as number;
  const low = v.low ?? v.high as number;

  const caveats = [
    `${high.toLocaleString('en-US')} venues${v.highSource ? `, ${v.highSource}` : ''}. `
    + 'This is the generous count and it is the figure used below.',
  ];
  if (low !== high)
    caveats.push(
      `A second source counts ${low.toLocaleString('en-US')}`
      + `${v.lowSource ? ` (${v.lowSource})` : ''}. The two disagree because they count different `
      + 'things: an open map records every tagged premises, an encyclopaedia only notable ones. '
      + `Treat the market as a range of ${low.toLocaleString('en-US')}-${high.toLocaleString('en-US')} venues.`);

  return {
    value: high, unit: 'venues', confidence: 'secondary',
    unvalidated: false, unvalidatedReason: null,
    inputs: ['overpass:premises', 'wikidata:premises'],
    usedBenchmark: false, caveats,
  };
}

export function marketCeilingRevenue(
  market: Computed, pricePerMonth: Computed, commissionPct: Computed,
): Computed {
  if (market.unvalidated || pricePerMonth.unvalidated)
    return unavailable(
      'The market ceiling cannot be computed: '
      + (market.unvalidatedReason ?? pricePerMonth.unvalidatedReason ?? 'an input is unavailable.'),
      'USD/month', [...market.inputs, ...pricePerMonth.inputs]);

  const keep = commissionPct.unvalidated || commissionPct.value === null
    ? 1 : 1 - commissionPct.value / 100;

  const out = combine([market, pricePerMonth], 'USD/month',
    ([m, p]) => (m as number) * (p as number) * keep);
  if (!out.unvalidated)
    out.caveats = [...out.caveats,
      'This is what the market yields at 100% share — every customer in it, none lost, from month '
      + 'one. No business achieves it. It is an upper bound, not a forecast.'];
  return out;
}

const noConversionStep = (): Computed => ({
  value: 100, unit: 'percent', confidence: 'primary',
  unvalidated: false, unvalidatedReason: null,
  inputs: ['p4q1 business_model'], usedBenchmark: false,
  caveats: ['A venue that signs a licence is already a paying customer, so no install-to-paid '
    + 'conversion applies to this model.'],
});

/* -------------------------------------------------------- projection --- */

export interface ProjectionPoint {
  month: number;
  payers: number;
  netRevenue: number;
}

export function project(
  installs: Computed, storeConversionPct: Computed, survival: Computed,
  pricePerMonth: Computed, commissionPct: Computed, months: number,
): { points: ProjectionPoint[]; blocked: Computed | null } {
  for (const c of [installs, storeConversionPct, survival, pricePerMonth, commissionPct]) {
    if (c.unvalidated || c.value === null)
      return { points: [], blocked: c };
  }

  const perMonth = (installs.value as number) * ((storeConversionPct.value as number) / 100);
  const s = survival.value as number;
  const price = pricePerMonth.value as number;
  const keep = 1 - (commissionPct.value as number) / 100;

  const points: ProjectionPoint[] = [];
  let payers = 0;
  for (let m = 1; m <= months; m += 1) {
    payers = payers * s + perMonth;          
    points.push({ month: m, payers, netRevenue: payers * price * keep });
  }
  return { points, blocked: null };
}

/* ----------------------------------------------------------- verdicts --- */

export type VerdictCode = 'supported' | 'ambitious' | 'unsupported' | 'undeterminable';

export interface ObjectiveVerdict {
  code: VerdictCode;
  objective: number | null;
  derived: number | null;
  ratio: number | null;
  detail: string;
  unvalidated: boolean;
}

const undeterminable = (detail: string, objective: number | null = null): ObjectiveVerdict =>
  ({ code: 'undeterminable', objective, derived: null, ratio: null, detail, unvalidated: true });

function band(ratio: number): VerdictCode {
  if (ratio >= 1) return 'supported';
  if (ratio >= 0.6) return 'ambitious';
  return 'unsupported';
}

export function judge(
  what: string, unit: string, objective: number | null, derived: Computed, horizon: number,
  floor: number | null = null,
): ObjectiveVerdict {
  if (objective === null) return undeterminable(`No ${what} objective was given, so none was judged.`);
  if (derived.unvalidated || derived.value === null)
    return undeterminable(
      `Your ${what} objective could not be judged: ${derived.unvalidatedReason ?? 'the derived figure is unavailable.'}`,
      objective);
  if (objective === 0)
    return undeterminable('An objective of zero cannot be judged as a ratio.', objective);

  const ratio = derived.value / objective;
  const code: VerdictCode = floor !== null && floor > 0
    ? (derived.value >= objective ? 'supported'
      : derived.value >= floor ? 'ambitious' : 'unsupported')
    : band(ratio);
  const fmt = (n: number) => (unit === 'USD/month'
    ? `$${Math.round(n).toLocaleString('en-US')}/month`
    : `${Math.round(n).toLocaleString('en-US')} ${unit}`);

  const verdicts: Record<VerdictCode, string> = {
    supported: `Your ${what} objective of ${fmt(objective)} is supported: the published figures for `
      + `your category, market and budget project ${fmt(derived.value)} by month ${horizon}.`,
    ambitious: floor !== null && floor > 0
      ? `The sources project ${fmt(derived.value)} by month ${horizon}. That clears the floor of `
        + `${fmt(floor)} you said you would stop below, but falls short of the ${fmt(objective)} `
        + `you are aiming at — ${Math.round(ratio * 100)}% of it.`
      : `Your ${what} objective of ${fmt(objective)} is within reach but not supported: the `
        + `sources project ${fmt(derived.value)} by month ${horizon}, `
        + `${Math.round(ratio * 100)}% of what you are aiming at.`,
    unsupported: `Your ${what} objective of ${fmt(objective)} is not supported by the sources, which `
      + `project ${fmt(derived.value)} by month ${horizon} — `
      + `${Math.round(ratio * 100)}% of it.`,
    undeterminable: '',
  };

  return { code, objective, derived: derived.value, ratio, detail: verdicts[code], unvalidated: false };
}

/* ------------------------------------------------------- back-solving --- */

export interface Lever {
  name: string;
  detail: string;
  unvalidated: boolean;
}

export function levers(
  objectiveRevenue: number | null,
  derivedRevenue: Computed,
  acquisitionBudget: number | null,
  payersAtHorizon: Computed,
  pricePerMonth: number | null,
  commissionPct: Computed,
  points: ProjectionPoint[],
  horizon: number,
): Lever[] {
  const out: Lever[] = [];
  if (objectiveRevenue === null || objectiveRevenue <= 0) return out;
  if (derivedRevenue.unvalidated || derivedRevenue.value === null || derivedRevenue.value <= 0) {
    out.push({
      name: 'Not back-solvable',
      detail: 'The derived revenue is unavailable, so what would have to change to reach your '
        + 'objective cannot be worked out. Fill the missing benchmark first.',
      unvalidated: true,
    });
    return out;
  }
  if (derivedRevenue.value >= objectiveRevenue) return out;   

  const shortfall = objectiveRevenue / derivedRevenue.value;

  if (acquisitionBudget !== null && acquisitionBudget > 0)
    out.push({
      name: 'Budget',
      detail: `Acquisition spend of about $${Math.round(acquisitionBudget * shortfall).toLocaleString('en-US')}`
        + ` per month instead of $${Math.round(acquisitionBudget).toLocaleString('en-US')} — `
        + `${shortfall.toFixed(1)}x what you planned. This assumes cost-per-install does not rise as `
        + 'you buy more of it, which in practice it does.',
      unvalidated: false,
    });

  if (!payersAtHorizon.unvalidated && payersAtHorizon.value && payersAtHorizon.value > 0
      && !commissionPct.unvalidated && commissionPct.value !== null) {
    const needed = objectiveRevenue / (payersAtHorizon.value * (1 - commissionPct.value / 100));
    out.push({
      name: 'Price',
      detail: `A price of about $${needed.toFixed(2)} per customer per month instead of `
        + `$${(pricePerMonth ?? 0).toFixed(2)}. Check this against what comparable apps charge before `
        + 'treating it as available to you.',
      unvalidated: false,
    });
  }

  const reached = points.find((p) => p.netRevenue >= objectiveRevenue);
  out.push(reached
    ? {
      name: 'Time',
      detail: `On the current plan the projection reaches your objective in month ${reached.month}, `
        + `not month ${horizon}.`,
      unvalidated: false,
    }
    : {
      name: 'Time',
      detail: `On the current plan the projection does not reach your objective within `
        + `${points.length} months. Cohort decay eventually cancels new arrivals, so more time alone `
        + 'does not close this gap.',
      unvalidated: false,
    });

  return out;
}

/* -------------------------------------------------------- the whole run --- */

export interface DerivationResult {
  model: MarketModel;
  tam: Computed;
  sam: Computed;
  installsPerMonth: Computed;
  storeConversionPct: Computed;
  monthlySurvival: Computed;
  somPayers: Computed;
  impliedLifetimeMonths: Computed;
  costPerPayingCustomer: Computed;
  derivedMonthlyRevenue: Computed;
  points: ProjectionPoint[];
  horizonMonths: number;
  marketBound: boolean;
  marketCeiling: Computed;
  ceilingBreached: boolean;
  verdicts: {
    revenue: ObjectiveVerdict;
    users: ObjectiveVerdict;
    floor: ObjectiveVerdict | null;
    overall: { code: VerdictCode; headline: string; detail: string };
  };
  levers: Lever[];
  benchmarksUsed: Record<string, Resolved>;
}

export const DERIVATION_BENCHMARK_KEYS = [
  'cpi_usd',
  'store_conversion_pct',
  'churn_monthly_pct',
  'retention_d30_pct',
  'app_store_commission_standard_pct',
  'b2b_cac_usd',
  'b2b_logo_churn_monthly_pct',
] as const;

const HORIZON_DEFAULT = 12;
const PROJECTION_CEILING = 60;   

export function derive(input: DerivationInputs): DerivationResult {
  const b = Object.fromEntries(
    DERIVATION_BENCHMARK_KEYS.map((k) => [k, resolveBenchmark(input.verticalId, k)]),
  ) as Record<(typeof DERIVATION_BENCHMARK_KEYS)[number], Resolved>;

  const horizon = Math.max(1, input.horizonMonths ?? HORIZON_DEFAULT);

  const model = marketModelFor(input.businessModel);
  const price = assumption(input.pricePerMonth, 'USD/month', 'p4q2 price_per_month');
  const isB2B = model === 'b2b_licence';

  const commission: Computed = isB2B
    ? {
      value: 0, unit: 'percent', confidence: 'primary',
      unvalidated: false, unvalidatedReason: null,
      inputs: ['p4q1 business_model'], usedBenchmark: false,
      caveats: ['Sold direct to businesses, so no app-store commission applies.'],
    }
    : fromBenchmark(b.app_store_commission_standard_pct);

  const tam = isB2B ? tamVenues(input) : tamPeople(input);

  const sam = isB2B ? tam : samPeople(tam, input);

  const cpi = fromBenchmark(isB2B ? b.b2b_cac_usd : b.cpi_usd);
  const installs = installsPerMonth(input, cpi, model);
  const storeConv = isB2B ? noConversionStep() : fromBenchmark(b.store_conversion_pct);
  const survival = isB2B
    ? monthlySurvival(fromBenchmark(b.b2b_logo_churn_monthly_pct), unavailable(
      'App retention benchmarks count installs still opening an app. They do not describe whether '
      + 'a business renews a licence, so they are not substituted here.',
      'percent', ['p4q1 business_model']))
    : monthlySurvival(fromBenchmark(b.churn_monthly_pct), fromBenchmark(b.retention_d30_pct));

  const run = project(installs, storeConv, survival, price, commission, horizon);
  const long = project(installs, storeConv, survival, price, commission, PROJECTION_CEILING);

  const atHorizon = run.points.at(-1) ?? null;
  const blocked = run.blocked ?? (atHorizon ? null : unavailable(
    'The projection produced no months to report.', 'people', []));

  const customerUnit = isB2B ? 'venues' : 'people';
  const somPayers: Computed = (blocked || !atHorizon)
    ? unavailable(
      blocked?.unvalidatedReason
        ?? 'A figure the projection depends on is unavailable, so the obtainable market cannot be derived.',
      customerUnit,
      [...installs.inputs, ...storeConv.inputs, ...survival.inputs])
    : combine([installs, storeConv, survival], customerUnit, () => atHorizon.payers);

  const derivedRevenue: Computed = (blocked || !atHorizon)
    ? unavailable(
      blocked?.unvalidatedReason ?? 'The projection could not be produced.',
      'USD/month',
      [...installs.inputs, ...storeConv.inputs, ...survival.inputs, ...price.inputs, ...commission.inputs])
    : combine([installs, storeConv, survival, price, commission], 'USD/month',
      () => atHorizon.netRevenue);

  const marketBound = !somPayers.unvalidated && !sam.unvalidated
    && somPayers.value !== null && sam.value !== null && somPayers.value > sam.value;
  if (marketBound)
    somPayers.caveats = [...somPayers.caveats,
      'The budget would buy more customers than the serviceable market contains. The market is the '
      + 'binding constraint here, not the money. The figure is reported unclamped so the mismatch is visible.'];

  const marketCeiling = marketCeilingRevenue(sam, price, commission);
  const ceilingBreached = !marketCeiling.unvalidated && marketCeiling.value !== null
    && input.objectiveRevenue !== null && input.objectiveRevenue > marketCeiling.value;

  const impliedLifetimeMonths: Computed = survival.unvalidated || survival.value === null
    ? unavailable(
      survival.unvalidatedReason ?? 'No survival rate is available for this model.',
      'months', survival.inputs)
    : survival.value >= 1
      ? unavailable('A survival rate of 100% implies an infinite customer lifetime.',
        'months', survival.inputs)
      : combine([survival], 'months', ([sv]) => 1 / (1 - (sv as number)));

  const costPerPayingCustomer: Computed = isB2B
    ? cpi
    : (storeConv.unvalidated || storeConv.value === null || storeConv.value === 0
      ? unavailable(
        storeConv.unvalidatedReason
          ?? 'No sourced install-to-paid rate exists for this category, so the cost of one paying '
             + 'customer cannot be derived.',
        'USD', [...cpi.inputs, ...storeConv.inputs])
      : combine([cpi, storeConv], 'USD', ([c, pct]) => (c as number) / ((pct as number) / 100)));

  const revenueVerdict = judge(
    'revenue', 'USD/month', input.objectiveRevenue, derivedRevenue, horizon, input.objectiveFloor);
  const usersVerdict = judge('user', 'people', input.objectiveUsers, somPayers, horizon);
  const floorVerdict = input.objectiveFloor === null
    ? null
    : judge('walk-away floor', 'USD/month', input.objectiveFloor, derivedRevenue, horizon);

  return {
    model,
    tam, sam, installsPerMonth: installs, storeConversionPct: storeConv,
    monthlySurvival: survival, somPayers, impliedLifetimeMonths, costPerPayingCustomer,
    derivedMonthlyRevenue: derivedRevenue,
    points: run.points, horizonMonths: horizon, marketBound,
    marketCeiling, ceilingBreached,
    verdicts: {
      revenue: revenueVerdict,
      users: usersVerdict,
      floor: floorVerdict,
      overall: overallVerdict(revenueVerdict, usersVerdict, floorVerdict, {
        breached: ceilingBreached, ceiling: marketCeiling, objective: input.objectiveRevenue, model,
      }),
    },
    levers: levers(
      input.objectiveRevenue, derivedRevenue, input.acquisitionBudget,
      somPayers, input.pricePerMonth, commission, long.points, horizon),
    benchmarksUsed: b,
  };
}

interface CeilingCheck {
  breached: boolean;
  ceiling: Computed;
  objective: number | null;
  model: MarketModel;
}

function overallVerdict(
  revenue: ObjectiveVerdict, users: ObjectiveVerdict, floor: ObjectiveVerdict | null,
  ceiling: CeilingCheck,
): { code: VerdictCode; headline: string; detail: string } {
  if (ceiling.breached && ceiling.ceiling.value !== null && ceiling.objective !== null) {
    const all = ceiling.model === 'b2b_licence' ? 'every business in it' : 'every customer in it';
    return {
      code: 'unsupported',
      headline: 'Do not proceed — the objective is larger than the market',
      detail: `You are aiming at $${Math.round(ceiling.objective).toLocaleString('en-US')} a month. `
        + `Winning the entire market — ${all}, none of them ever lost — produces `
        + `$${Math.round(ceiling.ceiling.value).toLocaleString('en-US')} a month at the price you set. `
        + 'This goal is not ambitious, it is arithmetically out of reach, and no forecast was needed '
        + 'to establish that. Change the price, the market, or the goal.',
    };
  }

  const clearsFloor = floor !== null && !floor.unvalidated && floor.code === 'supported';
  const floorLine = floor === null
    ? ''
    : clearsFloor
      ? ' The projection does clear the stop-loss floor you set, so this is a question of ambition rather than viability.'
      : ' The projection does not clear the stop-loss floor you set, which by your own definition means not proceeding.';

  if (revenue.unvalidated && users.unvalidated)
    return {
      code: 'undeterminable',
      headline: 'No verdict — the evidence is missing',
      detail: 'Neither objective could be judged, because the figures the projection depends on are '
        + 'not sourced for this category. This is a gap in the benchmark data, not a finding about '
        + 'your idea. The documents name which figure is missing.',
    };

  const codes = [revenue.code, users.code].filter((c) => c !== 'undeterminable');
  const worst: VerdictCode = codes.includes('unsupported') ? 'unsupported'
    : codes.includes('ambitious') ? 'ambitious'
      : codes.includes('supported') ? 'supported' : 'undeterminable';

  if (worst === 'supported')
    return {
      code: 'supported',
      headline: 'Proceed — both objectives are supported by the evidence',
      detail: 'The published figures for your category, market and budget project outcomes at or '
        + 'above both goals you set. That is not a promise the product will work; it means your '
        + `goals are not the reason it would fail.${floorLine}`,
    };

  const mixed = revenue.code !== users.code
    && !revenue.unvalidated && !users.unvalidated;
  const diagnosis = !mixed ? ''
    : revenue.code === 'unsupported' || revenue.code === 'ambitious'
      ? ' Reach is achievable and revenue is not, which points at the price rather than the audience.'
      : ' Revenue per customer is fine and reach is not, which points at the acquisition budget rather than the pricing.';

  if (worst === 'ambitious')
    return {
      code: 'ambitious',
      headline: 'Proceed with a revised objective',
      detail: 'The sources put you close to but short of what you set out to achieve. The goals are '
        + 'the thing to change here, not necessarily the product — the levers below say by how much.'
        + diagnosis + floorLine,
    };

  return {
    code: 'unsupported',
    headline: 'Do not proceed on these objectives',
    detail: 'What you are aiming at is a long way from what the published figures for your category, '
      + 'market and budget support. That does not mean the idea is wrong; it means this plan for it '
      + 'is. Change the objectives, the budget or the price — the levers below quantify each — and '
      + 'run it again.' + diagnosis + floorLine,
  };
}
