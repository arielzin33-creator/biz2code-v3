

import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { errorHandler } from './middleware/error';
import { checkOrigin } from './middleware/origin';
import { authRoutes } from './routes/auth.routes';
import { projectRoutes } from './routes/project.routes';
import { answerRoutes } from './routes/answer.routes';
import { phaseRoutes } from './routes/phase.routes';
import { documentRoutes } from './routes/document.routes';
import { env } from './config/env';
import { query } from './db/query';

export const app = express();


app.disable('x-powered-by');


app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'", 'ws:', 'wss:'],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
    },
  },
  hsts: env.NODE_ENV === 'production',
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
app.use(express.json());
app.use(cookieParser());   

app.use(checkOrigin);


app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'biz2code' }));


app.get('/api/ready', async (_req, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true, database: 'up' });
  } catch {
    res.status(503).json({ ok: false, database: 'down' });
  }
});


const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many attempts. Wait a few minutes and try again.' },
});

app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);

app.use('/api/projects/:projectId/answers', answerRoutes);
app.use('/api/projects/:projectId/phases', phaseRoutes);
app.use('/api/projects/:projectId/documents', documentRoutes);

app.use(errorHandler);
