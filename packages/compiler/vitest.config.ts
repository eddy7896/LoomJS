import { defineConfig } from 'vitest/config';

// The smoke test runs a real `npm install` + `vite build` on the emitted repo.
// Too slow for the default loop; run it with `pnpm test:smoke`.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/**/*.smoke.test.ts', 'node_modules/**'],
  },
});
