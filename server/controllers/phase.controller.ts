

import { asyncHandler } from '../middleware/async';
import { AppError } from '../middleware/error';
import { parsePhaseNo } from '../middleware/project';
import * as gate from '../services/gate.service';
import * as answerService from '../services/answer.service';
import * as projectService from '../services/project.service';
import { getQuestionsForPhase, getPhases as getPhaseMeta } from '../services/questionBank.service';

function projectOf(req: { project?: { id: number } }): number {
  if (!req.project) throw new AppError('Project not found', 404);
  return req.project.id;
}


export const list = asyncHandler(async (req, res) => {
  res.json({
    phases: await projectService.getPhases(projectOf(req)),
    phaseMeta: getPhaseMeta(),
  });
});


export const get = asyncHandler(async (req, res) => {
  const projectId = projectOf(req);
  const phaseNo = parsePhaseNo(req);

  const phases = await projectService.getPhases(projectId);
  const phase = phases.find((p) => p.phase_no === phaseNo);
  if (!phase) throw new AppError('Phase not found', 404);

  res.json({
    phase,
    meta: getPhaseMeta().find((m) => m.order === phaseNo) ?? null,
    questions: getQuestionsForPhase(phaseNo),
    answers: await answerService.getAnswersForPhase(projectId, phaseNo),
    canApprove: await gate.canApprove(projectId, phaseNo),
  });
});


export const approve = asyncHandler(async (req, res) => {
  const projectId = projectOf(req);
  const result = await gate.approvePhase(projectId, parsePhaseNo(req));
  res.json({
    ...result,
    phases: await projectService.getPhases(projectId),
    project: await projectService.getById(projectId),
  });
});


export const revise = asyncHandler(async (req, res) => {
  const projectId = projectOf(req);
  const phaseNo = parsePhaseNo(req);
  await gate.revisePhase(projectId, phaseNo);
  res.json({
    revising: phaseNo,
    phases: await projectService.getPhases(projectId),
    project: await projectService.getById(projectId),
  });
});
