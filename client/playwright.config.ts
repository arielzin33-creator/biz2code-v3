

import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export default defineConfig({
  testDir: './tests',

  workers: 1,
  fullyParallel: false,
  timeout: 150_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],


  webServer: [
    {

      command: 'npx tsx server/index.ts',
      cwd: REPO_ROOT,
      url: 'http://localhost:3001/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: 'ignore',
    },
    {
      command: 'npx vite --port 5173 --strictPort',
      cwd: resolve(REPO_ROOT, 'client'),
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: 'ignore',
    },
  ],
});
