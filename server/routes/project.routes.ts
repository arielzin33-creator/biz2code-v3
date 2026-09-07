

import { Router } from 'express';
import * as projectController from '../controllers/project.controller';
import { requireAuth } from '../middleware/auth';
import { loadProject } from '../middleware/project';
import { validateBody } from '../middleware/validate';

export const projectRoutes = Router();

projectRoutes.use(requireAuth);

projectRoutes.get('/', projectController.list);
projectRoutes.post('/', validateBody(['name']), projectController.create);

projectRoutes.post('/seed', projectController.createFromSeed);

projectRoutes.get('/:projectId', loadProject, projectController.get);
