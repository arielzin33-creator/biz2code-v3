/* The Key Figures block: every number the documents rest on, as Word tables plus the projection chart. */

import type { CalculationResult, Computed } from '../services/calculation.service';
import type { DerivationResult } from '../services/derivation.service';
import type { SectionBlock } from '../services/docx.service';
import { renderProjectionChart } from '../services/chart.service';

function format(c: Computed): string {
  if (c.unvalidated || c.value === null) return 'unvalidated';

  const { value, unit } = c;
  const n = Math.abs(value) >= 100
    ? Math.round(value).toLocaleString('en-US')
    : Number(value.toFixed(2)).toLocaleString('en-US');

  if (unit.startsWith('USD')) {
    const suffix = unit.includes('/month') ? ' / month'
      : unit.includes('/year') ? ' / year'
        : unit.includes('/user') ? ' / customer / month' : '';
    return `$${n}${suffix}`;
  }
  return `${n} ${unit}`;
}

function basis(c: Computed): string | null {
  if (c.unvalidated) return c.unvalidatedReason ?? 'No sourced figure available.';
  if (!c.caveats.length) return `Confidence: ${c.confidence}.`;
  return c.caveats.join(' ');
}

function rowBuilder() {
  const seen = new Set<string>();
  return (label: string, c: Computed) => {
    const note = basis(c);
    if (note && seen.has(note)) return { label, value: format(c), note: 'As above.' };
    if (note) seen.add(note);
    return { label, value: format(c), note };
  };
}

const money = (n: number | null) =>
  (n === null ? 'not given' : `$${Math.round(n).toLocaleString('en-US')} / month`);

export function keyFigureBlocks(
  calc: CalculationResult, d: DerivationResult,
): SectionBlock[] {
  const row = rowBuilder();
  const blocks: SectionBlock[] = [
    {
      kind: 'table',
      title: 'Market',
      explanation:
        'How large the opportunity is, derived from published sources. You were not asked to '
        + 'estimate any of these.',
      rows: [
        row('Total addressable market (TAM)', d.tam),
        row('Serviceable addressable market (SAM)', d.sam),
        row(`Obtainable market at month ${d.horizonMonths} (SOM)`, d.somPayers),
        row('Revenue if the whole market were won', d.marketCeiling),
      ],
    },
    {
      kind: 'table',
      title: 'Acquisition',
      explanation:
        'What your acquisition budget buys, at the published costs for your category. This is '
        + 'what turns a budget into a number of customers.',
      rows: [
        row(d.model === 'b2b_licence' ? 'Customers won per month' : 'Installs bought per month',
          d.installsPerMonth),
        row('Cost of one paying customer', d.costPerPayingCustomer),
        row('Expected customer lifetime', d.impliedLifetimeMonths),
      ],
    },
    {
      kind: 'table',
      title: `Revenue at month ${d.horizonMonths}`,
      explanation:
        'What those customers are worth, at the price you set. Annual recurring revenue is the '
        + 'monthly figure times twelve and is no more certain than it.',
      rows: [
        row('Paying customers', calc.payingUsers),
        row('Gross revenue', calc.grossMonthlyRevenue),
        row('App store commission', calc.storeCommission),
        row('Net revenue', calc.netMonthlyRevenue),
        row('Annual recurring revenue (ARR)', calc.annualRecurringRevenue),
        row('Revenue per paying customer', calc.arpuEffective),
      ],
    },
    {
      kind: 'table',
      title: 'Costs and profit',
      explanation:
        'What it costs to run, against what it earns. A negative profit here is the plan as '
        + 'stated, not a rounding artefact.',
      rows: [
        row('Total cost of ownership', calc.monthlyTco),
        row('Profit', calc.monthlyProfit),
      ],
    },
    {
      kind: 'table',
      title: 'Unit economics',
      explanation:
        'Whether one customer pays for themselves. LTV:CAC below the sourced viability floor of '
        + '1.5 means acquisition costs more than it returns.',
      rows: [
        row('Customer acquisition cost (CAC)', calc.cacEstimate),
        row('Lifetime value (LTV)', calc.ltvEstimate),
        row('LTV to CAC ratio', calc.ltvCacRatio),
        row('Payback period', calc.paybackPeriodMonths),
      ],
    },
    {
      kind: 'table',
      title: 'Your objectives against the evidence',
      explanation:
        'The goals you set, beside what the published figures support. These are compared, never '
        + 'averaged — the gap between them is the finding.',
      rows: [
        {
          label: 'Revenue floor you would stop below',
          value: money(d.verdicts.floor?.objective ?? null),
          note: 'Your own walk-away figure, from the revenue band you gave.',
        },
        {
          label: 'Revenue target you are aiming at',
          value: money(d.verdicts.revenue.objective),
          note: 'The top of the band you gave.',
        },
        {
          label: 'Adoption target',
          value: d.verdicts.users.objective === null ? 'not given'
            : `${Math.round(d.verdicts.users.objective).toLocaleString('en-US')} customers`,
          note: 'Judged separately from revenue: reach and monetisation fail for different reasons.',
        },
        row('Revenue the sources support', d.derivedMonthlyRevenue),
        {
          label: 'Verdict',
          value: d.verdicts.overall.headline,
          note: d.verdicts.overall.detail,
        },
      ],
    },
  ];

  const chart = renderProjectionChart(
    d.points.map((p) => ({ month: p.month, value: p.netRevenue })),
    'Projected net revenue',
    'NET REVENUE (USD)',
  );
  if (chart) {
    blocks.push({
      kind: 'image',
      png: chart.png,
      widthPt: chart.widthPt,
      heightPt: chart.heightPt,
      caption: `Net monthly revenue over ${d.points.length} months, derived from published `
        + 'benchmarks and the budget and price you gave. Not a forecast of your product — a '
        + 'projection of what those figures imply.',
    });
  }

  return blocks;
}
