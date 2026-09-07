

import { asyncHandler } from '../middleware/async';
import { AppError } from '../middleware/error';
import * as answerService from '../services/answer.service';
import type { AnswerValue } from '../services/answer.service';
import * as projectService from '../services/project.service';

interface SingleAnswerBody { questionId?: string; value?: AnswerValue }
interface BatchAnswerBody { answers?: { questionId?: string; value?: AnswerValue }[] }

function projectOf(req: { project?: { id: number } }): number {
  if (!req.project) throw new AppError('Project not found', 404);
  return req.project.id;
}


export const list = asyncHandler(async (req, res) => {
  res.json({ answers: await answerService.getAnswers(projectOf(req)) });
});


export const save = asyncHandler(async (req, res) => {
  const projectId = projectOf(req);
  const body = (req.body ?? {}) as SingleAnswerBody & BatchAnswerBody;

  const entries = Array.isArray(body.answers)
    ? body.answers
    : [{ questionId: body.questionId, value: body.value }];

  const cleaned = entries.map((e) => {
    if (!e?.questionId) throw new AppError('Each answer needs a questionId', 400);
    if (e.value === undefined || e.value === null)
      throw new AppError(`No value supplied for ${e.questionId}`, 400);
    return { questionId: e.questionId, value: e.value };
  });

  const saved = await answerService.saveAnswers(projectId, cleaned);
  res.status(201).json({
    answers: saved,
    phases: await projectService.getPhases(projectId),
  });
});
