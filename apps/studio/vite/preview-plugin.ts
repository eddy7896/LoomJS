import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import react from '@vitejs/plugin-react';
import { createServer, type Plugin, type ViteDevServer } from 'vite';

/**
 * Preview run model (M1 decision): a **second Vite dev server** serves the emitted app into an
 * iframe, so the Preview runs real compiler output — including the emitted serverless functions,
 * which the dev-api middleware below mounts with the same signature Vercel uses (M3).
 *
 * The studio **compiles in the browser** and posts the emitted files here; this plugin only
 * writes them. That keeps the compiler on one side of the wire (where its Build errors can be
 * shown against the offending node immediately) and keeps this file free of workspace imports,
 * which Vite would externalise into raw TypeScript that Node cannot load.
 *
 * The preview directory lives inside apps/studio so the emitted app resolves its dependencies
 * from the studio's own node_modules — no install step per compile. That is why the studio
 * depends on what the emitted app may import (react, react-router-dom, the Supabase REST client):
 * it is hosting them for the Preview, not using them itself.
 */

/** Preferred port; the child server falls back if it is taken, and reports its real URL. */
export const PREVIEW_PORT = 5174;

const PREVIEW_DIR = fileURLToPath(new URL('../.loom-preview', import.meta.url));

const NEWLINE = String.fromCharCode(10);

interface EmittedFile {
  path: string;
  content: string;
}

/** Only write what actually changed; rewriting every file on each keystroke thrashes HMR. */
const lastWritten = new Map<string, string>();

async function writeEmitted(files: EmittedFile[]): Promise<number> {
  let written = 0;

  for (const file of files) {
    if (typeof file?.path !== 'string' || typeof file.content !== 'string') continue;
    const target = resolve(PREVIEW_DIR, ...file.path.split('/'));
    // Emitted paths are compiler-generated, but this writes to disk: never let one escape.
    if (target !== PREVIEW_DIR && !target.startsWith(PREVIEW_DIR + sep)) {
      throw new Error(`Emitted path escapes the preview directory: ${file.path}`);
    }
    if (lastWritten.get(file.path) === file.content) continue;

    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content, 'utf8');
    lastWritten.set(file.path, file.content);
    written += 1;
  }

  return written;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

/**
 * Vite restarts the dev server in place when its config changes, which runs `configureServer`
 * again on the *same* http server — so the previous child never gets a close event. Tracking it
 * here means a restart replaces the Preview instead of leaking a server (and a port) each time.
 */
let activePreview: ViteDevServer | undefined;

export function loomPreview(): Plugin {
  let previewServer: ViteDevServer | undefined;
  let previewUrl = `http://localhost:${PREVIEW_PORT}/`;

  return {
    name: 'loom:preview',
    apply: 'serve',

    async configureServer(server) {
      await activePreview?.close();

      // Seed a bare app so the child server has an index.html to boot from before the first
      // compile arrives from the studio.
      await writeEmitted(seedFiles());

      previewServer = await createServer({
        root: PREVIEW_DIR,
        configFile: false,
        plugins: [react(), devApi()],
        server: { port: PREVIEW_PORT },
        cacheDir: `${PREVIEW_DIR}/.vite`,
      });
      await previewServer.listen();
      activePreview = previewServer;
      previewUrl = previewServer.resolvedUrls?.local[0] ?? previewUrl;
      server.config.logger.info(`  loom preview  ${previewUrl}`);

      /**
       * The env bucket, injected by name (`docs/specs/connector-credentials.md`). The Preview's
       * server code reads `process.env`, exactly as it will on Vercel, so the values are set on
       * this process and mirrored into a gitignored `.env.local` for anything that reads one.
       * Values arrive from the studio and are never written into the emitted source.
       */
      server.middlewares.use('/__loom/env', (req, res, next) => {
        if (req.method !== 'POST') return next();

        void (async () => {
          try {
            const body = JSON.parse(await readBody(req)) as { env?: Record<string, string> };
            const env = body.env ?? {};
            for (const [name, value] of Object.entries(env)) {
              if (typeof value === 'string') process.env[name] = value;
            }
            const lines = Object.entries(env)
              .map(([name, value]) => `${name}=${String(value).split(NEWLINE).join('')}`)
              .join(NEWLINE);
            await mkdir(PREVIEW_DIR, { recursive: true });
            await writeFile(resolve(PREVIEW_DIR, '.env.local'), lines + NEWLINE, 'utf8');
            // The emitted handlers are cached modules; drop them so the next call re-reads env.
            previewServer?.moduleGraph.invalidateAll();
            json(res, 200, { ok: true, names: Object.keys(env) });
          } catch (error) {
            json(res, 200, { ok: false, error: (error as Error).message });
          }
        })();
      });

      server.middlewares.use('/__loom/preview', (req, res, next) => {
        if (req.method === 'GET') {
          json(res, 200, { url: previewUrl });
          return;
        }
        if (req.method !== 'POST') return next();

        void (async () => {
          try {
            const body = JSON.parse(await readBody(req)) as { files?: EmittedFile[] };
            const written = await writeEmitted(body.files ?? []);
            json(res, 200, { ok: true, written });
          } catch (error) {
            json(res, 200, { ok: false, error: (error as Error).message });
          }
        })();
      });

      const close = (): void => {
        void previewServer?.close();
        if (activePreview === previewServer) activePreview = undefined;
      };
      server.httpServer?.once('close', close);
      process.once('exit', close);
    },

    async closeBundle() {
      await previewServer?.close();
    },
  };
}

/** Serves api/*.ts through the same handler signature Vercel uses. */
function devApi(): Plugin {
  return {
    name: 'loom:preview-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        if (!url.startsWith('/api/')) return next();
        const name = url.slice('/api/'.length).split('?')[0];

        void (async () => {
          try {
            const module = await server.ssrLoadModule(`/api/${name}.ts`);
            await (module.default as (req: IncomingMessage, res: ServerResponse) => Promise<void>)(
              req,
              res,
            );
          } catch (error) {
            json(res, 500, { error: (error as Error).message });
          }
        })();
      });
    },
  };
}

/** The minimum the child server needs before the studio's first compile lands. */
function seedFiles(): EmittedFile[] {
  return [
    {
      path: 'index.html',
      content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Preview</title>
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
      content: `const root = document.getElementById('root');
if (root) root.textContent = 'Waiting for the first compile…';
export {};
`,
    },
  ];
}
