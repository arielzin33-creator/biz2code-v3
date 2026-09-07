

import { Router } from 'express';
import * as authController from '../controllers/auth.controller';
import { requireAuth } from '../middleware/auth';
import { validateBody } from '../middleware/validate';

export const authRoutes = Router();

authRoutes.post('/register', validateBody(['email', 'password']), authController.register);
authRoutes.post('/login', validateBody(['email', 'password']), authController.login);

authRoutes.post('/logout', requireAuth, authController.logout);
authRoutes.get('/me', requireAuth, authController.me);
