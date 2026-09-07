

import type { Request, Response, NextFunction } from 'express';
import { AppError } from './error';
import { getOwned } from '../services/project.service';
import { PHASE_COUNT } from '../services/questionBank.service';


export function loadProject(req: Request, _res: Response, next: NextFunction) {
  const projectId = Number(req.params.projectId);
  if (!Number.isInteger(projectId) || projectId < 1)
    return next(new AppError('Invalid project id', 400));
  if (!req.userId) return next(new AppError('Not authenticated', 401));

  getOwned(projectId, req.userId)
    .then((project) => { req.project = project; next(); })
    .catch(next);
}


export function parsePhaseNo(req: Request): number {
  const phaseNo = Number(req.params.phaseNo);
  if (!Number.isInteger(phaseNo) || phaseNo < 1 || phaseNo > PHASE_COUNT)
    throw new AppError(`Phase must be between 1 and ${PHASE_COUNT}`, 400);
  return phaseNo;
}
