/* Loads and indexes question-bank.json. */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from '../middleware/error';

export interface Question {
  questionId: string;
  phaseId: string;
  order: number;
  text: string;
  type: 'text' | 'select' | 'multiselect' | 'number' | 'range';
  required: boolean;
  inDemoSet: boolean;
  helpText: string | null;
  feeds: string[];
  options?: string[];
  placeholder?: string;
  numeric?: { unit: string; min: number; max: number };
}

export interface PhaseMeta {
  phaseId: string; order: number; name: string;
  description: string; primaryDocument: string;
}

export interface SegmentFilter {
  kind: 'none' | 'percent_of_population' | 'complement_of_percent' | 'absolute_count';
  indicator: string | null;
  note?: string;
}

interface Bank {
  version: string;
  phases: PhaseMeta[];
  questions: Question[];
  derivationLayer?: { segments?: Record<string, SegmentFilter> };
}

const BANK_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'question-bank.json',
);

function fail(reason: string): never {
  throw new Error(`question-bank.json is invalid — ${reason}`);
}

function load(): Bank {
  const bank = JSON.parse(readFileSync(BANK_PATH, 'utf8')) as Bank;

  if (!Array.isArray(bank.phases) || bank.phases.length === 0) fail('no phases');
  if (!Array.isArray(bank.questions) || bank.questions.length === 0) fail('no questions');

  const phaseIds = new Set(bank.phases.map((p) => p.phaseId));
  const seen = new Set<string>();

  for (const q of bank.questions) {
    if (!q.questionId) fail('a question has no questionId');
    if (seen.has(q.questionId)) fail(`duplicate questionId ${q.questionId}`);
    seen.add(q.questionId);
    if (!phaseIds.has(q.phaseId)) fail(`${q.questionId} points at unknown phase ${q.phaseId}`);
    if ((q.type === 'select' || q.type === 'multiselect') && !q.options?.length)
      fail(`${q.questionId} is ${q.type} but has no options`);
    if ((q.type === 'number' || q.type === 'range') && !q.numeric)
      fail(`${q.questionId} is ${q.type} but declares no numeric bounds`);
  }
  return bank;
}

const bank = load();

const phaseNoByPhaseId = new Map(bank.phases.map((p) => [p.phaseId, p.order]));
const byId = new Map(bank.questions.map((q) => [q.questionId, q]));
const byPhase = new Map<number, Question[]>();

for (const q of bank.questions) {
  const no = phaseNoByPhaseId.get(q.phaseId);
  if (no === undefined) fail(`cannot resolve a phase number for ${q.questionId}`);
  byPhase.set(no, [...(byPhase.get(no) ?? []), q]);
}
for (const list of byPhase.values()) list.sort((a, b) => a.order - b.order);

export const PHASE_COUNT = bank.phases.length;

export const getPhases = (): PhaseMeta[] => bank.phases;

export const getSegmentFilters = (): Record<string, SegmentFilter> =>
  bank.derivationLayer?.segments ?? {};
export const getQuestionsForPhase = (phaseNo: number): Question[] => byPhase.get(phaseNo) ?? [];

export function getQuestion(questionId: string): Question {
  const q = byId.get(questionId);
  if (!q) throw new AppError(`Unknown question: ${questionId}`, 404);
  return q;
}

export function phaseNoOf(questionId: string): number {
  return phaseNoByPhaseId.get(getQuestion(questionId).phaseId) ?? fail(`orphan question ${questionId}`);
}
