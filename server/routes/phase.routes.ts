

import { Router } from 'express';
import * as phaseController from '../controllers/phase.controller';
import { requireAuth } from '../middleware/auth';
import { loadProject } from '../middleware/project';

export const phaseRoutes = Router({ mergeParams: true });

phaseRoutes.use(requireAuth, loadProject);

phaseRoutes.get('/', phaseController.list);
phaseRoutes.get('/:phaseNo', phaseController.get);

phaseRoutes.post('/:phaseNo/approve', phaseController.approve);
phaseRoutes.post('/:phaseNo/revise', phaseController.revise);
