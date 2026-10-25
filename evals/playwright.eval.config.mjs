// Playwright config for the graded eval: runs the regression specs ShakeFix generated from each
// scenario's replay (evals/.work/<run>/<scenario>/*.spec.ts) against BASE_URL. Same browser settings as
// the repo's playwright.config.ts (390×844, reduced motion, UTC), no web server (run.mjs starts SplitPal).
import { defineConfig, devices } from '@playwright/test';

const viewport = { width: 390, height: 844 };

export default defineConfig({
  testDir: process.env.EVAL_SPEC_DIR || 'evals/.work',
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 20_000,
  expect: { timeout: 4_000 },
  reporter: [['json', { outputFile: process.env.EVAL_REPORT || 'evals/.work/report.json' }]],
  use: {
    baseURL: process.env.BASE_URL,
    viewport,
    reducedMotion: 'reduce',
    timezoneId: 'UTC',
    locale: 'en-US',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport, reducedMotion: 'reduce', timezoneId: 'UTC' } }],
});
