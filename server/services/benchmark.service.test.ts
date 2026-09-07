/* Tests benchmark resolution — including, above all, the unvalidated path. */

import { describe, it, expect } from 'vitest';
import {
  resolve, resolveMany, caveats, isUnvalidated,
  listConflicts, listProxies, listVerticals, getVertical,
} from './benchmark.service';

describe('the contract: resolve always answers', () => {
  it('never returns null, even for nonsense', () => {
    const r = resolve('no_such_vertical', 'no_such_metric');
    expect(r).not.toBeNull();
    expect(r.value).toBeNull();
    expect(r.unvalidated).toBe(true);
  });

  it('never throws', () => {
    expect(() => resolve('', '')).not.toThrow();
  });

  it('always explains why a figure is unvalidated', () => {
    const r = resolve('navigation_local', 'not_a_real_metric');
    expect(r.unvalidatedReason).toBeTruthy();
    expect(r.unvalidatedReason).toMatch(/not_a_real_metric/);
  });

  it('shapes a missing metric exactly like a real one', () => {
    const real = resolve('navigation_local', 'cpi_usd');
    const missing = resolve('navigation_local', 'not_a_real_metric');
    expect(Object.keys(missing).sort()).toEqual(Object.keys(real).sort());
  });
});

describe('resolution order', () => {
  it('prefers the vertical own sourced figure', () => {
    const r = resolve('navigation_local', 'cpi_usd');
    expect(r.verticalId).toBe('navigation_local');
    expect(r.usedFallback).toBe(false);
    expect(r.value).not.toBeNull();
  });

  it('falls back cross-vertical for a metric the vertical does not carry', () => {
    const r = resolve('navigation_local', 'app_store_commission_standard_pct');
    expect(r.value).toBe(30);
    expect(r.usedFallback).toBe(true);
    expect(r.verticalId).toBe('_cross_vertical_default');
  });

  it('labels every fallback as an aggregate, never as vertical-specific', () => {
    const r = resolve('navigation_local', 'app_store_commission_standard_pct');
    expect(caveats(r).join(' ')).toMatch(/cross-vertical aggregate/);
  });

  it('reports when a figure was resolved under a different key', () => {
    const r = resolve('dating', 'cpi_usd');
    if (!r.unvalidated) {
      expect(r.usedAlias).toBe('cpi_range_all_verticals_usd');
      expect(caveats(r).join(' ')).toMatch(/related metric/);
    }
  });

  it('refuses to fall back for an unknown vertical', () => {
    const r = resolve('navigaton_local', 'app_store_commission_standard_pct');  
    expect(r.value).toBeNull();
    expect(r.unvalidated).toBe(true);
    expect(r.unvalidatedReason).toMatch(/Unknown vertical/);
    expect(r.usedFallback).toBe(false);
  });

  it('a placeholder in the vertical does not block a sourced aggregate', () => {
    const r = resolve('dating', 'retention_d30_pct');
    if (!r.unvalidated) expect(r.usedFallback).toBe(true);
  });
});

describe('the unvalidated path', () => {
  it('reports a placeholder as unvalidated with no value', () => {
    const r = resolve('navigation_local', 'arpu_12mo_blended_usd');
    expect(r.value).toBeNull();
    expect(r.confidence).toBe('placeholder');
    expect(r.unvalidated).toBe(true);
  });

  it('gives an unvalidated figure exactly one caveat: why', () => {
    const r = resolve('navigation_local', 'arpu_12mo_blended_usd');
    expect(caveats(r)).toHaveLength(1);
    expect(caveats(r)[0]).toMatch(/No sourced figure/);
  });

  it('isUnvalidated agrees with the resolved flag', () => {
    for (const key of ['cpi_usd', 'arpu_12mo_blended_usd', 'retention_d30_pct']) {
      const r = resolve('navigation_local', key);
      expect(isUnvalidated(r)).toBe(r.unvalidated);
    }
  });

  it('the unsourced 3:1 LTV:CAC target stays unvalidated', () => {
    const r = resolve('_cross_vertical_default', 'ltv_cac_target_ratio');
    expect(r.value).toBeNull();
    expect(r.unvalidated).toBe(true);
  });

  it('the 1.5x viability floor IS sourced, and is the one that may be cited', () => {
    const r = resolve('_cross_vertical_default', 'ltv_cac_min_threshold_ratio');
    expect(r.value).toBe(1.5);
    expect(r.unvalidated).toBe(false);
    expect(r.source.publisher).toBeTruthy();
  });
});

describe('the six warnings Day 0 recorded', () => {
  it('surfaces every metric whose sources disagree', () => {
    const conflicted = listConflicts();
    const keys = conflicted.map((c) => `${c.verticalId}.${c.metricKey}`).sort();
    expect(keys).toEqual([
      '_cross_vertical_default.b2b_logo_churn_monthly_pct',
      'fintech.retention_d30_pct',
      'social_media.retention_d30_pct',
    ]);
  });

  it('carries every conflicting value, not just the chosen one', () => {
    const r = resolve('fintech', 'retention_d30_pct');
    expect(r.conflicts?.length).toBeGreaterThan(1);
    const values = r.conflicts?.map((c) => c.value) ?? [];
    expect(Math.min(...values)).toBeLessThanOrEqual(2);
    expect(Math.max(...values)).toBeGreaterThanOrEqual(12);
  });

  it('states the disagreement in the caveats rather than presenting a consensus', () => {
    const text = caveats(resolve('fintech', 'retention_d30_pct')).join(' ');
    expect(text).toMatch(/sources disagree/i);
    expect(text).toMatch(/not a consensus/i);
  });

  it('flags the proxy metrics in the four verticals Day 0 named', () => {
    const proxied = new Set(listProxies().map((p) => p.verticalId));
    for (const v of ['navigation_local', 'food_delivery', 'b2b_saas', 'real_estate'])
      expect(proxied).toContain(v);
  });

  it('marks a proxy figure as a proxy on the resolved metric', () => {
    const r = resolve('navigation_local', 'retention_d30_pct');
    expect(r.isProxy).toBe(true);
    expect(r.value).not.toBeNull();          
    expect(r.unvalidated).toBe(false);       
    expect(caveats(r).join(' ')).toMatch(/PROXY/);   
  });

  it('the demo vertical carries proxies on both figures the economics depend on', () => {
    expect(resolve('navigation_local', 'cpi_usd').isProxy).toBe(true);
    expect(resolve('navigation_local', 'retention_d30_pct').isProxy).toBe(true);
  });
});

describe('the honesty contract, enforced at boot', () => {
  it('loaded every vertical in the taxonomy', () => {
    const verticals = listVerticals();
    expect(verticals.length).toBeGreaterThanOrEqual(16);
    expect(verticals).toContain('navigation_local');
  });

  it('no sourced metric anywhere is missing a publisher', () => {
    const offenders: string[] = [];
    for (const verticalId of [...listVerticals(), '_cross_vertical_default']) {
      const file = getVertical(verticalId);
      for (const [key, m] of Object.entries(file?.metrics ?? {})) {
        if (m.confidence !== 'placeholder' && !m.source?.publisher)
          offenders.push(`${verticalId}.${key}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no placeholder anywhere carries a value', () => {
    const offenders: string[] = [];
    for (const verticalId of [...listVerticals(), '_cross_vertical_default']) {
      const file = getVertical(verticalId);
      for (const [key, m] of Object.entries(file?.metrics ?? {})) {
        if (m.confidence === 'placeholder' && m.value !== null)
          offenders.push(`${verticalId}.${key} = ${m.value}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('resolveMany', () => {
  it('resolves a set in one call, keyed by metric', () => {
    const got = resolveMany('navigation_local', ['cpi_usd', 'arpu_12mo_blended_usd']);
    expect(Object.keys(got).sort()).toEqual(['arpu_12mo_blended_usd', 'cpi_usd']);
    expect(got.cpi_usd?.unvalidated).toBe(false);
    expect(got.arpu_12mo_blended_usd?.unvalidated).toBe(true);
  });
});
