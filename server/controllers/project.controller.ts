

import { asyncHandler } from '../middleware/async';
import { AppError } from '../middleware/error';
import * as projectService from '../services/project.service';
import { getPhases as getPhaseMeta } from '../services/questionBank.service';

interface NewProjectBody {
  name?: string;
  verticalId?: string | null;
  businessModel?: string | null;
}


function userIdOf(req: { userId?: number }): number {
  if (!req.userId) throw new AppError('Not authenticated', 401);
  return req.userId;
}


export const list = asyncHandler(async (req, res) => {
  res.json({ projects: await projectService.list(userIdOf(req)) });
});


export const create = asyncHandler(async (req, res) => {
  const body = (req.body ?? {}) as NewProjectBody;
  const project = await projectService.create(userIdOf(req), {
    name: body.name ?? '',
    verticalId: body.verticalId ?? null,
    businessModel: body.businessModel ?? null,
  });
  res.status(201).json({ project });
});


export const createFromSeed = asyncHandler(async (req, res) => {
  const project = await projectService.createFromSeed(userIdOf(req));
  res.status(201).json({ project });
});


export const get = asyncHandler(async (req, res) => {
  const project = req.project;
  if (!project) throw new AppError('Project not found', 404);
  res.json({
    project,
    phases: await projectService.getPhases(project.id),
    phaseMeta: getPhaseMeta(),
  });
});
