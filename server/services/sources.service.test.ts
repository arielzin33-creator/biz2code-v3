/* Tests the eight Tier-2 source parsers against fixture payloads. */

import { describe, it, expect } from 'vitest';
import {
  parseCountryFacts, parseEurostat, parseOecd, parseUnsd,
  parseWikidata, parseCkan, parseOxr, parseCrossref, parseGoogleBooks,
  SOURCES, citationFor,
} from './sources.service';

/* ================================================================ registry === */

describe('the source registry', () => {
  it('gives every source a publisher and a resolvable url', () => {
    for (const [id, meta] of Object.entries(SOURCES)) {
      expect(meta.id, `${id} id mismatch`).toBe(id);
      expect(meta.publisher.length).toBeGreaterThan(0);
      expect(meta.url).toMatch(/^https:\/\//);
      expect(meta.describes.length).toBeGreaterThan(0);
    }
  });

  it('marks exactly the two sources that need a key', () => {
    const keyed = Object.values(SOURCES).filter((s) => s.requiresKey).map((s) => s.id).sort();
    expect(keyed).toEqual(['openexchangerates', 'restcountries']);
  });

  it('formats a citation as publisher then url', () => {
    expect(citationFor('crossref')).toBe('Crossref — https://api.crossref.org');
  });
});

/* ========================================================= REST Countries === */

describe('parseCountryFacts', () => {
  const israel = [{
    name: { common: 'Israel' },
    cca2: 'IL', cca3: 'ISR', ccn3: '376',
    population: 9506000,
    region: 'Asia', subregion: 'Western Asia',
    currencies: { ILS: { name: 'Israeli new shekel', symbol: '₪' } },
  }];

  it('reads the identity, the population and the currency', () => {
    const c = parseCountryFacts(israel)!;
    expect(c).toMatchObject({
      name: 'Israel', iso2: 'IL', iso3: 'ISR', m49: '376',
      population: 9506000, currencyCode: 'ILS', currencyName: 'Israeli new shekel',
    });
  });

  it('keeps the M49 code, which the UN SDG API needs and ISO codes cannot supply', () => {
    expect(parseCountryFacts(israel)!.m49).toBe('376');
  });

  it('returns null for an empty or malformed response', () => {
    expect(parseCountryFacts([])).toBeNull();
    expect(parseCountryFacts({})).toBeNull();
    expect(parseCountryFacts([{ population: 5 }])).toBeNull();   
  });

  it('survives a country with no currency block', () => {
    const c = parseCountryFacts([{ cca2: 'AQ', cca3: 'ATA', name: { common: 'Antarctica' } }])!;
    expect(c.currencyCode).toBeNull();
    expect(c.population).toBeNull();
  });
});

/* ================================================================ Eurostat === */

describe('parseEurostat', () => {
  const jsonStat = {
    label: 'Individuals using the internet',
    value: { 0: 88.1, 1: 91.4 },
    dimension: { time: { category: { index: { 2023: 0, 2024: 1 } } } },
  };

  it('takes the most recent observation, not the first', () => {
    expect(parseEurostat(jsonStat)).toEqual({
      value: 91.4, period: '2024', label: 'Individuals using the internet',
    });
  });

  it('handles a time index given as an array', () => {
    const r = parseEurostat({
      value: { 0: 1, 1: 2 },
      dimension: { time: { category: { index: ['2019', '2020'] } } },
    })!;
    expect(r.period).toBe('2020');
  });

  it('skips non-numeric holes rather than reporting them as zero', () => {
    const r = parseEurostat({ value: { 0: 5, 1: null, 2: 7 } })!;
    expect(r.value).toBe(7);
  });

  it('returns null when the dataset carries no values', () => {
    expect(parseEurostat({ value: {} })).toBeNull();
    expect(parseEurostat({})).toBeNull();
  });
});

/* ==================================================================== OECD === */

describe('parseOecd', () => {
  const sdmx = {
    data: {
      dataSets: [{ series: { '0:0:0': { observations: { 0: [3.2], 1: [3.9] } } } }],
      structure: {
        name: 'Quarterly national accounts',
        dimensions: { observation: [{ id: 'TIME_PERIOD', values: [{ id: '2025-Q4' }, { id: '2026-Q1' }] }] },
      },
    },
  };

  it('reads the latest observation and its period', () => {
    expect(parseOecd(sdmx)).toEqual({
      value: 3.9, period: '2026-Q1', label: 'Quarterly national accounts',
    });
  });

  it('accepts the un-nested envelope some dataflows return', () => {
    const flat = { dataSets: sdmx.data.dataSets, structure: sdmx.data.structure };
    expect(parseOecd(flat)!.value).toBe(3.9);
  });

  it('returns null when there are no series or no observations', () => {
    expect(parseOecd({ data: { dataSets: [{ series: {} }] } })).toBeNull();
    expect(parseOecd({ data: { dataSets: [{ series: { '0:0': { observations: {} } } }] } })).toBeNull();
    expect(parseOecd({})).toBeNull();
  });
});

/* ==================================================================== UNSD === */

describe('parseUnsd', () => {
  it('takes the latest period even when the API returns them unsorted', () => {
    const r = parseUnsd({
      data: [
        { value: '55.1', timePeriodStart: 2020, seriesDescription: 'Internet use' },
        { value: '78.4', timePeriodStart: 2024, seriesDescription: 'Internet use' },
        { value: '61.0', timePeriodStart: 2022, seriesDescription: 'Internet use' },
      ],
    })!;
    expect(r).toEqual({ value: 78.4, period: '2024', label: 'Internet use' });
  });

  it('drops null and non-numeric rows instead of coercing them', () => {
    const r = parseUnsd({
      data: [
        { value: '12', timePeriodStart: 2021 },
        { value: null, timePeriodStart: 2024 },
        { value: 'N/A', timePeriodStart: 2025 },
      ],
    })!;
    expect(r.value).toBe(12);
  });

  it('returns null when nothing usable came back', () => {
    expect(parseUnsd({ data: [] })).toBeNull();
    expect(parseUnsd({})).toBeNull();
  });
});

/* ================================================================ Wikidata === */

describe('parseWikidata', () => {
  it('reads the QID out of the entity uri', () => {
    const r = parseWikidata({
      results: {
        bindings: [{
          item: { value: 'http://www.wikidata.org/entity/Q219541' },
          itemLabel: { value: 'Waze' },
          itemDescription: { value: 'satellite navigation software' },
        }],
      },
    })!;
    expect(r).toEqual([{ qid: 'Q219541', label: 'Waze', description: 'satellite navigation software' }]);
  });

  it('tolerates a binding with no description', () => {
    const r = parseWikidata({
      results: { bindings: [{ item: { value: 'http://www.wikidata.org/entity/Q1' }, itemLabel: { value: 'X' } }] },
    })!;
    expect(r[0]!.description).toBeNull();
  });

  it('returns null for no matches rather than an empty list', () => {
    expect(parseWikidata({ results: { bindings: [] } })).toBeNull();
    expect(parseWikidata({})).toBeNull();
  });
});

/* ============================================================= data.gov.il === */

describe('parseCkan', () => {
  const ckan = {
    result: {
      results: [{
        name: 'shopping-centers',
        title: 'מרכזי קניות',
        notes: 'A list of retail centres.',
        organization: { title: 'Ministry of Economy' },
      }],
    },
  };

  it('builds a resolvable dataset url from the slug', () => {
    expect(parseCkan(ckan)![0]).toEqual({
      title: 'מרכזי קניות',
      notes: 'A list of retail centres.',
      organization: 'Ministry of Economy',
      url: 'https://data.gov.il/dataset/shopping-centers',
    });
  });

  it('truncates a long description rather than carrying it into a prompt whole', () => {
    const long = { result: { results: [{ name: 'x', title: 't', notes: 'y'.repeat(900) }] } };
    expect(parseCkan(long)![0]!.notes!.length).toBe(400);
  });

  it('returns null when the catalogue has no match', () => {
    expect(parseCkan({ result: { results: [] } })).toBeNull();
    expect(parseCkan({})).toBeNull();
  });
});

/* ==================================================== Open Exchange Rates === */

describe('parseOxr', () => {
  it('picks out the requested quote currency and dates it', () => {
    const r = parseOxr('ILS')({ base: 'USD', timestamp: 1755000000, rates: { ILS: 3.71 } })!;
    expect(r).toMatchObject({ base: 'USD', quote: 'ILS', rate: 3.71 });
    expect(r.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns null when the requested currency is absent', () => {
    expect(parseOxr('ILS')({ base: 'USD', rates: { EUR: 0.9 } })).toBeNull();
    expect(parseOxr('ILS')({})).toBeNull();
  });
});

/* ================================================== Crossref & Google Books === */

describe('parseCrossref', () => {
  it('flattens the title array and joins at most three authors', () => {
    const r = parseCrossref({
      message: {
        items: [{
          title: ['Indoor positioning: a survey'],
          author: [
            { given: 'A', family: 'One' }, { given: 'B', family: 'Two' },
            { given: 'C', family: 'Three' }, { given: 'D', family: 'Four' },
          ],
          issued: { 'date-parts': [[2023, 4]] },
          DOI: '10.1000/xyz',
        }],
      },
    })!;
    expect(r[0]).toEqual({
      title: 'Indoor positioning: a survey',
      authors: 'A One, B Two, C Three',
      year: 2023,
      reference: 'https://doi.org/10.1000/xyz',
      via: 'Crossref',
    });
  });

  it('returns null on no results', () => {
    expect(parseCrossref({ message: { items: [] } })).toBeNull();
    expect(parseCrossref({})).toBeNull();
  });
});

describe('parseGoogleBooks', () => {
  it('reads the year out of a partial published date', () => {
    const r = parseGoogleBooks({
      items: [{
        volumeInfo: {
          title: 'Wayfinding', authors: ['R Passini'],
          publishedDate: '1992-06', infoLink: 'https://books.google.com/x',
        },
      }],
    })!;
    expect(r[0]).toEqual({
      title: 'Wayfinding', authors: 'R Passini', year: 1992,
      reference: 'https://books.google.com/x', via: 'Google Books',
    });
  });

  it('leaves the year null when the date is unparseable', () => {
    const r = parseGoogleBooks({ items: [{ volumeInfo: { title: 'X', publishedDate: 'n.d.' } }] })!;
    expect(r[0]!.year).toBeNull();
  });

  it('returns null on no results', () => {
    expect(parseGoogleBooks({ items: [] })).toBeNull();
    expect(parseGoogleBooks({})).toBeNull();
  });
});
