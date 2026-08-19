import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { loomPreview } from './vite/preview-plugin';

export default defineConfig({
  plugins: [react(), loomPreview()],
  server: { port: 5173 },
  test: { environment: 'jsdom', include: ['test/**/*.test.ts?(x)'] },
});
