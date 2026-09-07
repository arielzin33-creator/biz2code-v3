/* Deterministic economics. 11 formulas. The LLM never does arithmetic. */

import {
  resolve as resolveBenchmark, caveats as benchmarkCaveats,
  type Confidence, type Resolved,
} from './benchmark.service';

export type ComputedConfidence = Confidence | 'assumption';

const TIERS: ComputedConfidence[] = ['primary', 'secondary', 'tertiary', 'assumption', 'placeholder'];

export function weakest(...tiers: ComputedConfidence[]): ComputedConfidence {
  return tiers.reduce((a, b) => (TIERS.indexOf(b) > TIERS.indexOf(a) ? b : a), 'primary');
}

export interface Computed {
  value: number | null;
  unit: string;
  confidence: ComputedConfidence;
  unvalidated: boolean;
  unvalidatedReason: string | null;
  inputs: string[];
  usedBenchmark: boolean;
  caveats: string[];
}

const ASSUMPTION_CAVEAT_WHOLLY =
  'Derived entirely from your own stated assumptions. No published benchmark supports this figure.';
const ASSUMPTION_CAVEAT_PARTLY =
  'Partly derived from your own stated assumptions, so it is not a wholly sourced figure.';
const ASSUMPTION_CAVEATS = [ASSUMPTION_CAVEAT_WHOLLY, ASSUMPTION_CAVEAT_PARTLY];

/* ------------------------------------------------------------ constructors --- */

function computed(
  value: number, unit: string, confidence: ComputedConfidence,
  inputs: string[], usedBenchmark: boolean, caveats: string[] = [],
): Computed {
  if (!Number.isFinite(value))
    return unavailable('The calculation did not produce a finite number.', unit, inputs);
  return {
    value, unit, confidence,
    unvalidated: false, unvalidatedReason: null,
    inputs, usedBenchmark, caveats,
  };
}

export function unavailable(reason: string, unit: string, inputs: string[] = []): Computed {
  return {
    value: null, unit, confidence: 'placeholder',
    unvalidated: true, unvalidatedReason: reason,
    inputs, usedBenchmark: false, caveats: [reason],
  };
}

export function assumption(value: number | null, unit: string, label: string): Computed {
  if (value === null || !Number.isFinite(value))
    return unavailable(`${label} was not answered.`, unit, [label]);
  return {
    value, unit, confidence: 'assumption',
    unvalidated: false, unvalidatedReason: null,
    inputs: [label], usedBenchmark: false, caveats: [],
  };
}

export function fromBenchmark(m: Resolved): Computed {
  const label = `benchmark:${m.verticalId}.${m.metricKey}`;
  if (m.unvalidated || m.value === null)
    return unavailable(m.unvalidatedReason ?? `No sourced value for ${m.metricKey}.`, m.unit, [label]);
  return {
    value: m.value, unit: m.unit, confidence: m.confidence,
    unvalidated: false, unvalidatedReason: null,
    inputs: [label], usedBenchmark: true, caveats: benchmarkCaveats(m),
  };
}

/* --------------------------------------------------------------- combining --- */

const mergeInputs = (...cs: Computed[]) => [...new Set(cs.flatMap((c) => c.inputs))];
const mergeCaveats = (...cs: Computed[]) =>
  [...new Set(cs.flatMap((c) => c.caveats))].filter((c) => !ASSUMPTION_CAVEATS.includes(c));

export function combine(
  inputs: Computed[], unit: string, fn: (values: number[]) => number,
): Computed {
  const broken = inputs.find((c) => c.unvalidated || c.value === null);
  if (broken)
    return unavailable(
      broken.unvalidatedReason ?? 'An input was unavailable.',
      unit, mergeInputs(...inputs),
    );

  const values = inputs.map((c) => c.value as number);
  const confidence = weakest(...inputs.map((c) => c.confidence));
  const usedBenchmark = inputs.some((c) => c.usedBenchmark);
  const result = computed(fn(values), unit, confidence,
    mergeInputs(...inputs), usedBenchmark, mergeCaveats(...inputs));

  if (confidence === 'assumption' && !result.unvalidated)
    result.caveats = [
      usedBenchmark ? ASSUMPTION_CAVEAT_PARTLY : ASSUMPTION_CAVEAT_WHOLLY,
      ...result.caveats,
    ];

  return result;
}

function divide(numerator: Computed, denominator: Computed, unit: string, zeroReason: string): Computed {
  if (denominator.value === 0)
    return unavailable(zeroReason, unit, mergeInputs(numerator, denominator));
  return combine([numerator, denominator], unit, ([a, b]) => (a as number) / (b as number));
}

/* ================================================================ formulas === */

export const payingUsers = (reachableMarket: Computed, conversionPct: Computed): Computed =>
  combine([reachableMarket, conversionPct], 'people', ([m, c]) => (m as number) * ((c as number) / 100));

export const grossMonthlyRevenue = (paying: Computed, pricePerMonth: Computed): Computed =>
  combine([paying, pricePerMonth], 'USD/month', ([p, price]) => (p as number) * (price as number));

const STORE_DISTRIBUTED = new Set([
  'Subscription',
  'Freemium (free tier + paid upgrade)',
  'In-app purchases',
  'One-time purchase',
]);
const NOT_STORE_DISTRIBUTED = new Set([
  'Advertising',                      
  'Commission on transactions',       
  'Sold to businesses (B2B licence)', 
]);

export function storeCommission(
  gross: Computed, businessModel: string | null, commissionPct: Computed,
): Computed {
  if (!businessModel)
    return unavailable('The business model was not answered.', 'USD/month', ['p4q1 business_model']);

  if (NOT_STORE_DISTRIBUTED.has(businessModel))
    return {
      value: 0, unit: 'USD/month', confidence: 'assumption',
      unvalidated: false, unvalidatedReason: null,
      inputs: ['p4q1 business_model'], usedBenchmark: false,
      caveats: [`No app-store commission applies to a "${businessModel}" model.`],
    };

  if (!STORE_DISTRIBUTED.has(businessModel))
    return unavailable(
      `Whether app-store commission applies cannot be determined for "${businessModel}".`,
      'USD/month', ['p4q1 business_model']);

  const result = combine([gross, commissionPct], 'USD/month',
    ([g, pct]) => (g as number) * ((pct as number) / 100));
  if (!result.unvalidated)
    result.caveats = [...result.caveats,
      'Assumes the standard commission rate. The reduced rate for small-business programs is not applied.'];
  return result;
}

export const netMonthlyRevenue = (gross: Computed, commission: Computed): Computed =>
  combine([gross, commission], 'USD/month', ([g, c]) => (g as number) - (c as number));

export const annualRecurringRevenue = (net: Computed): Computed =>
  combine([net], 'USD/year', ([n]) => (n as number) * 12);

export const monthlyTco = (monthlyOpex: Computed, commission: Computed): Computed =>
  combine([monthlyOpex, commission], 'USD/month', ([o, c]) => (o as number) + (c as number));

export const monthlyProfit = (net: Computed, monthlyOpex: Computed): Computed =>
  combine([net, monthlyOpex], 'USD/month', ([n, o]) => (n as number) - (o as number));

export const arpuEffective = (net: Computed, payingCustomers: Computed): Computed =>
  divide(net, payingCustomers, 'USD/month/user',
    'There are no paying customers, so revenue per customer cannot be computed.');

export function cacEstimate(cpiBenchmark: Computed, conversionPct: Computed): Computed {
  if (conversionPct.value === 0)
    return unavailable(
      'A conversion rate of 0% means no install ever becomes a customer, so cost per customer is undefined.',
      'USD', mergeInputs(cpiBenchmark, conversionPct));
  return combine([cpiBenchmark, conversionPct], 'USD',
    ([cpi, pct]) => (cpi as number) / ((pct as number) / 100));
}

export const ltvEstimate = (pricePerMonth: Computed, lifetimeMonths: Computed): Computed =>
  combine([pricePerMonth, lifetimeMonths], 'USD', ([p, m]) => (p as number) * (m as number));

export function benchmarkImpliedLifetimeMonths(
  churnMonthlyPct: Computed, retentionD30Pct: Computed,
): Computed {
  if (!churnMonthlyPct.unvalidated && churnMonthlyPct.value !== null) {
    if (churnMonthlyPct.value === 0)
      return unavailable('A monthly churn of 0% implies an infinite customer lifetime.',
        'months', churnMonthlyPct.inputs);
    return combine([churnMonthlyPct], 'months', ([c]) => 100 / (c as number));
  }

  if (retentionD30Pct.value === 100)
    return unavailable('A 30-day retention of 100% implies an infinite customer lifetime.',
      'months', retentionD30Pct.inputs);

  return combine([retentionD30Pct], 'months', ([r]) => 100 / (100 - (r as number)));
}

export const ltvCacRatio = (ltv: Computed, cac: Computed): Computed =>
  divide(ltv, cac, 'ratio',
    'A customer acquisition cost of zero makes the LTV:CAC ratio undefined.');

export const paybackPeriodMonths = (cac: Computed, pricePerMonth: Computed): Computed =>
  divide(cac, pricePerMonth, 'months',
    'Not applicable for a zero-price model: with no price there is nothing to pay the acquisition cost back.');

/* ============================================================== comparisons === */

export interface Comparison {
  verdict: 'above' | 'below' | 'within' | 'unavailable';
  detail: string;
  unvalidated: boolean;
}

const unavailableComparison = (detail: string): Comparison =>
  ({ verdict: 'unavailable', detail, unvalidated: true });

export function arpuDivergence(arpu: Computed, benchmarkArpu: Computed): Comparison {
  if (arpu.unvalidated || arpu.value === null) return unavailableComparison('Effective ARPU could not be computed.');
  if (benchmarkArpu.unvalidated || benchmarkArpu.value === null)
    return unavailableComparison('No sourced ARPU benchmark exists for this category to compare against.');
  if (benchmarkArpu.value === 0) return unavailableComparison('The benchmark ARPU is zero, so no ratio can be formed.');

  const monthlyBenchmark = benchmarkArpu.value / 12;
  const ratio = arpu.value / monthlyBenchmark;
  const detail = `Effective ARPU is ${ratio.toFixed(2)}x the category benchmark ` +
                 `(${monthlyBenchmark.toFixed(2)} USD/month, derived from a ${benchmarkArpu.value} USD 12-month blended figure).`;

  if (ratio > 2) return { verdict: 'above', detail: `${detail} A divergence above 2x warrants scrutiny.`, unvalidated: false };
  if (ratio < 0.5) return { verdict: 'below', detail: `${detail} A divergence below 0.5x warrants scrutiny.`, unvalidated: false };
  return { verdict: 'within', detail, unvalidated: false };
}

export function lifetimeDivergence(answered: Computed, implied: Computed): Comparison {
  if (answered.unvalidated || answered.value === null)
    return unavailableComparison('Expected customer lifetime was not answered.');
  if (implied.unvalidated || implied.value === null)
    return unavailableComparison(
      'No sourced retention benchmark exists for this category, so the assumed lifetime cannot be cross-checked.');
  if (implied.value === 0)
    return unavailableComparison('The benchmark implies a zero lifetime, so no ratio can be formed.');

  const ratio = answered.value / implied.value;
  const detail =
    `You expect a paying customer to stay ${answered.value} months. ` +
    `The category's published 30-day retention implies about ${implied.value.toFixed(1)} months ` +
    `(${ratio.toFixed(1)}x lower). That benchmark measures installs still opening the app, ` +
    `not customers still paying, so it may not describe your customers — but nothing published ` +
    `supports the longer figure.`;

  if (ratio > 2) return { verdict: 'above', detail, unvalidated: false };
  if (ratio < 0.5)
    return { verdict: 'below', unvalidated: false,
      detail: `You expect ${answered.value} months, below the ${implied.value.toFixed(1)} months ` +
              `the category's published retention implies.` };
  return { verdict: 'within', unvalidated: false,
    detail: `Your ${answered.value}-month expectation is consistent with the ` +
            `${implied.value.toFixed(1)} months implied by published retention.` };
}

export function ltvCacVerdict(ratio: Computed, floor: Computed): Comparison {
  if (ratio.unvalidated || ratio.value === null) return unavailableComparison('The LTV:CAC ratio could not be computed.');
  if (floor.unvalidated || floor.value === null)
    return unavailableComparison('No sourced viability floor exists to compare against.');

  const detail = `LTV:CAC is ${ratio.value.toFixed(2)}, against a sourced campaign viability floor of ${floor.value}.`;
  return ratio.value >= floor.value
    ? { verdict: 'above', detail: `${detail} It clears the floor.`, unvalidated: false }
    : { verdict: 'below', detail: `${detail} It falls below the floor.`, unvalidated: false };
}

/* ============================================================ orchestration === */

export interface CalculationInputs {
  verticalId: string;
  derivedPayers?: Computed;
  derivedLifetimeMonths?: Computed;
  derivedCac?: Computed;
  reachableMarket: number | null;    
  businessModel: string | null;      
  pricePerMonth: number | null;      
  conversionPct: number | null;      
  monthlyOpex: number | null;        
  expectedLifetimeMonths: number | null;   
}

export interface CalculationResult {
  payingUsers: Computed;
  grossMonthlyRevenue: Computed;
  storeCommission: Computed;
  netMonthlyRevenue: Computed;
  annualRecurringRevenue: Computed;
  monthlyTco: Computed;
  monthlyProfit: Computed;
  arpuEffective: Computed;
  cacEstimate: Computed;
  expectedLifetimeMonths: Computed;
  benchmarkImpliedLifetimeMonths: Computed;
  ltvEstimate: Computed;
  ltvCacRatio: Computed;
  paybackPeriodMonths: Computed;
  comparisons: { arpu: Comparison; ltvCac: Comparison; lifetime: Comparison };
  benchmarksUsed: Record<string, Resolved>;
}

export const BENCHMARK_KEYS = [
  'app_store_commission_standard_pct',
  'cpi_usd',
  'churn_monthly_pct',
  'retention_d30_pct',
  'arpu_12mo_blended_usd',
  'ltv_cac_min_threshold_ratio',
  'crash_rate_user_perceived_max_pct',
  'anr_rate_user_perceived_max_pct',
  'crash_rate_per_device_max_pct',
] as const;

export const ECONOMIC_QUESTIONS = {
  reachableMarket: 'p2q3',
  businessModel: 'p4q1',
  pricePerMonth: 'p4q2',
  conversionPct: 'p4q3',
  monthlyOpex: 'p4q4',
  expectedLifetimeMonths: 'p4q6',
} as const;

export interface AnswerLike {
  question_id: string;
  value_text: string | null;
  value_number: string | number | null;
}

function toNumber(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function inputsFromAnswers(verticalId: string, answers: AnswerLike[]): CalculationInputs {
  const byId = new Map(answers.map((a) => [a.question_id, a]));
  const q = ECONOMIC_QUESTIONS;
  return {
    verticalId,
    reachableMarket: toNumber(byId.get(q.reachableMarket)?.value_number),
    businessModel: byId.get(q.businessModel)?.value_text ?? null,
    pricePerMonth: toNumber(byId.get(q.pricePerMonth)?.value_number),
    conversionPct: toNumber(byId.get(q.conversionPct)?.value_number),
    monthlyOpex: toNumber(byId.get(q.monthlyOpex)?.value_number),
    expectedLifetimeMonths: toNumber(byId.get(q.expectedLifetimeMonths)?.value_number),
  };
}

export function calculate(input: CalculationInputs): CalculationResult {
  const b = Object.fromEntries(
    BENCHMARK_KEYS.map((k) => [k, resolveBenchmark(input.verticalId, k)]),
  ) as Record<(typeof BENCHMARK_KEYS)[number], Resolved>;

  const reachableMarket = assumption(input.reachableMarket, 'people', 'p2q3 reachable_market');
  const pricePerMonth = assumption(input.pricePerMonth, 'USD/month', 'p4q2 price_per_month');
  const conversionPct = assumption(input.conversionPct, 'percent', 'p4q3 conversion_pct');
  const monthlyOpex = assumption(input.monthlyOpex, 'USD/month', 'p4q4 monthly_opex');

  const paying = input.derivedPayers ?? payingUsers(reachableMarket, conversionPct);
  const gross = grossMonthlyRevenue(paying, pricePerMonth);
  const commission = storeCommission(
    gross, input.businessModel, fromBenchmark(b.app_store_commission_standard_pct));
  const net = netMonthlyRevenue(gross, commission);
  const tco = monthlyTco(monthlyOpex, commission);
  const profit = monthlyProfit(net, monthlyOpex);
  const arpu = arpuEffective(net, paying);
  const cac = input.derivedCac ?? cacEstimate(fromBenchmark(b.cpi_usd), conversionPct);
  const impliedLifetime = benchmarkImpliedLifetimeMonths(
    fromBenchmark(b.churn_monthly_pct), fromBenchmark(b.retention_d30_pct));
  const lifetime = input.expectedLifetimeMonths !== null
    ? assumption(input.expectedLifetimeMonths, 'months', 'p4q6 expected_lifetime_months')
    : input.derivedLifetimeMonths ?? impliedLifetime;
  const ltv = ltvEstimate(pricePerMonth, lifetime);
  const ratio = ltvCacRatio(ltv, cac);
  const payback = paybackPeriodMonths(cac, pricePerMonth);

  return {
    payingUsers: paying,
    grossMonthlyRevenue: gross,
    storeCommission: commission,
    netMonthlyRevenue: net,
    annualRecurringRevenue: annualRecurringRevenue(net),
    monthlyTco: tco,
    monthlyProfit: profit,
    arpuEffective: arpu,
    cacEstimate: cac,
    expectedLifetimeMonths: lifetime,
    benchmarkImpliedLifetimeMonths: impliedLifetime,
    ltvEstimate: ltv,
    ltvCacRatio: ratio,
    paybackPeriodMonths: payback,
    comparisons: {
      arpu: arpuDivergence(arpu, fromBenchmark(b.arpu_12mo_blended_usd)),
      ltvCac: ltvCacVerdict(ratio, fromBenchmark(b.ltv_cac_min_threshold_ratio)),
      lifetime: lifetimeDivergence(lifetime, impliedLifetime),
    },
    benchmarksUsed: b,
  };
}
