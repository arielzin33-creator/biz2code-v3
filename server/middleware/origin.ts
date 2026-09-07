

import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function checkOrigin(req: Request, res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();

  const origin = req.get('origin');
  if (!origin) return next();              
  if (origin === env.CLIENT_ORIGIN) return next();

  return res.status(403).json({ error: 'Cross-origin request refused' });
}
