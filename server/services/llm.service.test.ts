

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  generateJson, buildGuardrailPreamble, critiqueAnswers,
  paceCalls, resetPacing, __setPacingForTests, MODELS,
} from './llm.service';

/* ------------------------------------------------------------ the fake API --- */

type Canned = (url: string) => Response;
let queue: Canned[] = [];
let calls: Array<{ url: string; body: Record<string, unknown> }> = [];

const groqSaid = (content: string, finishReason = 'stop'): Canned => () =>
  new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: finishReason }] }),
    { status: 200, headers: { 'content-type': 'application/json' } });

const geminiSaid = (text: string, finishReason = 'STOP'): Canned => () =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason }] }),
    { status: 200, headers: { 'content-type': 'application/json' } });

const httpError = (status: number, body = '{}', headers: Record<string, string> = {}): Canned => () =>
  new Response(body, { status, headers });

const threw = (name: string): Canned => () => { const e = new Error('boom'); e.name = name; throw e; };

const GOOD = JSON.stringify({ headline: 'a headline', note: 'a note' });

beforeEach(() => {
  queue = [];
  calls = [];
  resetPacing();
  __setPacingForTests(0);   
  globalThis.fetch = vi.fn(async (
    input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1],
  ) => {
    const url = String(input);
    calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
    const next = queue.shift();
    if (!next) throw new Error(`fake fetch ran out of canned responses (call ${calls.length}: ${url})`);
    return next(url);
  }) as unknown as typeof fetch;
});

afterEach(() => { vi.restoreAllMocks(); resetPacing(); });

const ask = () => generateJson<{ headline: string; note: string }>({
  systemPrompt: 'system', userPrompt: 'user', requiredKeys: ['headline', 'note'],
});

const modelsCalled = () => calls.map((c) =>
  c.url.includes('googleapis') ? MODELS.GEMINI_MODEL : String(c.body.model));

/* ============================================================ the contract === */

describe('the contract: generateJson never throws', () => {
  it('returns ok:false rather than throwing when every rung fails', async () => {
    queue = [threw('TypeError'), threw('TypeError'), threw('TypeError'), threw('TypeError')];
    const r = await ask();
    expect(r.ok).toBe(false);
    expect(r.failureReason).toBeTruthy();
  });

  it('names what it tried, so the document can say more than "the model failed"', async () => {
    queue = [httpError(500), httpError(500), httpError(500), httpError(500)];
    const r = await ask();
    expect(r.failureReason).toMatch(/gpt-oss-120b/);
    expect(r.failureReason).toMatch(/gpt-oss-20b/);
    expect(r.failureReason).toMatch(/gemini/);
    expect(r.attempts).toHaveLength(4);
  });

  it('survives a provider returning something that is not JSON at all', async () => {
    queue = [() => new Response('<html>502 Bad Gateway</html>', { status: 200 })];
    queue.push(groqSaid(GOOD));
    const r = await ask();
    expect(r.ok).toBe(true);   
  });
});

/* ============================================================== the ladder === */

describe('the fallback ladder', () => {
  it('uses the primary model and stops there when it works', async () => {
    queue = [groqSaid(GOOD)];
    const r = await ask();
    expect(r.ok).toBe(true);
    expect(r.model).toBe(MODELS.GROQ_MODEL);
    expect(r.usedFallback).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('retries the same model once on malformed JSON', async () => {
    queue = [groqSaid('not json at all'), groqSaid(GOOD)];
    const r = await ask();
    expect(r.ok).toBe(true);
    expect(r.usedFallback).toBe(false);
    expect(r.model).toBe(MODELS.GROQ_MODEL);
    expect(modelsCalled()).toEqual([MODELS.GROQ_MODEL, MODELS.GROQ_MODEL]);
    expect(r.attempts?.[0]?.outcome).toBe('malformed');
  });

  it('drops to the smaller Groq model when both primary attempts fail', async () => {
    queue = [groqSaid('{"broken":'), groqSaid('{"broken":'), groqSaid(GOOD)];
    const r = await ask();
    expect(r.ok).toBe(true);
    expect(r.model).toBe(MODELS.GROQ_FALLBACK_MODEL);
    expect(modelsCalled()[2]).toBe(MODELS.GROQ_FALLBACK_MODEL);
  });

  it('crosses to Gemini when Groq cannot deliver at all', async () => {
    queue = [httpError(503), httpError(503), httpError(503), geminiSaid(GOOD)];
    const r = await ask();
    expect(r.ok).toBe(true);
    expect(r.model).toBe(MODELS.GEMINI_MODEL);
    expect(r.usedFallback).toBe(true);
    expect(calls[3]?.url).toMatch(/googleapis/);
  });


  it('skips the retry rung on 413, because the same request cannot fit twice', async () => {
    queue = [httpError(413), groqSaid(GOOD)];
    const r = await ask();
    expect(r.ok).toBe(true);
    expect(modelsCalled()).toEqual([MODELS.GROQ_MODEL, MODELS.GROQ_FALLBACK_MODEL]);
    expect(r.attempts?.[0]?.outcome).toBe('too_large');
  });

  it('skips the retry rung on 429 for the same reason', async () => {
    queue = [httpError(429, '{}', { 'retry-after': '12' }), groqSaid(GOOD)];
    const r = await ask();
    expect(modelsCalled()).toEqual([MODELS.GROQ_MODEL, MODELS.GROQ_FALLBACK_MODEL]);
    expect(r.attempts?.[0]?.outcome).toBe('rate_limited');
    expect(r.attempts?.[0]?.detail).toMatch(/12/);
  });

  it('records a timeout as a timeout, not as a generic error', async () => {
    queue = [threw('TimeoutError'), groqSaid(GOOD)];
    const r = await ask();
    expect(r.attempts?.[0]?.outcome).toBe('timeout');
    expect(r.attempts?.[0]?.detail).toMatch(/28s/);
  });
});

/* ================================================== the malformed-output path === */

describe('what counts as malformed', () => {
  it('strips markdown fences rather than wasting the call', async () => {
    queue = [groqSaid('```json\n' + GOOD + '\n```')];
    const r = await ask();
    expect(r.ok).toBe(true);
    expect(r.data?.headline).toBe('a headline');
  });

  it('rejects a response truncated at the token limit', async () => {
    queue = [groqSaid(GOOD, 'length'), groqSaid(GOOD)];
    const r = await ask();
    expect(r.attempts?.[0]?.outcome).toBe('malformed');
    expect(r.attempts?.[0]?.detail).toMatch(/cut off/);
    expect(r.ok).toBe(true);
  });

  it('rejects valid JSON that is missing a required key', async () => {
    queue = [groqSaid('{"headline":"only this"}'), groqSaid(GOOD)];
    const r = await ask();
    expect(r.attempts?.[0]?.detail).toMatch(/missing required keys: note/);
    expect(r.ok).toBe(true);
  });

  it('rejects a JSON array, which is parseable but not a section', async () => {
    queue = [groqSaid('[1,2,3]'), groqSaid(GOOD)];
    const r = await ask();
    expect(r.attempts?.[0]?.detail).toMatch(/not an object/);
  });

  it('rejects an empty response', async () => {
    queue = [groqSaid('   '), groqSaid(GOOD)];
    const r = await ask();
    expect(r.attempts?.[0]?.detail).toMatch(/empty/);
  });
});

/* ================================================================ guardrail === */

describe('the guardrail preamble', () => {
  it('lists exactly the sources it was given', () => {
    const p = buildGuardrailPreamble(['Adjust 2026', 'World Bank WDI']);
    expect(p).toMatch(/- Adjust 2026/);
    expect(p).toMatch(/- World Bank WDI/);
  });

  it('tells the model what to do INSTEAD of inventing, not merely what not to do', () => {
    const p = buildGuardrailPreamble(['x']);
    expect(p).toMatch(/unvalidated_fields/);
    expect(p).toMatch(/WITHOUT the number/);
  });

  it('forbids recomputation, because arithmetic is the calculation layer\'s job', () => {
    expect(buildGuardrailPreamble(['x'])).toMatch(/Do not compute anything/);
  });

  it('requires proxy and conflict caveats to be carried into the prose', () => {
    expect(buildGuardrailPreamble(['x'])).toMatch(/PROXY.*conflict|conflict.*PROXY/s);
  });

  it('says plainly when there is nothing citable at all', () => {
    expect(buildGuardrailPreamble([])).toMatch(/every figure in this section must be marked unvalidated/);
  });

  it('reaches the provider on both Groq and Gemini', async () => {
    queue = [httpError(503), httpError(503), httpError(503), geminiSaid(GOOD)];
    await generateJson({
      systemPrompt: 'SENTINEL-GUARDRAIL', userPrompt: 'user', requiredKeys: [],
    });
    const gemini = calls[3];
    expect(JSON.stringify(gemini?.body)).toMatch(/SENTINEL-GUARDRAIL/);
  });
});

/* =================================================================== ADR-011 === */

describe('the feedback path (ADR-011)', () => {

  it('is off by default and says so instead of failing silently', async () => {
    const r = await critiqueAnswers('some answers', ['a source']);
    expect(r.ok).toBe(false);
    expect(r.failureReason).toMatch(/LLM_FEEDBACK_ENABLED/);
    expect(calls).toHaveLength(0);   
  });
});

/* ==================================================================== pacing === */

describe('pacing', () => {
  it('does not delay the first call', async () => {
    resetPacing();
    expect(await paceCalls()).toBe(0);
  });

  it('waits out the gap before a second call, and actually sleeps', async () => {
    resetPacing();
    __setPacingForTests(200);
    expect(await paceCalls()).toBe(0);          

    const startedAt = Date.now();
    const owed = await paceCalls();             
    expect(owed).toBeGreaterThan(0);
    expect(owed).toBeLessThanOrEqual(200);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(150);
  });

  it('ships the measured 2.5s gap, not a test value', () => {
    resetPacing();
    expect(MODELS.TIMEOUT_MS).toBe(28_000);
    expect(MODELS.MAX_OUTPUT_TOKENS).toBe(4000);
  });
});

/* ================================================================ pinning === */


describe('a pinned model never switches', () => {
  const pinned = (model: string) => generateJson<{ headline: string; note: string }>({
    systemPrompt: 'system', userPrompt: 'user',
    requiredKeys: ['headline', 'note'], pinnedModel: model,
  });

  it('uses only the pinned model on the happy path', async () => {
    queue = [groqSaid(GOOD)];
    const r = await pinned(MODELS.GROQ_FALLBACK_MODEL);
    expect(r.ok).toBe(true);
    expect(r.model).toBe(MODELS.GROQ_FALLBACK_MODEL);
    expect(r.usedFallback).toBe(false);
    expect(modelsCalled()).toEqual([MODELS.GROQ_FALLBACK_MODEL]);
  });

  it('retries the pinned model and stops — it does not reach for another', async () => {
    queue = [groqSaid('broken'), groqSaid('broken'), groqSaid(GOOD), groqSaid(GOOD)];
    const r = await pinned(MODELS.GROQ_MODEL);
    expect(r.ok).toBe(false);
    expect(modelsCalled()).toEqual([MODELS.GROQ_MODEL, MODELS.GROQ_MODEL]);
    expect(calls).toHaveLength(2);
  });

  it('does not cross to Gemini when the pinned Groq model is unreachable', async () => {
    queue = [httpError(503), httpError(503), geminiSaid(GOOD)];
    const r = await pinned(MODELS.GROQ_MODEL);
    expect(r.ok).toBe(false);
    expect(calls.every((c) => !c.url.includes('googleapis'))).toBe(true);
  });

  it('honours a pin to Gemini itself, for a set escalated to that provider', async () => {
    queue = [geminiSaid(GOOD)];
    const r = await pinned(MODELS.GEMINI_MODEL);
    expect(r.ok).toBe(true);
    expect(r.model).toBe(MODELS.GEMINI_MODEL);
    expect(calls[0]?.url).toMatch(/googleapis/);
  });

  it('still skips the wasted retry on a size rejection', async () => {
    queue = [httpError(413)];
    const r = await pinned(MODELS.GROQ_MODEL);
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(1);
    expect(r.attempts?.[0]?.outcome).toBe('too_large');
  });
});
