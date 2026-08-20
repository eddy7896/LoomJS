import { defineConfig } from '@playwright/test';

const PORT = 5199;

/**
 * E2E for the editor loop (docs/09 — Playwright from M1). The webServer is the real studio dev
 * server, which starts the Preview's child Vite server as a side effect, so these specs exercise
 * editor -> compiler -> Preview exactly as a designer would.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
