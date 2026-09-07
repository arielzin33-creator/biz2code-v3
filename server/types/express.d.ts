

import type { ProjectRow } from '../services/project.service';

declare global {
  namespace Express {
    interface Request {
      userId?: number;
      project?: ProjectRow;
    }
  }
}

export {};
