/* Fails if a document's prompt plus its requested output exceeds the provider's per-minute token ceiling. */

import { describe, it, expect } from 'vitest';
import { MRD, PRD, BUSINESS_PLAN } from './documents';
import type { GenerationContext } from './context';
import { calculate } from '../services/calculation.service';
import { derive } from '../services/derivation.service';

const CEILING = 8000;

const MIN_HEADROOM = 100;

const cost = (systemPrompt: string, userPrompt: string, maxTokens: number) =>
  Math.ceil((systemPrompt.length + userPrompt.length) / 4) + maxTokens;

function realisticContext(): GenerationContext {
  const derivation = derive({
    verticalId: 'navigation_local',
    countryName: 'Israel',
    population: 9_756_000,
    populationYear: 2024,
    internetPct: 91.6,
    segments: [{
      label: 'People living in cities',
      kind: 'percent_of_population',
      indicator: 'SP.URB.TOTL.IN.ZS',
      value: 92.6,
      year: 2024,
    }],
    platformSharePct: null,
    platformShareSource: null,
    pricePerMonth: 450,
    acquisitionBudget: 1500,
    horizonMonths: 24,          
    businessModel: 'Sold to businesses (B2B licence)',
    venues: {
      low: 57, lowSource: 'Wikidata, notable shopping centres',
      high: 434, highSource: 'OpenStreetMap, shop=mall OR shop=department_store',
    },
    objectiveRevenue: 270_000,
    objectiveFloor: 8_000,
    objectiveUsers: 150,
  });

  const calculations = calculate({
    verticalId: 'navigation_local',
    businessModel: 'Sold to businesses (B2B licence)',
    pricePerMonth: 450,
    monthlyOpex: 6500,
    reachableMarket: null,
    conversionPct: null,
    expectedLifetimeMonths: null,
    derivedPayers: derivation.somPayers,
    derivedLifetimeMonths: derivation.impliedLifetimeMonths,
    derivedCac: derivation.costPerPayingCustomer,
  });

  const answers = Array.from({ length: 23 }, (_, i) => ({
    question_id: `q${i}`,
    phase_no: (i % 4) + 1,
    value_text: 'A representative answer of about the length a founder actually writes here.',
    value_number: null,
    value_json: null,
    answered_at: '2026-08-24T00:00:00.000Z',
  })) as GenerationContext['answers'];

  return {
    project: {
      name: 'IndoorWay',
      verticalId: 'navigation_local',
      businessModel: 'Sold to businesses (B2B licence)',
    },
    answers,
    calculations,
    derivation,
    external: {
      worldBank: [],
      itunes: [],
      country: { iso2: 'IL', iso3: 'ISR', name: 'Israel' },
      statedCountry: 'Israel',
    },
  };
}

describe('every document fits the provider token budget', () => {
  const ctx = realisticContext();

  for (const template of [MRD, PRD, BUSINESS_PLAN]) {
    it(`${template.docType} stays under ${CEILING} tokens`, () => {
      const { systemPrompt, userPrompt } = template.build(ctx);
      const total = cost(systemPrompt, userPrompt, template.maxTokens);
      expect(
        total,
        `${template.docType}: ${total} tokens against a ${CEILING} ceiling. `
        + 'Trim the prompt or lower max_tokens — over this, Groq returns 413 before generating '
        + 'anything and the whole set silently falls back to Gemini. See ADR-016.',
      ).toBeLessThanOrEqual(CEILING - MIN_HEADROOM);
    });
  }

  it('business_plan still fits once the prior documents are attached', () => {
    const withPrior: GenerationContext = {
      ...ctx,
      priorDocuments: {
        mrd: { summary: 'x'.repeat(1400) },
        prd: { summary: 'y'.repeat(1400) },
      },
    };
    const { systemPrompt, userPrompt } = BUSINESS_PLAN.build(withPrior);
    expect(cost(systemPrompt, userPrompt, BUSINESS_PLAN.maxTokens))
      .toBeLessThanOrEqual(CEILING);
  });
});
