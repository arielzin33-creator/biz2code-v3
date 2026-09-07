/* Assembles the permitted context for a generation call, and the allow-list of citable sources. */

import type { CalculationResult, Computed, Comparison } from '../services/calculation.service';
import type { Resolved } from '../services/benchmark.service';
import { caveats as benchmarkCaveats } from '../services/benchmark.service';
import { getQuestion, getPhases } from '../services/questionBank.service';
import type { AnswerRow } from '../services/answer.service';
import type { WorldBankResult, ItunesApp } from '../services/external.service';
import type { DerivationResult } from '../services/derivation.service';

export interface ExternalContext {
  worldBank: WorldBankResult[];
  itunes: ItunesApp[];
  country: { iso2: string; iso3: string; name: string } | null;
  statedCountry: string | null;
}

export interface GenerationContext {
  project: { name: string; verticalId: string | null; businessModel: string | null };
  answers: AnswerRow[];
  calculations: CalculationResult;
  derivation: DerivationResult;
  external: ExternalContext;
  priorDocuments?: { mrd: Record<string, unknown>; prd: Record<string, unknown> };
}

/* ------------------------------------------------------------- rendering --- */

const readAnswer = (a: AnswerRow): string => {
  if (a.value_json) return Array.isArray(a.value_json) ? a.value_json.join(', ') : String(a.value_json);
  if (a.value_number !== null) return String(a.value_number);
  return a.value_text ?? '(no answer)';
};

export function renderAnswers(answers: AnswerRow[]): string {
  const phases = getPhases();
  const out: string[] = [];
  for (const phase of phases) {
    const inPhase = answers.filter((a) => a.phase_no === phase.order);
    if (!inPhase.length) continue;
    out.push(`\nPHASE ${phase.order} — ${phase.name}`);
    for (const a of inPhase) {
      let question = a.question_id;
      try { question = getQuestion(a.question_id).text; } catch {  }
      out.push(`  Q: ${question}\n  A: ${readAnswer(a)}`);
    }
  }
  return out.join('\n');
}

function renderComputed(name: string, c: Computed, seen: Map<string, number>): string {
  if (c.unvalidated || c.value === null)
    return `  ${name}: UNVALIDATED — ${c.unvalidatedReason ?? 'no value available'}`;

  const rounded = Math.abs(c.value) >= 100 ? Math.round(c.value).toLocaleString('en-US')
                                           : Number(c.value.toFixed(4)).toString();
  const lines = [`  ${name}: ${rounded} ${c.unit} [confidence: ${c.confidence}]`];
  for (const caveat of c.caveats) {
    const already = seen.get(caveat);
    if (already === undefined) {
      const n = seen.size + 1;
      seen.set(caveat, n);
      lines.push(`      caveat ${n}: ${caveat}`);
    } else {
      lines.push(`      caveat ${already} also applies`);
    }
  }
  return lines.join('\n');
}

function renderComparison(name: string, c: Comparison): string {
  return c.unvalidated
    ? `  ${name}: UNAVAILABLE — ${c.detail}`
    : `  ${name}: ${c.verdict.toUpperCase()} — ${c.detail}`;
}

export function renderCalculations(calc: CalculationResult): string {
  const seen = new Map<string, number>();
  const fig = (n: string, c: Computed) => renderComputed(n, c, seen);
  return [
    'COMPUTED FIGURES — already calculated. Restate them exactly. Do not recompute, round or convert.',
    fig('Paying customers per month', calc.payingUsers),
    fig('Gross monthly revenue', calc.grossMonthlyRevenue),
    fig('App store commission', calc.storeCommission),
    fig('Net monthly revenue', calc.netMonthlyRevenue),
    fig('Annual recurring revenue (ARR)', calc.annualRecurringRevenue),
    fig('Monthly total cost of ownership', calc.monthlyTco),
    fig('Monthly profit', calc.monthlyProfit),
    fig('Effective ARPU', calc.arpuEffective),
    fig('Customer acquisition cost (CAC)', calc.cacEstimate),
    fig('Expected customer lifetime (the founder answered this)', calc.expectedLifetimeMonths),
    fig('Customer lifetime implied by published retention', calc.benchmarkImpliedLifetimeMonths),
    fig('Lifetime value (LTV)', calc.ltvEstimate),
    fig('LTV:CAC ratio', calc.ltvCacRatio),
    fig('Payback period', calc.paybackPeriodMonths),
    '',
    'COMPARISONS AGAINST PUBLISHED FIGURES',
    renderComparison('Effective ARPU vs category benchmark', calc.comparisons.arpu),
    renderComparison('LTV:CAC vs sourced viability floor', calc.comparisons.ltvCac),
    renderComparison('Assumed lifetime vs published retention', calc.comparisons.lifetime),
  ].join('\n');
}

export function renderBenchmarks(used: Record<string, Resolved>): string {
  const lines = ['BENCHMARKS CONSULTED'];
  for (const [key, m] of Object.entries(used)) {
    if (m.unvalidated || m.value === null) {
      lines.push(`  ${key}: NO SOURCED FIGURE — ${m.unvalidatedReason ?? 'not available'}`);
      continue;
    }
    const range = m.rangeLow !== null && m.rangeHigh !== null ? ` (range ${m.rangeLow}–${m.rangeHigh})` : '';
    lines.push(`  ${key}: ${m.value} ${m.unit}${range} [${m.confidence}] — ${m.source.publisher ?? 'unattributed'}`);
    for (const c of benchmarkCaveats(m)) lines.push(`      caveat: ${c}`);
  }
  return lines.join('\n');
}

export function renderExternal(ext: ExternalContext): string {
  const lines = ['EXTERNAL DATA'];

  if (ext.country) {
    lines.push(`  Market: ${ext.country.name} — the market named in the answers. The figures below are for it.`);
  } else if (ext.statedCountry) {
    lines.push(`  Market: "${ext.statedCountry}" could not be matched to a country in the World Bank's list, ` +
               `so the figures below are WORLD aggregates. Say so wherever you use one; do not present them as ${ext.statedCountry}'s.`);
  } else {
    lines.push('  Market: not answered, so the figures below are WORLD aggregates. ' +
               'Say so wherever you use one.');
  }

  if (ext.worldBank.length) {
    for (const w of ext.worldBank)
      lines.push(`  World Bank — ${w.indicatorName ?? w.indicator} for ${w.country}: ${w.value ?? 'no value'} (${w.year ?? 'no year'})`);
  } else {
    lines.push('  World Bank: no data retrieved. Any population or connectivity figure is unvalidated.');
  }

  if (ext.itunes.length) {
    lines.push('  Apple iTunes Search — comparable apps already shipping:');
    for (const a of ext.itunes.slice(0, 5)) {
      lines.push(`      "${a.trackName}" by ${a.artistName} — ${a.formattedPrice ?? 'price unknown'}, ` +
                 `rating ${a.averageUserRating ?? 'none'} from ${a.userRatingCount ?? 0} ratings, ${a.primaryGenreName}`);
      if (a.description)
        lines.push(`        listing says: ${a.description.replace(/\s+/g, ' ').trim().slice(0, 260)}`);
    }
  } else {
    lines.push('  iTunes: no competitor data retrieved. Any claim about competitors is unvalidated.');
  }
  return lines.join('\n');
}

export function renderDerivation(d: DerivationResult): string {
  const fig = (name: string, c: Computed) => (c.unvalidated || c.value === null
    ? `  ${name}: UNVALIDATED — ${c.unvalidatedReason ?? 'no value available'}`
    : [`  ${name}: ${Math.round(c.value).toLocaleString('en-US')} ${c.unit}`,
      ...c.caveats.map((x) => `      caveat: ${x}`)].join('\n'));

  const acquisition = d.model === 'b2b_licence'
    ? 'cost per business customer won' : 'cost-per-install';
  const lines = [
    'THE MARKET, DERIVED FROM PUBLISHED SOURCES',
    `  How the obtainable market was derived: the answered acquisition budget divided by the `
    + `category ${acquisition}, converted at the category conversion rate, with cohorts decaying `
    + 'at the category churn rate. It is not a share of the market the founder claimed — he was '
    + 'not asked for one.',
    `  Model: ${d.model === 'b2b_licence'
      ? 'sold to businesses — the market is premises, not people'
      : 'sold to consumers — the market is people'}`,
    fig('Total addressable market (TAM)', d.tam),
    fig('Serviceable addressable market (SAM)', d.sam),
    fig('Obtainable market at the horizon (SOM)', d.somPayers),
    fig('Revenue the whole market could yield (ceiling)', d.marketCeiling),
    fig(`Projected net revenue at month ${d.horizonMonths}`, d.derivedMonthlyRevenue),
  ];

  if (d.marketBound)
    lines.push('  NOTE: the budget would buy more customers than the market contains. '
      + 'The market is the binding constraint, not the money.');

  if (d.points.length) {
    const first = d.points[0]!;
    const last = d.points[d.points.length - 1]!;
    lines.push('', `PROJECTION SHAPE (${d.points.length} months; the full month-by-month table is `
      + 'rendered into the document separately — do not reproduce it)',
    `  month 1: ${Math.round(first.payers).toLocaleString('en-US')} paying customers, `
      + `${Math.round(first.netRevenue).toLocaleString('en-US')} USD net`,
    `  month ${last.month}: ${Math.round(last.payers).toLocaleString('en-US')} paying customers, `
      + `${Math.round(last.netRevenue).toLocaleString('en-US')} USD net`);
  }

  lines.push('', 'THE VERDICT — the founder\'s objectives against the derived figures');
  lines.push(`  OVERALL: ${d.verdicts.overall.headline}`);
  lines.push(`  ${d.verdicts.overall.detail}`);
  lines.push(`  Revenue objective: ${d.verdicts.revenue.detail}`);
  lines.push(`  Adoption objective: ${d.verdicts.users.detail}`);
  if (d.verdicts.floor) lines.push(`  Walk-away floor: ${d.verdicts.floor.detail}`);

  if (d.levers.length) {
    lines.push('', 'WHAT WOULD HAVE TO BE TRUE for the objective to hold');
    lines.push('  (state these as arithmetic, never as advice to assume them)');
    for (const l of d.levers) lines.push(`  ${l.name}: ${l.detail}`);
  }
  return lines.join('\n');
}

/* ---------------------------------------------------------- the allow-list --- */

export function allowedCitations(ctx: GenerationContext): string[] {
  const out = new Set<string>();
  out.add("The founder's own answers, as given in this document's ANSWERS section");
  out.add('The pre-computed figures in this document\'s COMPUTED FIGURES section');

  for (const m of Object.values(ctx.calculations.benchmarksUsed)) {
    if (m.unvalidated || m.value === null || !m.source.publisher) continue;
    out.add(`${m.source.publisher}${m.source.url ? ` — ${m.source.url}` : ''}`);
  }
  if (ctx.external.worldBank.length) out.add('World Bank World Development Indicators API');
  if (!ctx.derivation.tam.unvalidated && ctx.derivation.tam.unit === 'venues') {
    out.add('OpenStreetMap via the Overpass API — https://overpass-api.de');
    out.add('Wikidata — https://query.wikidata.org');
  }
  if (ctx.external.itunes.length) out.add('Apple iTunes Search API');

  return [...out];
}

export function renderSharedContext(ctx: GenerationContext): string {
  return [
    `PROJECT: ${ctx.project.name}`,
    `CATEGORY: ${ctx.project.verticalId ?? 'not specified'}`,
    `BUSINESS MODEL: ${ctx.project.businessModel ?? 'not specified'}`,
    '',
    'ANSWERS',
    renderAnswers(ctx.answers),
    '',
    renderCalculations(ctx.calculations),
    '',
    renderBenchmarks(ctx.calculations.benchmarksUsed),
    '',
    renderDerivation(ctx.derivation),
    '',
    renderExternal(ctx.external),
  ].join('\n');
}
