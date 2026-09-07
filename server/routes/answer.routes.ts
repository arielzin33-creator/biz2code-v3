

import { Router } from 'express';
import * as answerController from '../controllers/answer.controller';
import { requireAuth } from '../middleware/auth';
import { loadProject } from '../middleware/project';

export const answerRoutes = Router({ mergeParams: true });

answerRoutes.use(requireAuth, loadProject);

answerRoutes.get('/', answerController.list);
answerRoutes.post('/', answerController.save);
