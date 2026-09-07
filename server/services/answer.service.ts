/* Upserts answers, typed by question kind. */

import { query, transaction } from '../db/query';
import { AppError } from '../middleware/error';
import { getQuestion, phaseNoOf, type Question } from './questionBank.service';
import { refreshPhaseStatus } from './gate.service';

export interface AnswerRow {
  question_id: string;
  phase_no: number;
  value_text: string | null;
  value_number: string | null;   
  value_json: string[] | RangeValue | null;
  answered_at: string;
}

export interface RangeValue { min: number; max: number }
export type AnswerValue = string | number | string[] | RangeValue;

interface Columns {
  valueText: string | null;
  valueNumber: number | null;
  valueJson: string | null;   
}

export function toColumns(question: Question, value: AnswerValue): Columns {
  const empty: Columns = { valueText: null, valueNumber: null, valueJson: null };

  switch (question.type) {
    case 'text': {
      if (typeof value !== 'string') throw new AppError(`${question.questionId} expects text`, 400);
      const text = value.trim();
      if (!text) throw new AppError(`${question.questionId} cannot be blank`, 400);
      return { ...empty, valueText: text };
    }

    case 'select': {
      if (typeof value !== 'string') throw new AppError(`${question.questionId} expects one option`, 400);
      if (!question.options?.includes(value))
        throw new AppError(`"${value}" is not an option for ${question.questionId}`, 400);
      return { ...empty, valueText: value };
    }

    case 'multiselect': {
      if (!Array.isArray(value)) throw new AppError(`${question.questionId} expects a list`, 400);
      if (value.length === 0) throw new AppError(`${question.questionId} needs at least one option`, 400);
      const unknown = value.filter((v) => !question.options?.includes(v));
      if (unknown.length)
        throw new AppError(`Not options for ${question.questionId}: ${unknown.join(', ')}`, 400);
      const unique = [...new Set(value)];
      return { ...empty, valueJson: JSON.stringify(unique) };
    }

    case 'number': {
      const n = typeof value === 'number' ? value : Number(value);
      if (typeof value === 'boolean' || Array.isArray(value) || !Number.isFinite(n))
        throw new AppError(`${question.questionId} expects a number`, 400);
      const range = question.numeric;
      if (range && (n < range.min || n > range.max))
        throw new AppError(
          `${question.questionId} must be between ${range.min} and ${range.max} ${range.unit}`, 400);
      return { ...empty, valueNumber: n };
    }

    case 'range': {
      const raw = value as Partial<RangeValue> | undefined;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        throw new AppError(`${question.questionId} expects a range with a low and a high`, 400);

      const min = Number(raw.min);
      const max = Number(raw.max);
      if (!Number.isFinite(min) || !Number.isFinite(max))
        throw new AppError(`${question.questionId} expects two numbers`, 400);
      if (min > max)
        throw new AppError(
          `${question.questionId}: the lower figure must not exceed the upper one`, 400);

      const bounds = question.numeric;
      if (bounds) {
        for (const [label, n] of [['lower', min], ['upper', max]] as const) {
          if (n < bounds.min || n > bounds.max)
            throw new AppError(
              `${question.questionId}: the ${label} figure must be between `
              + `${bounds.min} and ${bounds.max} ${bounds.unit}`, 400);
        }
      }
      return { ...empty, valueJson: JSON.stringify({ min, max }) };
    }

    default:
      throw new AppError(`Unsupported question type on ${question.questionId}`, 500);
  }
}

export async function saveAnswer(
  projectId: number, questionId: string, value: AnswerValue,
): Promise<AnswerRow> {
  const question = getQuestion(questionId);        
  const phaseNo = phaseNoOf(questionId);
  const cols = toColumns(question, value);

  const rows = await query<AnswerRow>(
    `INSERT INTO answers (project_id, question_id, phase_no, value_text, value_number, value_json)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (project_id, question_id) DO UPDATE
       SET value_text   = EXCLUDED.value_text,
           value_number = EXCLUDED.value_number,
           value_json   = EXCLUDED.value_json,
           answered_at  = now()
     RETURNING question_id, phase_no, value_text, value_number, value_json, answered_at`,
    [projectId, questionId, phaseNo, cols.valueText, cols.valueNumber, cols.valueJson],
  );
  const saved = rows[0];
  if (!saved) throw new AppError('Could not save answer', 500);

  await refreshPhaseStatus(projectId, phaseNo);

  return saved;
}

export async function saveAnswers(
  projectId: number, entries: { questionId: string; value: AnswerValue }[],
): Promise<AnswerRow[]> {
  if (entries.length === 0) throw new AppError('No answers supplied', 400);

  const prepared = entries.map((e) => {
    const question = getQuestion(e.questionId);
    return { question, phaseNo: phaseNoOf(e.questionId), cols: toColumns(question, e.value) };
  });

  const saved = await transaction(async (q) => {
    const out: AnswerRow[] = [];
    for (const p of prepared) {
      const rows = await q<AnswerRow>(
        `INSERT INTO answers (project_id, question_id, phase_no, value_text, value_number, value_json)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (project_id, question_id) DO UPDATE
           SET value_text   = EXCLUDED.value_text,
               value_number = EXCLUDED.value_number,
               value_json   = EXCLUDED.value_json,
               answered_at  = now()
         RETURNING question_id, phase_no, value_text, value_number, value_json, answered_at`,
        [projectId, p.question.questionId, p.phaseNo,
         p.cols.valueText, p.cols.valueNumber, p.cols.valueJson],
      );
      if (rows[0]) out.push(rows[0]);
    }
    return out;
  });

  for (const phaseNo of new Set(prepared.map((p) => p.phaseNo))) {
    await refreshPhaseStatus(projectId, phaseNo);
  }
  return saved;
}

export async function getAnswers(projectId: number): Promise<AnswerRow[]> {
  return query<AnswerRow>(
    `SELECT question_id, phase_no, value_text, value_number, value_json, answered_at
     FROM answers WHERE project_id = $1 ORDER BY phase_no, question_id`, [projectId],
  );
}

export async function getAnswersForPhase(projectId: number, phaseNo: number): Promise<AnswerRow[]> {
  return query<AnswerRow>(
    `SELECT question_id, phase_no, value_text, value_number, value_json, answered_at
     FROM answers WHERE project_id = $1 AND phase_no = $2 ORDER BY question_id`,
    [projectId, phaseNo],
  );
}
