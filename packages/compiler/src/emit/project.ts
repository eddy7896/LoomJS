import type { EmittedFile } from '../types';

/**
 * The emitted app's fixed scaffold: a real Vite + React + TypeScript SPA (docs/07 — the V1
 * compile target). Pinned versions keep golden-file tests and the build smoke test honest.
 */

export const TARGET_DEPS = {
  react: '^18.3.1',
  'react-dom': '^18.3.1',
} as const;

export const TARGET_DEV_DEPS = {
  '@types/react': '^18.3.12',
  '@types/react-dom': '^18.3.1',
  '@vitejs/plugin-react': '^4.3.4',
  typescript: '^5.6.3',
  vite: '^5.4.11',
} as const;

/** `My Project` -> `my-project`; always a legal npm package name. */
export function npmName(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'loom-app';
}

export function scaffoldFiles(projectName: string, appTitle: string): EmittedFile[] {
  const pkg = {
    name: npmName(projectName),
    private: true,
    version: '0.0.0',
    type: 'module',
    scripts: {
      dev: 'vite',
      build: 'tsc --noEmit && vite build',
      preview: 'vite preview',
    },
    dependencies: { ...TARGET_DEPS },
    devDependencies: { ...TARGET_DEV_DEPS },
  };

  const tsconfig = {
    compilerOptions: {
      target: 'ES2020',
      lib: ['ES2020', 'DOM', 'DOM.Iterable'],
      module: 'ESNext',
      moduleResolution: 'Bundler',
      jsx: 'react-jsx',
      strict: true,
      noUnusedLocals: true,
      noUnusedParameters: true,
      noEmit: true,
      isolatedModules: true,
      skipLibCheck: true,
      resolveJsonModule: true,
    },
    include: ['src', 'vite.config.ts'],
  };

  return [
    { path: 'package.json', content: `${JSON.stringify(pkg, null, 2)}\n` },
    { path: 'tsconfig.json', content: `${JSON.stringify(tsconfig, null, 2)}\n` },
    {
      path: 'vite.config.ts',
      content: `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
`,
    },
    {
      path: 'index.html',
      content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${appTitle}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
    },
    {
      path: 'src/main.tsx',
      content: `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
`,
    },
    {
      path: 'src/index.css',
      content: `:root {
  font-family: Archivo, system-ui, sans-serif;
  line-height: 1.5;
  color: #111111;
  background: #ffffff;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
}
`,
    },
    { path: '.gitignore', content: 'node_modules\ndist\n' },
  ];
}
