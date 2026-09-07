

import { describe, it, expect } from 'vitest';
import { competitorSearchTerms, MAX_TERMS } from './competitorTerms';

describe('competitorSearchTerms', () => {
  it('pulls the product names out of a sentence with parenthetical asides', () => {
    expect(competitorSearchTerms(
      'Google Maps (indoor coverage is partial and venue-dependent), Waze (outdoor only), ' +
      'and individual mall-operator apps (one app per venue, low install rates).',
    )).toEqual(['Google Maps', 'Waze']);
  });

  it('splits on commas, "and", and "or"', () => {
    expect(competitorSearchTerms('Duolingo, Babbel and Memrise')).toEqual(['Duolingo', 'Babbel', 'Memrise']);
    expect(competitorSearchTerms('Notion or Obsidian')).toEqual(['Notion', 'Obsidian']);
  });

  it('treats "nothing" as naming no competitor, not as a product', () => {
    for (const answer of ['Nothing', 'nothing', 'None', 'N/A']) {
      expect(competitorSearchTerms(answer)).toEqual([]);
    }
  });

  it('returns nothing for an unanswered question', () => {
    expect(competitorSearchTerms(null)).toEqual([]);
    expect(competitorSearchTerms(undefined)).toEqual([]);
    expect(competitorSearchTerms('   ')).toEqual([]);
  });

  it('drops descriptions rather than searching the App Store for them', () => {
    expect(competitorSearchTerms('individual mall-operator apps')).toEqual([]);
    expect(competitorSearchTerms('Waze, various other navigation apps')).toEqual(['Waze']);
  });

  it('drops a fragment long enough to be a sentence', () => {
    const sentence = 'people mostly just wander around the shopping centre until they find it';
    expect(competitorSearchTerms(sentence)).toEqual([]);
  });

  it('deduplicates, case-insensitively', () => {
    expect(competitorSearchTerms('Waze, waze, WAZE')).toEqual(['Waze']);
  });

  it('never returns more than three, however many are listed', () => {
    const many = 'Alpha, Beta, Gamma, Delta, Epsilon';
    expect(competitorSearchTerms(many)).toHaveLength(MAX_TERMS);
    expect(competitorSearchTerms(many)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('strips trailing punctuation, so the cache key is stable', () => {
    expect(competitorSearchTerms('Waze.')).toEqual(['Waze']);
    expect(competitorSearchTerms('Waze?')).toEqual(['Waze']);
  });

  it('is deterministic — the same answer always yields the same keys', () => {
    const answer = 'Google Maps (partial), Waze (outdoor only)';
    expect(competitorSearchTerms(answer)).toEqual(competitorSearchTerms(answer));
  });
});
