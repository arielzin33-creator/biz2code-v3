/* One prompt template per document. Each declares its own fields and the JSON shape it must return. */

import { buildGuardrailPreamble } from '../services/llm.service';
import {
  allowedCitations, renderSharedContext, type GenerationContext,
} from './context';

export type DocType = 'mrd' | 'prd' | 'business_plan';

export interface DocField {
  path: string;
  key: string;
  heading: string;
  instruction: string;
}

export interface DocTemplate {
  docType: DocType;
  title: string;
  fileStem: string;
  fields: DocField[];
  maxTokens: number;
  build(ctx: GenerationContext): { systemPrompt: string; userPrompt: string; requiredKeys: string[] };
}

const RESPONSE_RULES = (fields: DocField[]) => `
RESPONSE FORMAT
Return ONE JSON object, nothing else. No markdown fences, no commentary.

Keys, all required, all strings unless stated:
${fields.map((f) => `  "${f.key}": ${f.instruction}`).join('\n')}
  "unvalidated_fields": array of strings — the key names above where YOU stated a
    figure that no supplied source backs. That is the only thing this list is for.

    Flag a field when: you asserted a number, rate or total that was not given to you.

    Do NOT flag a field when:
      - you correctly reported that a figure was unavailable. Saying "no sourced
        cost-per-customer exists for this category" is REPORTING a gap, not creating
        one, and the section that says it is doing its job.
      - the section is a judgement, a recommendation or a verdict that you have
        labelled as such.
      - a section you summarise contains an unvalidated figure. A summary does not
        inherit the flag; only the field that first asserted the figure carries it.

    If every figure you used came from the supplied context, return an empty array.
    The key names above whose content you
      could not fully source. Include a key here whenever you had to write around
      a missing figure. An empty array claims everything is sourced, so use it
      only when that is true.

LENGTH
Each field: 3 to 5 sentences. Substantive prose, not bullet fragments. Write for
a reader deciding whether to fund or build this — plain, specific, and free of
marketing language.`;

const ROLE = `You are a specification analyst producing a section of a formal
planning document. You write plainly and you never overstate what the evidence
supports. When the evidence is thin you say so in the prose itself rather than
omitting the point — an absent figure reads as an oversight, a marked one is
information.`;

function build(template: Omit<DocTemplate, 'build'>, extra: (ctx: GenerationContext) => string): DocTemplate {
  return {
    ...template,
    build(ctx) {
      const systemPrompt = `${ROLE}\n\n${buildGuardrailPreamble(allowedCitations(ctx))}`;
      const userPrompt = [
        `Draft the ${template.title}.`,
        '',
        renderSharedContext(ctx),
        extra(ctx),
        RESPONSE_RULES(template.fields),
      ].join('\n');
      return {
        systemPrompt,
        userPrompt,
        requiredKeys: [...template.fields.map((f) => f.key), 'unvalidated_fields'],
      };
    },
  };
}

/* ==================================================================== MRD === */

export const MRD: DocTemplate = build({
  docType: 'mrd',
  title: 'Market Requirements Document (MRD)',
  fileStem: 'MRD',
  maxTokens: 2000,          
  fields: [
    {
      path: 'mrd.market_requirements',
      key: 'market_requirements',
      heading: 'Market Requirements',
      instruction: 'the market\'s requirements restated as formal statements, each beginning "The user shall". Derive them from the target-user and problem answers.',
    },
    {
      path: 'mrd.market_validation_statistics',
      key: 'market_validation_statistics',
      heading: 'Market Validation Statistics',
      instruction: 'what the supplied benchmarks and competitor data actually establish about this market. Name the publisher for every figure. Where a benchmark is a PROXY or the sources conflict, say so in the sentence that uses it.',
    },
    {
      path: 'mrd.market_audience_sizing',
      key: 'market_audience_sizing',
      heading: 'Market and Audience Sizing',
      instruction: 'the reachable market the founder stated, set against the World Bank population data supplied. If the founder\'s figure is a large share of the national population, say so.',
    },
    {
      path: 'mrd.revenue_potential_by_segment',
      key: 'revenue_potential_by_segment',
      heading: 'Revenue Potential by Segment',
      instruction: 'revenue potential using ONLY the supplied computed figures. If the category ARPU benchmark is unvalidated, state that segment-level revenue cannot be validated and explain what that means for the reader.',
    },
    {
      path: 'mrd.segmentation_personas',
      key: 'segmentation_personas',
      heading: 'Segmentation and Personas',
      instruction: 'two or three user personas drawn from the target-user answer. These are EXTRAPOLATED from the founder\'s description, not measured — state that plainly in the text.',
    },
  ],
}, (ctx) => `
FOCUS
This document is about the market, not the product build. Ground every claim in
the answers, the benchmarks, or the competitor list above.
${ctx.external.itunes.length ? 'Use the iTunes competitor list as evidence of what already ships.' : 'No competitor data was retrieved; do not speculate about competitors.'}`);

/* ==================================================================== PRD === */

export const PRD: DocTemplate = build({
  docType: 'prd',
  title: 'Product Requirements Document (PRD)',
  fileStem: 'PRD',
  maxTokens: 2200,          
  fields: [
    {
      path: 'prd.prioritization_resource_impact.rice',
      key: 'prioritization_rice',
      heading: 'Prioritisation — RICE',
      instruction: 'a RICE assessment of the stated MVP features. Reach may use the supplied paying-customer figure. Impact and Confidence are YOUR estimates and are not sourced — say so explicitly in the text.',
    },
    {
      path: 'prd.prioritization_resource_impact.dev_cost',
      key: 'prioritization_dev_cost',
      heading: 'Prioritisation — Development Cost',
      instruction: 'development cost framed against the stated monthly spend. Do not invent person-month figures; if the answers do not support an estimate, say the cost cannot be apportioned from what was given.',
    },
    {
      path: 'prd.success_metrics_kpis.technical_health',
      key: 'success_metrics_technical_health',
      heading: 'Success Metrics — Technical Health',
      instruction: 'the technical health metrics to track, with the published Google Play thresholds supplied in the benchmarks above as the targets. Name the publisher. Where a metric has no supplied threshold, say that plainly for that metric — do not mark the whole field unvalidated because one target is absent.',
    },
    {
      path: 'prd.success_metrics_kpis.growth',
      key: 'success_metrics_growth',
      heading: 'Success Metrics — Growth',
      instruction: 'growth metrics using the supplied retention and conversion benchmarks. Carry every PROXY or conflict caveat into the sentence that uses the figure.',
    },
    {
      path: 'prd.success_metrics_kpis.ux_vitals',
      key: 'success_metrics_ux_vitals',
      heading: 'Success Metrics — UX Vitals',
      instruction: 'the UX signals worth instrumenting (rage taps, UI freezes, task completion). Name them and say what each would tell the team. Where no published target exists for a signal, say so for that signal; that is a statement about the industry, not a defect in this section.',
    },
    {
      path: 'prd.feature_roadmap',
      key: 'feature_roadmap',
      heading: 'Feature List and Roadmap',
      instruction:
        'a single consolidated feature list in three labelled groups. (1) MVP — the core features '
        + 'the founder named, one line each. (2) LATER — the features he said he could launch '
        + 'without, one line each, with what each depends on. (3) OBSERVED IN COMPARABLE APPS — '
        + 'features that the supplied App Store listings show competitors shipping which are '
        + 'absent from both of his lists. For every entry in group 3 name the app it came from; '
        + 'if the listings do not support an entry, leave it out. Do not invent a feature because '
        + 'it seems sensible, and do not repeat one already in groups 1 or 2. If no competitor '
        + 'listings were supplied, say so and give only groups 1 and 2.',
    },
    {
      path: 'prd.release_plan',
      key: 'release_plan',
      heading: 'Release Plan',
      instruction: 'a phased release plan built from the MVP and later-phase feature answers and the chosen platforms. Sequence only what the answers name.',
    },
    {
      path: 'prd.product_recommendations',
      key: 'product_recommendations',
      heading: 'Product Recommendations',
      instruction: 'recommendations following from the answers and the computed economics. Where the economics are weak, recommend accordingly rather than encouragingly.',
    },
  ],
}, () => `
FOCUS
This document is about what gets built and how success is measured. Several
fields have NO sourced targets available; naming the metric while stating that no
published target exists is the correct output for those, not silence.`);

/* ========================================================== BUSINESS PLAN === */

export const BUSINESS_PLAN: DocTemplate = build({
  docType: 'business_plan',
  title: 'Business Plan',
  fileStem: 'BusinessPlan',
  maxTokens: 2000,          
  fields: [
    {
      path: 'bp.executive_summary',
      key: 'executive_summary',
      heading: 'Executive Summary',
      instruction: 'a STAR-structured summary (Situation, Task, Action, Result). Written last, so it must reflect the economics and the weaknesses below, including the unfavourable ones.',
    },
    {
      path: 'bp.budget_cost_projections.engineering',
      key: 'budget_engineering',
      heading: 'Budget — Engineering',
      instruction: 'engineering cost from the stated monthly spend. Do not apply a technical-debt provision: the usual 30% figure is a rule of thumb with no measured source, so state that no sourced provision exists rather than applying one.',
    },
    {
      path: 'bp.budget_cost_projections.infrastructure',
      key: 'budget_infrastructure',
      heading: 'Budget — Infrastructure',
      instruction: 'how infrastructure cost sits inside the stated monthly spend. This split has no external source; state that it is an allocation, not a measurement.',
    },
    {
      path: 'bp.budget_cost_projections.app_store_fees',
      key: 'budget_app_store_fees',
      heading: 'Budget — App Store Fees',
      instruction: 'app store commission using the supplied computed figure. If the figure is zero because of the business model, explain why rather than omitting the section.',
    },
    {
      path: 'bp.budget_cost_projections.monthly_tco',
      key: 'budget_monthly_tco',
      heading: 'Budget — Monthly Total Cost of Ownership',
      instruction: 'the supplied monthly TCO figure and what it comprises. Restate the number exactly.',
    },
    {
      path: 'bp.revenue_projection.unit_economics',
      key: 'revenue_unit_economics',
      heading: 'Revenue — Unit Economics',
      instruction: 'CAC, LTV and the LTV:CAC ratio as supplied, judged against the SOURCED viability floor only. Do not cite a 3:1 target — it is a rule of thumb with no measured source.',
    },
    {
      path: 'bp.revenue_projection.extrapolation',
      key: 'revenue_extrapolation',
      heading: 'Revenue — Extrapolation',
      instruction: 'what the supplied monthly figures imply over twelve months, stated as arithmetic on the supplied numbers and nothing more. Name the assumptions the extrapolation rests on.',
    },
    {
      path: 'bp.revenue_projection.rpv',
      key: 'revenue_rpv',
      heading: 'Revenue — Revenue per User',
      instruction: 'the supplied effective ARPU and how it compares to the category benchmark. If that comparison is unavailable, say why.',
    },
    {
      path: 'bp.revenue_projection.projected_growth',
      key: 'revenue_projected_growth',
      heading: 'Revenue — Projected Growth',
      instruction: 'growth framed by the supplied retention benchmark and the supplied projection. Do not introduce a k-factor or virality assumption: none is sourced. Say that word-of-mouth growth is real but unforecastable here, and keep the section to what the projection supports.'
    },
    {
      path: 'bp.product_weaknesses',
      key: 'product_weaknesses',
      heading: 'Product Weaknesses',
      instruction: 'the genuine weaknesses, synthesised from the MRD and PRD supplied below plus the computed economics. This is the section a reader will check for candour — do not soften it, and name any figure the plan depends on that is unvalidated or a proxy.',
    },
    {
      path: 'bp.validation_verdict',
      key: 'validation_verdict',
      heading: 'Business Validation — Is This Worth Building?',
      instruction:
        'ONE paragraph answering whether this business is valid, and why. Open with the supplied '
        + 'OVERALL verdict verbatim in your own sentence — proceed, proceed on a revised objective, '
        + 'or do not proceed. Then give the reason in numbers: the derived market size, what the '
        + 'sources project by the horizon, and how that sits against the revenue band and the '
        + 'adoption goal the founder set. If the objective exceeds the market ceiling, say so '
        + 'explicitly and say that no forecast was needed to establish it. Address the founder '
        + 'directly and do not soften the finding — a reader acting on this will spend money. '
        + 'Every figure you use is supplied above; cite none that is not.',
    },
    {
      path: 'bp.final_summary_outcome',
      key: 'final_summary_outcome',
      heading: 'Final Summary and Outcome',
      instruction:
        'what happens next, following from the verdict above. Name the specific levers supplied '
        + 'under "WHAT WOULD HAVE TO BE TRUE" and what each would require, stated as arithmetic '
        + 'rather than as a recommendation to assume it. Where a figure the plan depends on is '
        + 'unvalidated or a proxy, name it here so the reader knows which number to go and get.',
    },
  ],
}, (ctx) => {
  if (!ctx.priorDocuments) {
    return `
FOCUS
The MRD and PRD were NOT available when this section was drafted. Say so plainly in
"product_weaknesses" — the section is thinner for it, which the reader should know.
Do NOT mark the field unvalidated: that marker is reserved for a figure with no
source, not for a section written with less context than intended.`;
  }
  const digest = (doc: Record<string, unknown>, limit: number) =>
    Object.entries(doc)
      .filter(([k]) => k !== 'unvalidated_fields')
      .map(([k, v]) => `${k}: ${String(v).slice(0, limit)}`)
      .join('\n');

  const flagged = (doc: Record<string, unknown>) =>
    Array.isArray(doc.unvalidated_fields) && doc.unvalidated_fields.length
      ? `Fields it could not fully source: ${(doc.unvalidated_fields as unknown[]).join(', ')}`
      : 'It reported every field as sourced.';

  return `
PREVIOUSLY GENERATED — the basis for "product_weaknesses"

MRD:
${digest(ctx.priorDocuments.mrd, 260)}
${flagged(ctx.priorDocuments.mrd)}

PRD:
${digest(ctx.priorDocuments.prd, 260)}
${flagged(ctx.priorDocuments.prd)}

FOCUS
This is the document a reader will judge the whole exercise by. Where the
economics are unfavourable, say so directly. A plan that reads as advocacy is
worth less than one that reads as assessment.`;
});

export const TEMPLATES: Record<DocType, DocTemplate> = {
  mrd: MRD,
  prd: PRD,
  business_plan: BUSINESS_PLAN,
};

export const GENERATION_ORDER: DocType[] = ['mrd', 'prd', 'business_plan'];
