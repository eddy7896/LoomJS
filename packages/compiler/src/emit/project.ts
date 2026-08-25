import { FONT_STYLESHEET, componentsCss, themeCss, type ThemeOverrides } from '@loom/ui';
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
  /** Adds the Supabase REST client, which only a project reaching Supabase needs. */
  usesDatabase?: boolean;
  /** Adds the Postgres driver, for a project that talks to a database directly. */
  usesSql?: boolean;
  /** Adds the Firebase admin SDK, for a project whose data lives in Firestore. */
  usesFirestore?: boolean;
  /** Adds the MySQL driver, for a project whose database speaks that dialect. */
  usesMysql?: boolean;
  /** The project's token overrides, emitted into its stylesheet. */
  theme?: ThemeOverrides;
  /**
   * The phone-layout stylesheet (L3), when anything in the project has one. Absent means no file
   * and no import — a project nobody has given a phone layout carries no bytes for one.
   */
  responsiveCss?: string;
  /** The print stylesheet (L2), when the project has any document at all. Same rule. */
  printCss?: string;
  /**
   * Packages something else decided this project needs — a bucket's SDK, today.
   *
   * Passed in rather than switched on here: which SDK an upload needs is the bucket manifest's
   * business, and duplicating that list in the scaffolder would be two places to update the day a
   * provider changes (`docs/29-storage.md`).
   */
  extraDependencies?: Readonly<Record<string, string>>;
}

export function scaffoldFiles(
  projectName: string,
  appTitle: string,
  options: ScaffoldOptions = {},
): EmittedFile[] {
  const theme = options.theme ?? {};
  const sqlTypes = options.usesSql ? { '@types/pg': '^8.11.10' } : {};
  const pkg = {
    name: npmName(projectName),
    private: true,
    version: '0.0.0',
    type: 'module',
    scripts: {
      dev: 'vite',
      build: 'tsc --noEmit && vite build',
      preview: 'vite preview',
      // What a container runs, and what anyone can run locally to see the built app served the
      // way it will be served (docs/18-containers.md).
      start: 'tsx server.ts',
    },
    dependencies: {
      ...TARGET_DEPS,
      ...(options.usesDatabase ? { '@supabase/postgrest-js': '^2.112.3' } : {}),
      // Only what this project actually reaches for: a Supabase app never installs a driver it
      // does not open, and a Postgres app never carries a REST client it does not call.
      ...(options.usesSql ? { pg: '^8.13.1' } : {}),
      ...(options.usesMysql ? { mysql2: '^3.11.4' } : {}),
      ...(options.usesFirestore ? { 'firebase-admin': '^13.0.0' } : {}),
      ...(options.extraDependencies ?? {}),
      // The server runs the emitted TypeScript directly: the handlers import each other without
      // file extensions, which Node's own ESM loader requires and a compile step would have to
      // rewrite. One dependency beats a second build configuration.
      tsx: '^4.19.2',
    },
    devDependencies: { ...TARGET_DEV_DEPS, ...sqlTypes },
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
      // The variants, as ordinary CSS in the project's own tokens (`docs/27-variants.md`). The
      // studio's canvas is painted by this same string, which is what stops the two disagreeing.
      path: 'src/components.css',
      content: componentsCss(),
    },
    ...(options.printCss
      ? [
          {
            // Paper (`docs/V1-COMPLETION.md` L2): the page size, and hiding everything that is not
            // the document. Its own file, because it is the only stylesheet that is about a medium
            // rather than about this project's decisions.
            path: 'src/print.css',
            content: options.printCss,
          },
        ]
      : []),
    ...(options.responsiveCss
      ? [
          {
            // Phone overrides (`docs/V1-COMPLETION.md` L3). Its own file rather than a tail on
            // `components.css`, because that one is the design system and this one is this
            // project's decisions about its own screens.
            path: 'src/responsive.css',
            content: options.responsiveCss,
          },
        ]
      : []),
    {
      path: 'src/index.css',
      content: `@import './theme.css';
@import './components.css';
${options.printCss ? `@import './print.css';\n` : ''}${options.responsiveCss ? `@import './responsive.css';\n` : ''}
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
