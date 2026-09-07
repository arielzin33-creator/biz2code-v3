

import type { Request, Response, NextFunction } from 'express';


export class AppError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}


function statusOf(err: Error): number {
  if (err instanceof AppError) return err.status;
  const claimed = (err as { status?: unknown; statusCode?: unknown });
  for (const value of [claimed.status, claimed.statusCode]) {
    if (typeof value === 'number' && value >= 400 && value < 500) return value;
  }
  return 500;
}


const CLIENT_ERROR_TEXT: Record<number, string> = {
  400: 'The request body could not be read.',
  413: 'The request body is too large.',
  415: 'Unsupported content type.',
};

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
  const status = statusOf(err);


  if (status >= 500) {
    console.error(err);
    res.status(status).json({ error: 'Internal error' });
    return;
  }

  const message = err instanceof AppError
    ? err.message
    : CLIENT_ERROR_TEXT[status] ?? 'Bad request.';
  res.status(status).json({ error: message });
}
