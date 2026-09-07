/* Loads and validates environment variables once, at boot. */

import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '.env') });

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',

  PORT: Number(process.env.PORT ?? 3001),

  DATABASE_URL: required('DATABASE_URL'),
  JWT_SECRET: required('JWT_SECRET'),
  GROQ_API_KEY: required('GROQ_API_KEY'),

  GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? null,




  CLIENT_ORIGIN: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',

  LLM_FEEDBACK_ENABLED: process.env.LLM_FEEDBACK_ENABLED === 'true',  
};
