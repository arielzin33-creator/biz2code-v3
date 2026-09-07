

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Confidence = 'primary' | 'secondary' | 'tertiary' | 'placeholder';

export interface MetricSource {
  publisher: string | null;
  via: string | null;
  url: string | null;
  tier: string | null;
  retrieved: string | null;
}

export interface Conflict { value: number; source: string; note: string | null }

export interface Metric {
  value: number | null;
  rangeLow: number | null;
  rangeHigh: number | null;
  unit: string;
  confidence: Confidence;
  source: MetricSource;
  note: string | null;
  conflicts: Conflict[] | null;
}

export interface Resolved extends Metric {
  metricKey: string;

  requestedVerticalId: string;

  verticalId: string;

  usedFallback: boolean;

  usedAlias: string | null;

  isProxy: boolean;

  unvalidated: boolean;
  unvalidatedReason: string | null;
}

interface BenchmarkFile {
  verticalId: string;
  displayName: string;
  sector: string | null;
  lastReviewed: string;
  metrics: Record<string, Metric>;
}

const BENCHMARK_DIR = resolvePath(
  dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'benchmarks',
);
const FALLBACK_VERTICAL = '_cross_vertical_default';


function fail(reason: string): never {
  throw new Error(`benchmarks are invalid — ${reason}`);
}


function validateMetric(where: string, m: Metric) {
  for (const field of ['value', 'unit', 'confidence', 'source'] as const) {
    if (!(field in m)) fail(`${where}: missing '${field}'`);
  }
  if (!['primary', 'secondary', 'tertiary', 'placeholder'].includes(m.confidence))
    fail(`${where}: bad confidence '${m.confidence}'`);

  if (m.confidence === 'placeholder') {
    if (m.value !== null)
      fail(`${where}: a placeholder carries a value (${m.value}) — placeholders must never invent a number`);
  } else {
    if (m.value === null) fail(`${where}: confidence '${m.confidence}' but value is null`);
    if (!m.source?.publisher) fail(`${where}: confidence '${m.confidence}' but no source.publisher`);
  }
  if (m.value !== null && m.unit === 'percent' && (m.value < 0 || m.value > 100))
    fail(`${where}: percent out of range (${m.value})`);
}

function load(): Map<string, BenchmarkFile> {
  const files = readdirSync(BENCHMARK_DIR)
    .filter((f) => f.startsWith('benchmarks.') && f.endsWith('.json') && f !== 'benchmarks.index.json');
  if (files.length === 0) fail('no benchmark files found');

  const out = new Map<string, BenchmarkFile>();
  for (const file of files) {
    const doc = JSON.parse(readFileSync(join(BENCHMARK_DIR, file), 'utf8')) as BenchmarkFile;
    if (!doc.verticalId) fail(`${file}: no verticalId`);
    if (!doc.metrics) fail(`${file}: no metrics`);
    for (const [key, metric] of Object.entries(doc.metrics)) validateMetric(`${file}::${key}`, metric);
    out.set(doc.verticalId, doc);
  }
  if (!out.has(FALLBACK_VERTICAL)) fail(`the cross-vertical fallback file is missing`);
  return out;
}

const byVertical = load();


const FALLBACK_ALIASES: Record<string, string[]> = {
  cpi_usd: ['cpi_range_all_verticals_usd'],
  cpi_ios_usd: ['cpi_ios_global_usd'],
  cpi_android_usd: ['cpi_android_global_usd'],
  retention_d1_pct: ['retention_d1_pct', 'retention_d1_good_pct'],
  retention_d7_pct: ['retention_d7_pct', 'retention_d7_good_pct'],
  retention_d30_pct: ['retention_d30_pct', 'retention_d30_median_all_pct'],
};

const isSourced = (m: Metric | undefined): m is Metric =>
  m !== undefined && m.value !== null && m.confidence !== 'placeholder';


const proxyFlag = (m: Metric) => (m.note ?? '').trimStart().toUpperCase().startsWith('PROXY');

function decorate(
  metric: Metric, metricKey: string, requestedVerticalId: string,
  fromVerticalId: string, usedAlias: string | null,
): Resolved {
  const usedFallback = fromVerticalId === FALLBACK_VERTICAL;
  const unvalidated = metric.value === null || metric.confidence === 'placeholder';
  return {
    ...metric,
    metricKey,
    requestedVerticalId,
    verticalId: fromVerticalId,
    usedFallback,
    usedAlias,
    isProxy: proxyFlag(metric),
    unvalidated,
    unvalidatedReason: unvalidated
      ? `No sourced figure for ${metricKey} in ${requestedVerticalId} or the cross-vertical aggregate.`
      : null,
  };
}


function missing(metricKey: string, requestedVerticalId: string, reason: string): Resolved {
  return {
    value: null, rangeLow: null, rangeHigh: null, unit: 'unknown',
    confidence: 'placeholder',
    source: { publisher: null, via: null, url: null, tier: 'placeholder', retrieved: null },
    note: null, conflicts: null,
    metricKey, requestedVerticalId, verticalId: requestedVerticalId,
    usedFallback: false, usedAlias: null, isProxy: false,
    unvalidated: true, unvalidatedReason: reason,
  };
}


export function resolve(verticalId: string, metricKey: string): Resolved {
  const own = byVertical.get(verticalId);

  if (!own) return missing(metricKey, verticalId, `Unknown vertical '${verticalId}'.`);

  const ownMetric = own.metrics[metricKey];
  if (isSourced(ownMetric)) return decorate(ownMetric, metricKey, verticalId, verticalId, null);

  const fallbackFile = byVertical.get(FALLBACK_VERTICAL);
  const direct = fallbackFile?.metrics[metricKey];
  if (isSourced(direct)) return decorate(direct, metricKey, verticalId, FALLBACK_VERTICAL, null);

  for (const alias of FALLBACK_ALIASES[metricKey] ?? []) {
    if (alias === metricKey) continue;              
    const aliased = fallbackFile?.metrics[alias];
    if (isSourced(aliased)) return decorate(aliased, metricKey, verticalId, FALLBACK_VERTICAL, alias);
  }

  if (ownMetric) return decorate(ownMetric, metricKey, verticalId, verticalId, null);

  return missing(metricKey, verticalId,
    `No metric '${metricKey}' in ${verticalId} or the cross-vertical aggregate.`);
}


export function resolveMany(verticalId: string, metricKeys: string[]): Record<string, Resolved> {
  return Object.fromEntries(metricKeys.map((k) => [k, resolve(verticalId, k)]));
}


export const isUnvalidated = (m: Pick<Resolved, 'value' | 'confidence'>): boolean =>
  m.value === null || m.confidence === 'placeholder';


export function caveats(m: Resolved): string[] {
  const out: string[] = [];
  if (m.unvalidated) {
    out.push(m.unvalidatedReason ?? 'No sourced figure available.');
    return out;   
  }
  if (m.usedFallback)
    out.push('This is a cross-vertical aggregate, not a figure specific to this category.');
  if (m.usedAlias)
    out.push(`Resolved from the related metric '${m.usedAlias}'.`);
  if (m.isProxy)
    out.push(m.note ?? 'Borrowed from an adjacent vertical. Treat as a proxy, not a measurement.');
  if (m.conflicts?.length) {
    const spread = m.conflicts.map((c) => `${c.value} (${c.source})`).join('; ');
    out.push(`Published sources disagree: ${spread}. The figure shown is one reported value, not a consensus.`);
  }
  return out;
}

export const getVertical = (verticalId: string): BenchmarkFile | null =>
  byVertical.get(verticalId) ?? null;

export const listVerticals = (): string[] =>
  [...byVertical.keys()].filter((v) => v !== FALLBACK_VERTICAL).sort();


export function listConflicts(): Array<{ verticalId: string; metricKey: string; conflicts: Conflict[] }> {
  const out: Array<{ verticalId: string; metricKey: string; conflicts: Conflict[] }> = [];
  for (const [verticalId, file] of byVertical) {
    for (const [metricKey, metric] of Object.entries(file.metrics)) {
      if (metric.conflicts?.length) out.push({ verticalId, metricKey, conflicts: metric.conflicts });
    }
  }
  return out;
}


export function listProxies(): Array<{ verticalId: string; metricKey: string; note: string | null }> {
  const out: Array<{ verticalId: string; metricKey: string; note: string | null }> = [];
  for (const [verticalId, file] of byVertical) {
    for (const [metricKey, metric] of Object.entries(file.metrics)) {
      if (proxyFlag(metric)) out.push({ verticalId, metricKey, note: metric.note });
    }
  }
  return out;
}
