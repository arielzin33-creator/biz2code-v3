






import { query, queryOne, transaction } from '../db/query';
import { getQuestionsForPhase, PHASE_COUNT } from './questionBank.service';
import { AppError } from '../middleware/error';

export type PhaseStatus =
  | 'pending' | 'in_progress' | 'awaiting_approval' | 'approved' | 'revising';


export async function canApprove(projectId: number, phaseNo: number): Promise<boolean> {
  const required = getQuestionsForPhase(phaseNo).filter((q) => q.required);
  const answered = await query<{ question_id: string }>(
    'SELECT question_id FROM answers WHERE project_id = $1 AND phase_no = $2',
    [projectId, phaseNo],
  );
  const have = new Set(answered.map((a) => a.question_id));
  return required.every((q) => have.has(q.questionId));
}


export async function refreshPhaseStatus(
  projectId: number, phaseNo: number,
): Promise<PhaseStatus> {
  const phase = await queryOne<{ status: PhaseStatus }>(
    'SELECT status FROM phases WHERE project_id = $1 AND phase_no = $2', [projectId, phaseNo],
  );
  if (!phase) throw new AppError('Phase not found', 404);
  if (phase.status === 'approved') return phase.status;

  const complete = await canApprove(projectId, phaseNo);
  const next: PhaseStatus = complete
    ? 'awaiting_approval'
    : (phase.status === 'pending' ? 'pending' : 'in_progress');

  if (next !== phase.status) {
    await query('UPDATE phases SET status = $3 WHERE project_id = $1 AND phase_no = $2',
      [projectId, phaseNo, next]);
  }
  return next;
}


export async function approvePhase(projectId: number, phaseNo: number) {
  const project = await queryOne<{ current_phase: number }>(
    'SELECT current_phase FROM projects WHERE id = $1', [projectId],
  );
  if (!project) throw new AppError('Project not found', 404);

  if (phaseNo > project.current_phase)
    throw new AppError(`Phase ${phaseNo} is not unlocked yet`, 409);

  const unapproved = await queryOne<{ phase_no: number }>(
    `SELECT phase_no FROM phases
     WHERE project_id = $1 AND phase_no < $2 AND status <> 'approved'
     ORDER BY phase_no LIMIT 1`, [projectId, phaseNo],
  );
  if (unapproved)
    throw new AppError(`Phase ${unapproved.phase_no} must be approved first`, 409);

  if (!(await canApprove(projectId, phaseNo)))
    throw new AppError('Phase has unanswered required questions', 409);


  return transaction(async (q) => {
    await q(
      `UPDATE phases SET status = 'approved', approved_at = now()
       WHERE project_id = $1 AND phase_no = $2`, [projectId, phaseNo],
    );

    const nextPhase = phaseNo < PHASE_COUNT ? phaseNo + 1 : null;

    if (nextPhase !== null) {
      await q(
        `UPDATE projects SET current_phase = GREATEST(current_phase, $2), updated_at = now()
         WHERE id = $1`, [projectId, nextPhase],
      );
      await q(
        `UPDATE phases SET status = 'in_progress'
         WHERE project_id = $1 AND phase_no = $2 AND status = 'pending'`,
        [projectId, nextPhase],
      );
    }

    await q(
      `UPDATE projects SET
         status = CASE WHEN (SELECT count(*) FROM phases
                             WHERE project_id = $1 AND status = 'approved') = $2
                       THEN 'complete' ELSE 'in_progress' END,
         updated_at = now()
       WHERE id = $1 AND status <> 'archived'`,
      [projectId, PHASE_COUNT],
    );

    return { approved: phaseNo, nextPhase };
  });
}


export async function revisePhase(projectId: number, phaseNo: number) {
  const rows = await query<{ phase_no: number }>(
    `UPDATE phases SET status = 'revising', approved_at = NULL
     WHERE project_id = $1 AND phase_no = $2 RETURNING phase_no`,
    [projectId, phaseNo],
  );
  if (rows.length === 0) throw new AppError('Phase not found', 404);

  await query(
    `UPDATE projects SET status = 'in_progress', updated_at = now()
     WHERE id = $1 AND status = 'complete'`, [projectId],
  );
}
