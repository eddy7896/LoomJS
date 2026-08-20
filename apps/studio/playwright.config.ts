import { defineConfig } from '@playwright/test';

const PORT = 5199;
const STUB_PORT = 5412;

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
  webServer: [
    {
      command: `npx vite --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      // Never reuse: a server left over from an earlier run answers happily while serving code
      // from before the change under test, which is worse than a failure.
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      // Stands in for a Supabase project, speaking PostgREST's protocol (see e2e/stub-postgrest.mjs).
      command: `node e2e/stub-postgrest.mjs`,
      url: `http://localhost:${STUB_PORT}/rest/v1/`,
      // Fresh rows per run, so one spec's insert cannot leak into another's expectations.
      reuseExistingServer: false,
      timeout: 30_000,
      env: { STUB_PORT: String(STUB_PORT) },
    },
  ],
});
