

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { asyncHandler } from '../middleware/async';
import { AppError } from '../middleware/error';
import * as generation from '../services/generation.service';
import { absolutePathFor } from '../services/docx.service';

function projectOf(req: { project?: { id: number } }): number {
  if (!req.project) throw new AppError('Project not found', 404);
  return req.project.id;
}


export const generate = asyncHandler(async (req, res) => {
  res.json(await generation.generateAll(projectOf(req)));
});


export const list = asyncHandler(async (req, res) => {
  res.json({ documents: await generation.listDeliverables(projectOf(req)) });
});


export const download = asyncHandler(async (req, res) => {
  const projectId = projectOf(req);
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw new AppError('Invalid document id', 400);

  const doc = await generation.getDeliverable(projectId, id);
  if (!doc.file_path) throw new AppError('This document has no rendered file', 404);

  const absolute = absolutePathFor(doc.file_path);
  try {
    await stat(absolute);
  } catch {
    throw new AppError('The rendered file is no longer on disk', 410);
  }

  res.setHeader('Content-Type',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="${basename(doc.file_path)}"`);
  createReadStream(absolute).pipe(res);
});
