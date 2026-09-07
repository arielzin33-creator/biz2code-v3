/* Tests the calculation layer — pure functions, highest test value in the project. */

import { describe, it, expect } from 'vitest';
import {
  weakest, assumption, unavailable, fromBenchmark,
  payingUsers, grossMonthlyRevenue, storeCommission, netMonthlyRevenue,
  monthlyTco, monthlyProfit, arpuEffective, cacEstimate, benchmarkImpliedLifetimeMonths,
  ltvEstimate, ltvCacRatio, paybackPeriodMonths,
  arpuDivergence, ltvCacVerdict, calculate,
  type Computed,
} from './calculation.service';
import { resolve } from './benchmark.service';

const bench = (value: number, unit = 'USD', confidence: 'primary' | 'secondary' | 'tertiary' = 'secondary'): Computed => ({
  value, unit, confidence, unvalidated: false, unvalidatedReason: null,
  inputs: [`benchmark:test.${unit}`], usedBenchmark: true, caveats: [],
});

const num = (v: number, unit = 'number') => assumption(v, unit, `test ${unit}`);
const gone = (unit = 'number') => unavailable('test input is missing', unit, ['test missing']);

/* ============================================================ guardrail 2 === */

describe('guardrail: no NaN, no Infinity, ever', () => {
  it('a zero price makes payback not applicable, not Infinity', () => {
    const result = paybackPeriodMonths(bench(56), num(0, 'USD/month'));
    expect(result.value).toBeNull();
    expect(result.unvalidated).toBe(true);
    expect(result.unvalidatedReason).toMatch(/zero-price/);
  });

  it('zero paying customers makes ARPU unavailable, not Infinity', () => {
    const result = arpuEffective(num(1000, 'USD/month'), num(0, 'people'));
    expect(result.value).toBeNull();
    expect(result.unvalidatedReason).toMatch(/no paying customers/);
  });

  it('a zero CAC makes the LTV:CAC ratio unavailable', () => {
    const result = ltvCacRatio(num(40, 'USD'), num(0, 'USD'));
    expect(result.value).toBeNull();
    expect(result.unvalidatedReason).toMatch(/undefined/);
  });

  it('a zero conversion rate makes CAC unavailable, not Infinity', () => {
    const result = cacEstimate(bench(1.68), num(0, 'percent'));
    expect(result.value).toBeNull();
    expect(result.unvalidatedReason).toMatch(/0%/);
  });

  it('0 / 0 does not leak NaN', () => {
    const result = arpuEffective(num(0, 'USD/month'), num(0, 'people'));
    expect(result.value).toBeNull();
    expect(Number.isNaN(result.value as unknown as number)).toBe(false);
  });

  it('no formula returns a non-finite value for any pathological input', () => {
    const edge = [0, -0, 1e308, -1e308];
    const outputs: Computed[] = [];
    for (const a of edge) {
      for (const b of edge) {
        outputs.push(
          payingUsers(num(a), num(b)),
          grossMonthlyRevenue(num(a), num(b)),
          netMonthlyRevenue(num(a), num(b)),
          monthlyTco(num(a), num(b)),
          monthlyProfit(num(a), num(b)),
          arpuEffective(num(a), num(b)),
          cacEstimate(bench(a), num(b)),
          ltvEstimate(num(a), num(b)),
          ltvCacRatio(num(a), num(b)),
          paybackPeriodMonths(num(a), num(b)),
        );
      }
    }
    for (const out of outputs) {
      if (out.value !== null) expect(Number.isFinite(out.value)).toBe(true);
    }
    expect(outputs.length).toBeGreaterThan(100);   
  });
});

/* ============================================================ guardrail 1 === */

describe('guardrail: a missing input poisons the result honestly', () => {
  it('propagates unavailability rather than substituting zero', () => {
    const result = payingUsers(gone('people'), num(5, 'percent'));
    expect(result.value).toBeNull();
    expect(result.unvalidated).toBe(true);
  });

  it('names the input that caused it, not a generic message', () => {
    const result = grossMonthlyRevenue(gone('people'), num(40, 'USD/month'));
    expect(result.unvalidatedReason).toBe('test input is missing');
  });

  it('carries the failure through a whole chain', () => {
    const cac = cacEstimate(gone('USD'), num(3, 'percent'));
    const ratio = ltvCacRatio(num(40, 'USD'), cac);
    const payback = paybackPeriodMonths(cac, num(40, 'USD/month'));

    expect(cac.value).toBeNull();
    expect(ratio.value).toBeNull();
    expect(payback.value).toBeNull();
  });

  it('an unanswered question is unavailable, not zero', () => {
    const unanswered = assumption(null, 'people', 'p2q3 reachable_market');
    expect(unanswered.value).toBeNull();
    expect(unanswered.unvalidatedReason).toMatch(/was not answered/);
  });

  it('a placeholder benchmark becomes an unavailable input', () => {
    const placeholder = resolve('navigation_local', 'arpu_12mo_blended_usd');
    expect(placeholder.unvalidated).toBe(true);
    expect(fromBenchmark(placeholder).value).toBeNull();
  });
});

/* ============================================================ guardrail 3 === */

describe('guardrail: confidence inheritance', () => {
  it('takes the weakest tier', () => {
    expect(weakest('primary', 'secondary')).toBe('secondary');
    expect(weakest('primary', 'placeholder')).toBe('placeholder');
    expect(weakest('secondary', 'assumption')).toBe('assumption');
    expect(weakest('primary')).toBe('primary');
  });

  it('ranks an assumption below a published tertiary figure but above nothing', () => {
    expect(weakest('tertiary', 'assumption')).toBe('assumption');
    expect(weakest('assumption', 'placeholder')).toBe('placeholder');
  });

  it('a result mixing a benchmark with a guess inherits the guess', () => {
    const result = cacEstimate(bench(1.68, 'USD', 'secondary'), num(3, 'percent'));
    expect(result.confidence).toBe('assumption');
    expect(result.usedBenchmark).toBe(true);
  });

  it('a result from benchmarks alone keeps the benchmark tier', () => {
    const result = benchmarkImpliedLifetimeMonths(gone('percent'), bench(4.5, 'percent', 'secondary'));
    expect(result.confidence).toBe('secondary');
  });

  it('a pure-assumption figure says so in its caveats', () => {
    const result = payingUsers(num(250000, 'people'), num(3, 'percent'));
    expect(result.confidence).toBe('assumption');
    expect(result.caveats.join(' ')).toMatch(/entirely from your own stated assumptions/);
  });

  it('a mixed figure is flagged as partly assumed, not wholly', () => {
    const result = cacEstimate(bench(1.68), num(3, 'percent'));
    expect(result.caveats.join(' ')).toMatch(/Partly derived/);
    expect(result.caveats.join(' ')).not.toMatch(/entirely from your own/);
  });
});

/* ================================================================ formulas === */

describe('the eleven formulas', () => {
  it('paying_users = reachable * conversion%', () => {
    expect(payingUsers(num(250000, 'people'), num(3, 'percent')).value).toBe(7500);
  });

  it('gross_monthly_revenue = paying_users * price', () => {
    expect(grossMonthlyRevenue(num(7500), num(40, 'USD/month')).value).toBe(300000);
  });

  it('net = gross - commission, and tco = opex + commission', () => {
    const gross = num(300000, 'USD/month');
    const commission = num(90000, 'USD/month');
    expect(netMonthlyRevenue(gross, commission).value).toBe(210000);
    expect(monthlyTco(num(12000, 'USD/month'), commission).value).toBe(102000);
  });

  it('monthly_profit = net - opex, and may be negative', () => {
    expect(monthlyProfit(num(5000, 'USD/month'), num(12000, 'USD/month')).value).toBe(-7000);
  });

  it('arpu_effective = net / reachable', () => {
    expect(arpuEffective(num(300000, 'USD/month'), num(250000, 'people')).value).toBe(1.2);
  });

  it('cac_estimate = cpi / conversion%', () => {
    expect(cacEstimate(bench(1.68), num(3, 'percent')).value).toBeCloseTo(56, 10);
  });

  it('ltv_estimate = price * expected_lifetime', () => {
    expect(ltvEstimate(num(40, 'USD/month'), num(1.05, 'months')).value).toBeCloseTo(42, 10);
  });

  it('ltv_cac_ratio = ltv / cac', () => {
    expect(ltvCacRatio(num(42, 'USD'), num(56, 'USD')).value).toBeCloseTo(0.75, 10);
  });

  it('payback_period = cac / price', () => {
    expect(paybackPeriodMonths(num(56, 'USD'), num(40, 'USD/month')).value).toBeCloseTo(1.4, 10);
  });
});

describe('store commission — three distinct outcomes', () => {
  const gross = num(300000, 'USD/month');
  const rate = bench(30, 'percent', 'tertiary');

  it('charges a store-distributed model', () => {
    expect(storeCommission(gross, 'Subscription', rate).value).toBe(90000);
  });

  it('is a genuine zero for a model that never touches a store', () => {
    const result = storeCommission(gross, 'Sold to businesses (B2B licence)', rate);
    expect(result.value).toBe(0);
    expect(result.unvalidated).toBe(false);
    expect(result.caveats.join(' ')).toMatch(/No app-store commission applies/);
  });

  it('refuses to guess when the model is undecided', () => {
    const result = storeCommission(gross, 'Not yet decided', rate);
    expect(result.value).toBeNull();
    expect(result.unvalidated).toBe(true);
  });

  it('is unavailable when the question was never answered', () => {
    expect(storeCommission(gross, null, rate).value).toBeNull();
  });

  it('says it assumed the standard rate rather than the reduced one', () => {
    expect(storeCommission(gross, 'Subscription', rate).caveats.join(' '))
      .toMatch(/standard commission rate/);
  });
});

describe('the benchmark-implied lifetime cross-check', () => {
  it('prefers a sourced monthly churn', () => {
    const result = benchmarkImpliedLifetimeMonths(bench(20, 'percent'), bench(4.5, 'percent'));
    expect(result.value).toBeCloseTo(5, 10);          
  });

  it('falls back to D30 retention when churn is unsourced', () => {
    const result = benchmarkImpliedLifetimeMonths(gone('percent'), bench(4.5, 'percent'));
    expect(result.value).toBeCloseTo(100 / 95.5, 10); 
  });

  it('refuses infinite lifetimes', () => {
    expect(benchmarkImpliedLifetimeMonths(bench(0, 'percent'), gone('percent')).value).toBeNull();
    expect(benchmarkImpliedLifetimeMonths(gone('percent'), bench(100, 'percent')).value).toBeNull();
  });

  it('is unavailable when neither benchmark is sourced', () => {
    expect(benchmarkImpliedLifetimeMonths(gone('percent'), gone('percent')).value).toBeNull();
  });
});

/* ============================================================= comparisons === */

describe('comparisons against sourced figures', () => {
  it('flags ARPU more than 2x the benchmark', () => {
    const result = arpuDivergence(num(3, 'USD/month/user'), bench(12, 'USD'));
    expect(result.verdict).toBe('above');
    expect(result.detail).toMatch(/3\.00x/);
  });

  it('accepts ARPU close to the benchmark', () => {
    expect(arpuDivergence(num(1, 'USD/month/user'), bench(12, 'USD')).verdict).toBe('within');
  });

  it('is unavailable rather than wrong when no ARPU benchmark exists', () => {
    const result = arpuDivergence(num(1.2, 'USD/month/user'), gone('USD'));
    expect(result.verdict).toBe('unavailable');
    expect(result.unvalidated).toBe(true);
  });

  it('judges LTV:CAC against the sourced 1.5 floor', () => {
    expect(ltvCacVerdict(num(0.75, 'ratio'), bench(1.5, 'ratio')).verdict).toBe('below');
    expect(ltvCacVerdict(num(2.0, 'ratio'), bench(1.5, 'ratio')).verdict).toBe('above');
  });

  it('never asserts the unsourced 3:1 target', () => {
    const target = resolve('_cross_vertical_default', 'ltv_cac_target_ratio');
    expect(target.unvalidated).toBe(true);

    const verdict = ltvCacVerdict(num(2.0, 'ratio'), bench(1.5, 'ratio'));
    expect(verdict.detail).not.toMatch(/3:1|3\.0|three to one/i);
  });
});

/* ========================================================== reproducibility === */

describe('reproducibility', () => {
  const inputs = {
    verticalId: 'navigation_local',
    reachableMarket: 250000,
    businessModel: 'Sold to businesses (B2B licence)',
    pricePerMonth: 40,
    conversionPct: 3,
    monthlyOpex: 12000,
    expectedLifetimeMonths: 24,
  };

  it('produces identical output across runs', () => {
    expect(JSON.stringify(calculate(inputs))).toBe(JSON.stringify(calculate(inputs)));
  });

  it('computes the seed project end to end', () => {
    const r = calculate(inputs);
    expect(r.payingUsers.value).toBe(7500);
    expect(r.grossMonthlyRevenue.value).toBe(300000);
    expect(r.storeCommission.value).toBe(0);           
    expect(r.netMonthlyRevenue.value).toBe(300000);
    expect(r.monthlyProfit.value).toBe(288000);
    expect(r.arpuEffective.value).toBe(40);
  });

  it('clears the viability floor on the answered lifetime', () => {
    const r = calculate(inputs);
    expect(r.comparisons.ltvCac.verdict).toBe('above');
  });

  it('flags the answered lifetime against the published retention in the same result', () => {
    const r = calculate(inputs);
    expect(r.comparisons.lifetime.verdict).toBe('above');
    expect(r.comparisons.lifetime.detail).toMatch(/24 months/);
    expect(r.comparisons.lifetime.detail).toMatch(/installs still opening the app/);
    expect(r.benchmarkImpliedLifetimeMonths.value).toBeCloseTo(100 / 95.5, 6);
  });

  it('surfaces the proxy warning on every figure that depends on one', () => {
    const r = calculate(inputs);
    expect(r.cacEstimate.caveats.join(' ')).toMatch(/PROXY/);
    expect(r.benchmarkImpliedLifetimeMonths.caveats.join(' ')).toMatch(/PROXY/);
    expect(r.ltvCacRatio.caveats.join(' ')).toMatch(/PROXY/);   
  });

  it('leaves ARPU comparison unavailable where the category has no benchmark', () => {
    expect(calculate(inputs).comparisons.arpu.verdict).toBe('unavailable');
  });

  it('returns every formula even when the vertical is unknown', () => {
    const r = calculate({ ...inputs, verticalId: 'no_such_vertical' });
    expect(r.cacEstimate.value).toBeNull();
    expect(r.payingUsers.value).toBe(7500);   
  });

  it('survives every question being unanswered', () => {
    const r = calculate({
      verticalId: 'navigation_local',
      reachableMarket: null, businessModel: null,
      pricePerMonth: null, conversionPct: null, monthlyOpex: null,
      expectedLifetimeMonths: null,
    });
    const figures = Object.entries(r).filter(([k]) => k !== 'comparisons' && k !== 'benchmarksUsed');
    for (const [, f] of figures) {
      const c = f as Computed;
      expect(c.value === null || Number.isFinite(c.value)).toBe(true);
      if (c.value === null) expect(c.unvalidatedReason).toBeTruthy();
    }
  });
});
