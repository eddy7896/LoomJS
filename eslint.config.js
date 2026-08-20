import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.turbo/**',
      // Emitted app: compiler output, not source.
      '**/.loom-preview/**',
      // Vite writes a transient bundled copy of the config next to it while loading.
      '**/vite.config.ts.timestamp-*',
      '**/test/__golden__/**',
      'landing/**',
      'docs/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Node scripts: test stubs and tooling, not browser code.
    files: ['**/*.mjs', '**/vite/**/*.ts', '**/vite.config.ts', '**/playwright.config.ts'],
    languageOptions: {
      globals: { process: 'readonly', Buffer: 'readonly', console: 'readonly', URL: 'readonly' },
    },
  },
);
