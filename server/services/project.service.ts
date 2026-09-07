/* Create / list projects; loads the seed project. */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, queryOne, transaction } from '../db/query';
import { AppError } from '../middleware/error';
import { PHASE_COUNT, phaseNoOf } from './questionBank.service';
import { refreshPhaseStatus } from './gate.service';

export interface ProjectRow {
  id: number; user_id: number; name: string;
  vertical_id: string | null; business_model: string | null;
  current_phase: number; status: string; is_seed: boolean;
  created_at: string; updated_at: string;
}

export interface PhaseRow {
  phase_no: number;
  status: 'pending' | 'in_progress' | 'awaiting_approval' | 'approved' | 'revising';
  approved_at: string | null;
}

interface NewProject {
  name: string; verticalId?: string | null;
  businessModel?: string | null; isSeed?: boolean;
}

export async function create(userId: number, input: NewProject): Promise<ProjectRow> {
  if (!input.name?.trim()) throw new AppError('A project name is required', 400);

  return transaction(async (q) => {
    const rows = await q<ProjectRow>(
      `INSERT INTO projects (user_id, name, vertical_id, business_model, is_seed)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [userId, input.name.trim(), input.verticalId ?? null,
       input.businessModel ?? null, input.isSeed ?? false],
    );
    const project = rows[0];
    if (!project) throw new AppError('Could not create project', 500);

    await q(
      `INSERT INTO phases (project_id, phase_no, status)
       SELECT $1, n, CASE WHEN n = 1 THEN 'in_progress' ELSE 'pending' END
       FROM generate_series(1, $2) AS n`,
      [project.id, PHASE_COUNT],
    );
    return project;
  });
}

export async function list(userId: number): Promise<ProjectRow[]> {
  return query<ProjectRow>(
    'SELECT * FROM projects WHERE user_id = $1 ORDER BY created_at DESC', [userId],
  );
}

export async function getOwned(projectId: number, userId: number): Promise<ProjectRow> {
  const project = await queryOne<ProjectRow>(
    'SELECT * FROM projects WHERE id = $1 AND user_id = $2', [projectId, userId],
  );
  if (!project) throw new AppError('Project not found', 404);
  return project;
}

export async function getById(projectId: number): Promise<ProjectRow> {
  const project = await queryOne<ProjectRow>('SELECT * FROM projects WHERE id = $1', [projectId]);
  if (!project) throw new AppError('Project not found', 404);
  return project;
}

export async function getPhases(projectId: number): Promise<PhaseRow[]> {
  return query<PhaseRow>(
    `SELECT phase_no, status, approved_at FROM phases
     WHERE project_id = $1 ORDER BY phase_no`, [projectId],
  );
}

interface SeedAnswer {
  questionId: string; type: string;
  valueText: string | null; valueNumber: number | null;
  valueJson: string[] | null; clearOnDemo: boolean;
}
interface SeedFile {
  project: { name: string; verticalId: string; businessModel: string; isSeed: boolean };
  answers: SeedAnswer[];
}

const SEED_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'seed-project.json',
);
const seed = JSON.parse(readFileSync(SEED_PATH, 'utf8')) as SeedFile;

export async function createFromSeed(userId: number): Promise<ProjectRow> {
  const project = await create(userId, {
    name: seed.project.name,
    verticalId: seed.project.verticalId,
    businessModel: seed.project.businessModel,
    isSeed: true,
  });

  const prefill = seed.answers.filter((a) => !a.clearOnDemo);

  await transaction(async (q) => {
    for (const a of prefill) {
      await q(
        `INSERT INTO answers (project_id, question_id, phase_no, value_text, value_number, value_json)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [project.id, a.questionId, phaseNoOf(a.questionId),
         a.valueText, a.valueNumber,
         a.valueJson === null ? null : JSON.stringify(a.valueJson)],
      );
    }
  });

  for (let n = 1; n <= PHASE_COUNT; n += 1) await refreshPhaseStatus(project.id, n);

  return project;
}
