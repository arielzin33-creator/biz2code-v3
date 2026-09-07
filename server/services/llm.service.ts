

import { env } from '../config/env';

export interface LlmResult<T> {
  ok: boolean;
  data?: T;
  failureReason?: string;   

  model?: string;

  usedFallback?: boolean;

  attempts?: Attempt[];
}

export interface Attempt {
  model: string;
  outcome: 'ok' | 'malformed' | 'timeout' | 'rate_limited' | 'too_large' | 'error';
  ms: number;
  detail?: string;
}



const GEMINI_MODEL = 'gemini-3.5-flash-lite';

const GROQ_MODEL = 'openai/gpt-oss-120b';
const GROQ_FALLBACK_MODEL = 'openai/gpt-oss-20b';  
const MAX_OUTPUT_TOKENS = 4000;      

const MAX_BUDGET_WAIT_MS = 60_000;
const REASONING_EFFORT = 'low';      
const MIN_MS_BETWEEN_CALLS = 2500;   
const TIMEOUT_MS = 28_000;           
const TEMPERATURE = 0.2;             

const GROQ_BASE = 'https://api.groq.com/openai/v1';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/* ------------------------------------------------------- pacing and budget --- */

let lastGroqCallAt = 0;
let pacingMs = MIN_MS_BETWEEN_CALLS;

const GROQ_TOKENS_PER_MINUTE = 8000;

const GROQ_REFILL_PER_SECOND = GROQ_TOKENS_PER_MINUTE / 60;


const budget = new Map<string, { remaining: number; at: number }>();


function remainingFor(model: string): number {
  const seen = budget.get(model);
  if (!seen) return Number.POSITIVE_INFINITY;
  const refilled = ((Date.now() - seen.at) / 1000) * GROQ_REFILL_PER_SECOND;
  return Math.min(GROQ_TOKENS_PER_MINUTE, seen.remaining + refilled);
}


function estimateCost(systemPrompt: string, userPrompt: string, maxTokens: number): number {
  return Math.ceil((systemPrompt.length + userPrompt.length) / 4) + maxTokens;
}


function waitUntilAffordable(model: string, cost: number): number {
  const short = cost - remainingFor(model);
  return short <= 0 ? 0 : Math.ceil((short / GROQ_REFILL_PER_SECOND) * 1000);
}


export async function paceCalls(now = Date.now()): Promise<number> {
  const wait = Math.max(0, pacingMs - (now - lastGroqCallAt));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastGroqCallAt = Date.now();
  return wait;
}


export function __setPacingForTests(ms: number) { pacingMs = ms; }
export function resetPacing() {
  lastGroqCallAt = 0;
  pacingMs = MIN_MS_BETWEEN_CALLS;
  budget.clear();
}


export const budgetSnapshot = (): Record<string, number> => ({
  [GROQ_MODEL]: remainingFor(GROQ_MODEL),
  [GROQ_FALLBACK_MODEL]: remainingFor(GROQ_FALLBACK_MODEL),
});

/* ------------------------------------------------------------- guardrail --- */


export function buildGuardrailPreamble(allowedCitations: string[]): string {
  const list = allowedCitations.length
    ? allowedCitations.map((c) => `  - ${c}`).join('\n')
    : '  (none — every figure in this section must be marked unvalidated)';

  return `SOURCE RULES — these override every other instruction.

You may cite ONLY the sources listed below. They are the complete set.
${list}

You must NOT introduce any figure, statistic, percentage, currency amount, market
size, growth rate, company name, or published study that does not appear in the
context given to you. Not from memory, not as an illustration, not as a
"typical industry" figure, not rephrased.

When you need a figure that is not in the list:
  1. Write the sentence WITHOUT the number.
  2. Add that field's path to "unvalidated_fields".
  3. Say plainly in the text that no sourced figure was available.

Do not compute anything. Every number you need has already been calculated and
is supplied in the context with its confidence tier. Restate the supplied figures
exactly; do not round, re-derive, sum, or convert them.

Where the context marks a figure PROXY, borrowed, a cross-vertical aggregate, or
in conflict between sources, carry that caveat into your prose. Do not present
such a figure as settled.`;
}

/* --------------------------------------------------------------- helpers --- */

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);


function parseJson(text: string): { ok: true; data: unknown } | { ok: false; why: string } {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  if (!trimmed) return { ok: false, why: 'the model returned an empty response' };
  try {
    return { ok: true, data: JSON.parse(trimmed) };
  } catch (e) {
    return { ok: false, why: `unparseable JSON: ${(e as Error).message}` };
  }
}

async function readBody(res: Response): Promise<string> {
  try { return await res.text(); } catch { return ''; }
}

/* --------------------------------------------------------------- callers --- */

interface RawCall { text: string; truncated: boolean }

async function callGroq(model: string, systemPrompt: string, userPrompt: string, maxTokens: number):
  Promise<{ ok: true; raw: RawCall } | { ok: false; outcome: Attempt['outcome']; detail: string }> {
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    temperature: TEMPERATURE,
    max_tokens: maxTokens,
  };
  if (/gpt-oss/.test(model)) body.reasoning_effort = REASONING_EFFORT;

  try {
    const res = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const remaining = Number(res.headers.get('x-ratelimit-remaining-tokens'));
    if (Number.isFinite(remaining)) budget.set(model, { remaining, at: Date.now() });

    if (!res.ok) {
      const text = await readBody(res);
      if (res.status === 413) return { ok: false, outcome: 'too_large', detail: 'Groq rejected the request as too large for the per-minute token budget' };
      if (res.status === 429) {
        const retryAfter = res.headers.get('retry-after');
        return { ok: false, outcome: 'rate_limited', detail: `rate limited${retryAfter ? ` (retry after ${retryAfter}s)` : ''}` };
      }
      return { ok: false, outcome: 'error', detail: `HTTP ${res.status}: ${text.slice(0, 140).replace(/\s+/g, ' ')}` };
    }

    const json = await res.json() as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    };
    const choice = json.choices?.[0];
    return {
      ok: true,
      raw: { text: choice?.message?.content ?? '', truncated: choice?.finish_reason === 'length' },
    };
  } catch (e) {
    const err = e as Error;
    const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
    return {
      ok: false,
      outcome: timedOut ? 'timeout' : 'error',
      detail: timedOut ? `no response within ${TIMEOUT_MS / 1000}s` : err.message,
    };
  }
}

async function callGemini(systemPrompt: string, userPrompt: string, maxTokens: number):
  Promise<{ ok: true; raw: RawCall } | { ok: false; outcome: Attempt['outcome']; detail: string }> {
  if (!env.GEMINI_API_KEY)
    return { ok: false, outcome: 'error', detail: 'no Gemini key configured' };

  try {
    const res = await fetch(`${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
        generationConfig: {
          temperature: TEMPERATURE,
          maxOutputTokens: Math.max(maxTokens * 2, 4000),
          responseMimeType: 'application/json',
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      const text = await readBody(res);
      if (res.status === 429) return { ok: false, outcome: 'rate_limited', detail: 'Gemini free-tier RPM exceeded' };
      return { ok: false, outcome: 'error', detail: `HTTP ${res.status}: ${text.slice(0, 140).replace(/\s+/g, ' ')}` };
    }

    const json = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
    };
    const cand = json.candidates?.[0];
    const text = (cand?.content?.parts ?? []).map((p) => p.text ?? '').join('');
    return { ok: true, raw: { text, truncated: cand?.finishReason === 'MAX_TOKENS' } };
  } catch (e) {
    const err = e as Error;
    const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
    return {
      ok: false,
      outcome: timedOut ? 'timeout' : 'error',
      detail: timedOut ? `no response within ${TIMEOUT_MS / 1000}s` : err.message,
    };
  }
}

/* ------------------------------------------------------------ the ladder --- */

interface GenerateOptions {

  systemPrompt: string;

  userPrompt: string;

  requiredKeys?: string[];

  label?: string;

  maxTokens?: number;

  pinnedModel?: string;
}


export async function generateJson<T = Record<string, unknown>>(
  opts: GenerateOptions,
): Promise<LlmResult<T>> {
  const attempts: Attempt[] = [];
  const {
    systemPrompt, userPrompt, requiredKeys = [],
    maxTokens = MAX_OUTPUT_TOKENS, pinnedModel,
  } = opts;

  const evaluate = (raw: RawCall): { ok: true; data: T } | { ok: false; why: string } => {
    if (raw.truncated)
      return { ok: false, why: `the response was cut off at the ${maxTokens}-token limit` };
    const parsed = parseJson(raw.text);
    if (!parsed.ok) return { ok: false, why: parsed.why };
    if (!isRecord(parsed.data)) return { ok: false, why: 'the model returned JSON that is not an object' };
    const missing = requiredKeys.filter((k) => !(k in (parsed.data as Record<string, unknown>)));
    if (missing.length) return { ok: false, why: `missing required keys: ${missing.join(', ')}` };
    return { ok: true, data: parsed.data as T };
  };

  const cost = estimateCost(systemPrompt, userPrompt, maxTokens);


  if (pinnedModel) {
    const isGemini = pinnedModel === GEMINI_MODEL;
    if (!isGemini) {
      const owed = waitUntilAffordable(pinnedModel, cost);
      if (owed > 0 && owed <= MAX_BUDGET_WAIT_MS)
        await new Promise((r) => setTimeout(r, owed));
    }
    const call = () => isGemini
      ? callGemini(systemPrompt, userPrompt, maxTokens)
      : callGroq(pinnedModel, systemPrompt, userPrompt, maxTokens);

    return runLadder([
      { model: pinnedModel, run: call },
      { model: `${pinnedModel} (retry)`, run: call },
    ], { evaluate, attempts, isGroq: !isGemini });
  }


  const canAfford = (m: string) => remainingFor(m) >= cost;
  const [firstGroq, secondGroq] =
    canAfford(GROQ_MODEL) || !canAfford(GROQ_FALLBACK_MODEL)
      ? [GROQ_MODEL, GROQ_FALLBACK_MODEL]
      : [GROQ_FALLBACK_MODEL, GROQ_MODEL];

  const ladder: Array<{ model: string; run: () => ReturnType<typeof callGroq> }> = [
    { model: firstGroq, run: () => callGroq(firstGroq, systemPrompt, userPrompt, maxTokens) },
    { model: `${firstGroq} (retry)`, run: () => callGroq(firstGroq, systemPrompt, userPrompt, maxTokens) },
    { model: secondGroq, run: () => callGroq(secondGroq, systemPrompt, userPrompt, maxTokens) },
    { model: GEMINI_MODEL, run: () => callGemini(systemPrompt, userPrompt, maxTokens) },
  ];

  const owed = Math.min(waitUntilAffordable(firstGroq, cost), waitUntilAffordable(secondGroq, cost));
  if (owed > 0 && owed <= MAX_BUDGET_WAIT_MS) {
    await new Promise((r) => setTimeout(r, owed));
    if (waitUntilAffordable(secondGroq, cost) === 0 && waitUntilAffordable(firstGroq, cost) > 0) {
      [ladder[0], ladder[2]] = [ladder[2]!, ladder[0]!];
      ladder[1] = { model: `${secondGroq} (retry)`, run: () => callGroq(secondGroq, systemPrompt, userPrompt, maxTokens) };
    }
  }

  return runLadder(ladder, { evaluate, attempts, isGroq: true });
}


async function runLadder<T>(
  ladder: Array<{ model: string; run: () => Promise<Awaited<ReturnType<typeof callGroq>>> }>,
  ctx: {
    evaluate: (raw: { text: string; truncated: boolean }) => { ok: true; data: T } | { ok: false; why: string };
    attempts: Attempt[];
    isGroq: boolean;
  },
): Promise<LlmResult<T>> {
  const { evaluate, attempts } = ctx;
  const baseModel = (m: string) => m.replace(' (retry)', '');
  const intended = baseModel(ladder[0]?.model ?? '');

  for (let i = 0; i < ladder.length; i += 1) {
    const rung = ladder[i];
    if (!rung) break;

    if (rung.model !== GEMINI_MODEL) await paceCalls();
    const startedAt = Date.now();
    const called = await rung.run();
    const ms = Date.now() - startedAt;

    if (!called.ok) {
      attempts.push({ model: rung.model, outcome: called.outcome, ms, detail: called.detail });
      if ((called.outcome === 'too_large' || called.outcome === 'rate_limited')
          && ladder[i + 1]?.model.endsWith('(retry)')) i += 1;
      continue;
    }

    const evaluated = evaluate(called.raw);
    if (!evaluated.ok) {
      attempts.push({ model: rung.model, outcome: 'malformed', ms, detail: evaluated.why });
      continue;
    }

    attempts.push({ model: rung.model, outcome: 'ok', ms });
    return {
      ok: true,
      data: evaluated.data,
      model: baseModel(rung.model),
      usedFallback: baseModel(rung.model) !== intended,
      attempts,
    };
  }

  const summary = attempts.map((a) => `${a.model}: ${a.outcome}${a.detail ? ` (${a.detail})` : ''}`).join('; ');
  return {
    ok: false,
    failureReason: `no model returned usable output — ${summary}`,
    attempts,
  };
}


export interface AnswerCritique { concerns: string[] }

export async function critiqueAnswers(
  context: string, allowedCitations: string[],
): Promise<LlmResult<AnswerCritique>> {
  if (!env.LLM_FEEDBACK_ENABLED)
    return { ok: false, failureReason: 'feedback mode is disabled (LLM_FEEDBACK_ENABLED)' };

  return generateJson<AnswerCritique>({
    systemPrompt: buildGuardrailPreamble(allowedCitations),
    userPrompt:
      `Review these answers for gaps a specification reviewer would raise.\n\n${context}\n\n` +
      `Return JSON: { "concerns": [string] }. At most four concerns, each one sentence. ` +
      `Raise only what the answers themselves show; do not speculate about the market.`,
    requiredKeys: ['concerns'],
    label: 'critique',
  });
}

export const MODELS = { GROQ_MODEL, GROQ_FALLBACK_MODEL, GEMINI_MODEL, TIMEOUT_MS, MAX_OUTPUT_TOKENS };
