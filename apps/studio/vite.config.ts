import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { loomPreview } from './vite/preview-plugin';

const pkg = (path: string): string => fileURLToPath(new URL(`../../packages/${path}`, import.meta.url));

/**
 * Workspace packages ship raw TypeScript (their package entry *is* `src/index.ts`), which Node
 * cannot load. Aliasing them to their source files keeps every consumer — the client bundle,
 * Vitest, and the Preview plugin's SSR load — inside Vite's transform pipeline instead of
 * handing a `.ts` file to Node as an external. Most specific alias first.
 */
const workspaceAliases = [
  { find: '@loom/compiler/node', replacement: pkg('compiler/src/node.ts') },
  { find: '@loom/compiler', replacement: pkg('compiler/src/index.ts') },
  { find: '@loom/components', replacement: pkg('components/src/index.ts') },
  { find: '@loom/connectors', replacement: pkg('connectors/src/index.ts') },
  { find: '@loom/typesys', replacement: pkg('typesys/src/index.ts') },
  { find: '@loom/ir', replacement: pkg('ir/src/index.ts') },
];

export default defineConfig({
  plugins: [react(), loomPreview()],
  server: { port: 5173 },
  resolve: { alias: workspaceAliases },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts?(x)'],
    exclude: ['e2e/**', '.loom-preview/**', 'node_modules/**'],
  },
});
