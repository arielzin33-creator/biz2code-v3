

import { Router } from 'express';
import * as documentController from '../controllers/document.controller';
import { requireAuth } from '../middleware/auth';
import { loadProject } from '../middleware/project';

export const documentRoutes = Router({ mergeParams: true });

documentRoutes.use(requireAuth, loadProject);

documentRoutes.post('/generate', documentController.generate);

documentRoutes.get('/', documentController.list);
documentRoutes.get('/:id/download', documentController.download);
