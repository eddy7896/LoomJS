import { FONT_STYLESHEET, themeCss, type ThemeOverrides } from '@loom/ui';
import type { EmittedFile } from '../types';
import { DEV_API_PLUGIN } from './server';

/**
 * The emitted app's fixed scaffold: a real Vite + React + TypeScript SPA (docs/07 — the V1
 * compile target). Pinned versions keep golden-file tests and the build smoke test honest.
 */

export const TARGET_DEPS = {
  react: '^18.3.1',
  'react-dom': '^18.3.1',
  'react-router-dom': '^6.28.0',
} as const;

export const TARGET_DEV_DEPS = {
  '@types/node': '^20.11.0',
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

export interface ScaffoldOptions {
  /** Adds the Supabase client, which only a project with database nodes needs. */
  usesDatabase?: boolean;
  /** The project's token overrides, emitted into its stylesheet. */
  theme?: ThemeOverrides;
}

export function scaffoldFiles(
  projectName: string,
  appTitle: string,
  options: ScaffoldOptions = {},
): EmittedFile[] {
  const theme = options.theme ?? {};
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
    dependencies: {
      ...TARGET_DEPS,
      ...(options.usesDatabase ? { '@supabase/postgrest-js': '^2.112.3' } : {}),
    },
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
    include: ['src', 'api', 'vite.config.ts'],
  };

  return [
    { path: 'package.json', content: `${JSON.stringify(pkg, null, 2)}\n` },
    { path: 'tsconfig.json', content: `${JSON.stringify(tsconfig, null, 2)}\n` },
    {
      path: 'vite.config.ts',
      content: `import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
${DEV_API_PLUGIN}
export default defineConfig({
  plugins: [react(), loomDevApi()],
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
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="stylesheet" href="${FONT_STYLESHEET}" />
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
      // The design system, as the app's own custom properties. Restyling the whole project is a
      // change here, because every styled property emits `var(--loom-…)` rather than a value.
      path: 'src/theme.css',
      content: themeCss(theme),
    },
    {
      path: 'src/index.css',
      content: `@import './theme.css';

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: var(--loom-font-body);
  line-height: 1.5;
  color: var(--loom-color-ink);
  background: var(--loom-color-surface);
}

code,
pre {
  font-family: var(--loom-font-mono);
}
`,
    },
    { path: '.gitignore', content: 'node_modules\ndist\n' },
  ];
}
