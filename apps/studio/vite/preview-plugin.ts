import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import react from '@vitejs/plugin-react';
import { createServer, type Plugin, type ViteDevServer } from 'vite';
// Imported by source path, not by package name: Vite bundles the config file and externalizes
// bare specifiers, and Node cannot then load a workspace package whose entry is raw TypeScript.
import { CompileError, compile, type EmittedFile } from '../../../packages/compiler/src/index';
import { writeFiles } from '../../../packages/compiler/src/node';
import { SnapshotSchema, createTrivialSnapshot } from '../../../packages/ir/src/index';

/**
 * Preview run model (M1 decision): the studio dev server compiles the snapshot to disk and a
 * **second Vite dev server** rooted at that directory serves the emitted app into an iframe.
 * The Preview therefore runs *real compiler output* — a compiler bug shows up here, which is
 * the whole point of wiring editor -> compiler -> Preview in M1.
 *
 * The preview directory lives inside apps/studio so the emitted app resolves react/react-dom
 * from the studio's own node_modules — no install step per compile.
 */

/** Preferred port; the child server falls back if it is taken, and reports its real URL. */
export const PREVIEW_PORT = 5174;

const PREVIEW_DIR = fileURLToPath(new URL('../.loom-preview', import.meta.url));

/** Only write what actually changed; rewriting every file on each keystroke thrashes HMR. */
const lastWritten = new Map<string, string>();

async function emitToDisk(files: EmittedFile[]): Promise<void> {
  const changed = files.filter((f) => lastWritten.get(f.path) !== f.content);
  if (changed.length === 0) return;
  await writeFiles(changed, PREVIEW_DIR);
  for (const file of changed) lastWritten.set(file.path, file.content);
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

export function loomPreview(): Plugin {
  let previewServer: ViteDevServer | undefined;
  let previewUrl = `http://localhost:${PREVIEW_PORT}/`;

  return {
    name: 'loom:preview',
    apply: 'serve',

    async configureServer(server) {
      // Seed the directory so the child server has an index.html to boot from.
      await emitToDisk(compile(createTrivialSnapshot()).files);

      previewServer = await createServer({
        root: PREVIEW_DIR,
        configFile: false,
        plugins: [react()],
        server: { port: PREVIEW_PORT },
        // The emitted app has no node_modules of its own; deps resolve from apps/studio.
        cacheDir: `${PREVIEW_DIR}/.vite`,
      });
      await previewServer.listen();
      previewUrl = previewServer.resolvedUrls?.local[0] ?? previewUrl;
      server.config.logger.info(`  loom preview  ${previewUrl}`);

      server.middlewares.use('/__loom/preview', (req, res, next) => {
        if (req.method === 'GET') {
          json(res, 200, { url: previewUrl });
          return;
        }
        if (req.method !== 'POST') return next();

        void (async () => {
          try {
            const snapshot = SnapshotSchema.parse(JSON.parse(await readBody(req)));
            await emitToDisk(compile(snapshot).files);
            json(res, 200, { ok: true });
          } catch (error) {
            // A compile failure is the Build error tier, not a transport failure: answer 200
            // with the diagnostic so the studio can pin it to the offending entity.
            if (error instanceof CompileError) {
              json(res, 200, { ok: false, error: error.message, entityId: error.entityId });
              return;
            }
            json(res, 200, { ok: false, error: (error as Error).message });
          }
        })();
      });

      const close = (): void => void previewServer?.close();
      server.httpServer?.once('close', close);
      process.once('exit', close);
    },

    async closeBundle() {
      await previewServer?.close();
    },
  };
}
