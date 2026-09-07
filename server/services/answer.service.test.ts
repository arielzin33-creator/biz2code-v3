/* Tests the value-typing rules that stand between a user's answer and the calculation layer. */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../db/query', () => import('../test/fakeDb'));

import { toColumns } from './answer.service';
import { getQuestion, getQuestionsForPhase } from './questionBank.service';

const firstOfType = (type: string) => {
  for (let phase = 1; phase <= 4; phase += 1) {
    const found = getQuestionsForPhase(phase).find((q) => q.type === type);
    if (found) return found;
  }
  throw new Error(`the bank has no ${type} question — this test needs re-pointing`);
};

const TEXT = firstOfType('text');
const SELECT = firstOfType('select');
const MULTI = firstOfType('multiselect');
const NUMBER = firstOfType('number');

const columnsUsed = (c: { valueText: unknown; valueNumber: unknown; valueJson: unknown }) =>
  Object.entries(c).filter(([, v]) => v !== null).map(([k]) => k);

describe('text answers', () => {
  it('stores trimmed text', () => {
    expect(toColumns(TEXT, '  an idea  ').valueText).toBe('an idea');
  });

  it('refuses a blank answer', () => {
    expect(() => toColumns(TEXT, '   ')).toThrow(/cannot be blank/);
  });

  it('refuses a number where text belongs', () => {
    expect(() => toColumns(TEXT, 42 as never)).toThrow(/expects text/);
  });

  it('uses only the text column', () => {
    expect(columnsUsed(toColumns(TEXT, 'an idea'))).toEqual(['valueText']);
  });
});

describe('select answers', () => {
  it('accepts an option from the bank', () => {
    const option = SELECT.options?.[0] as string;
    expect(toColumns(SELECT, option).valueText).toBe(option);
  });

  it('refuses anything not on the list', () => {
    expect(() => toColumns(SELECT, 'something invented')).toThrow(/is not an option/);
  });

  it('is case-sensitive, because the value is used as a key downstream', () => {
    const option = SELECT.options?.[0] as string;
    expect(() => toColumns(SELECT, option.toUpperCase())).toThrow(/is not an option/);
  });
});

describe('multiselect answers', () => {
  it('stores the selection as JSON', () => {
    const [first] = MULTI.options ?? [];
    const cols = toColumns(MULTI, [first as string]);
    expect(cols.valueJson).toBe(JSON.stringify([first]));
    expect(columnsUsed(cols)).toEqual(['valueJson']);
  });

  it('deduplicates — the same option twice is a client bug, not a new answer', () => {
    const [first] = MULTI.options ?? [];
    expect(toColumns(MULTI, [first as string, first as string]).valueJson)
      .toBe(JSON.stringify([first]));
  });

  it('refuses an empty selection', () => {
    expect(() => toColumns(MULTI, [])).toThrow(/at least one option/);
  });

  it('names every value that is not an option', () => {
    const [first] = MULTI.options ?? [];
    expect(() => toColumns(MULTI, [first as string, 'nope', 'also nope']))
      .toThrow(/nope, also nope/);
  });

  it('refuses a bare string where a list belongs', () => {
    expect(() => toColumns(MULTI, MULTI.options?.[0] as string)).toThrow(/expects a list/);
  });
});

describe('number answers', () => {
  it('accepts a number inside the declared range', () => {
    const { min, max } = NUMBER.numeric!;
    const value = Math.min(max, Math.max(min, 1000));
    expect(toColumns(NUMBER, value).valueNumber).toBe(value);
  });

  it('accepts a numeric string, because a form field sends one', () => {
    const { min } = NUMBER.numeric!;
    expect(toColumns(NUMBER, String(min)).valueNumber).toBe(min);
  });

  it('refuses a non-numeric string', () => {
    expect(() => toColumns(NUMBER, 'about 50k')).toThrow(/expects a number/);
  });

  it('refuses values outside the range the bank declares', () => {
    const { min, max } = NUMBER.numeric!;
    expect(() => toColumns(NUMBER, min - 1)).toThrow(/must be between/);
    expect(() => toColumns(NUMBER, max + 1)).toThrow(/must be between/);
  });

  it('refuses NaN and Infinity', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(() => toColumns(NUMBER, bad)).toThrow(/expects a number/);
    }
  });

  it('refuses a boolean, which Number() would otherwise coerce to 0 or 1', () => {
    expect(() => toColumns(NUMBER, true as never)).toThrow(/expects a number/);
  });

  it('refuses an array', () => {
    expect(() => toColumns(NUMBER, [1] as never)).toThrow(/expects a number/);
  });
});

describe('the bank is the authority', () => {
  it('rejects an unknown question id before any value is considered', () => {
    expect(() => getQuestion('p9q9')).toThrow(/Unknown question/);
  });

  it('every question in the bank can be answered', () => {
    const unanswerable: string[] = [];
    for (let phase = 1; phase <= 4; phase += 1) {
      for (const q of getQuestionsForPhase(phase)) {
        const candidate =
          q.type === 'multiselect' ? [q.options?.[0] as string]
          : q.type === 'select' ? (q.options?.[0] as string)
          : q.type === 'number' ? (q.numeric?.min ?? 1)
          : q.type === 'range' ? { min: q.numeric?.min ?? 0, max: q.numeric?.max ?? 1 }
          : 'an answer';
        try { toColumns(q, candidate); } catch { unanswerable.push(q.questionId); }
      }
    }
    expect(unanswerable).toEqual([]);
  });
});
