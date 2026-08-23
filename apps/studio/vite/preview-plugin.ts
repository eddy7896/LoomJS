import { mkdir, readFile, writeFile } from 'node:fs/promises';
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

/** Kept in step with `INTROSPECT_RELATIONS` in `packages/connectors/src/sql.ts`. */
const INTROSPECT_RELATIONS = `
  SELECT tc.table_name, kcu.column_name,
         ccu.table_name AS target_table, ccu.column_name AS target_column
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
  JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
  WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1
`;

/** Kept in step with `INTROSPECT_INDEXES` in `packages/connectors/src/sql.ts`. */
const INTROSPECT_INDEXES = `
  SELECT t.relname AS table_name, a.attname AS column_name, ix.indisunique AS is_unique
  FROM pg_class t
  JOIN pg_namespace n ON n.oid = t.relnamespace
  JOIN pg_index ix ON t.oid = ix.indrelid
  JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ix.indkey[0]
  WHERE n.nspname = $1 AND t.relkind = 'r'
`;

/** Kept in step with `DDL_VERBS` in `packages/connectors/src/ddl.ts`. */
const DDL_VERBS = ['create table', 'alter table', 'drop table', 'create index', 'drop index'];

/** Kept in step with `INTROSPECT_SQL.postgres` in `packages/connectors/src/sql.ts`. */
const INTROSPECT_POSTGRES = `
  SELECT c.table_name, c.column_name, c.data_type, c.is_nullable, c.column_default,
         (pk.column_name IS NOT NULL) AS is_primary
  FROM information_schema.columns c
  LEFT JOIN (
    SELECT kcu.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = $1
  ) pk ON pk.table_name = c.table_name AND pk.column_name = c.column_name
  WHERE c.table_schema = $1
  ORDER BY c.table_name, c.ordinal_position
`;

/**
 * How many documents are read per collection to work out what it holds.
 *
 * Kept in step with `SAMPLE_SIZE` in `packages/connectors/src/firestore.ts`. A schemaless store
 * can only be described by looking, and looking costs a read per document.
 */
const SAMPLE_DOCS = 25;

/**
 * Whether a request came from the studio itself.
 *
 * These endpoints hold the project's credentials and, since D5, run schema changes — and they
 * listen on localhost, where *any* page in the same browser can reach them. A browser attaches
 * `Origin` to every cross-origin request it makes, so a mismatch is refused. Requiring JSON is the
 * second half: a cross-origin JSON POST needs a preflight, and nothing here answers one.
 *
 * A request with no Origin at all is a non-browser client — curl, a test, the studio's own
 * server-side code — and is allowed, because the threat being closed is a page the user did not
 * open on purpose.
 */
function fromStudio(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === (req.headers.host ?? '');
  } catch {
    return false;
  }
}

/** A written-out newline, as it arrives inside a private key that travelled through an env var. */
const BACKSLASH_N = String.fromCharCode(92) + 'n';

/** Preferred port; the child server falls back if it is taken, and reports its real URL. */
export const PREVIEW_PORT = 5174;

const PREVIEW_DIR = fileURLToPath(new URL('../.loom-preview', import.meta.url));

const NEWLINE = String.fromCharCode(10);

/** `apps/studio/.env.local` — the local stand-in for the platform's env bucket. */
const ENV_FILE = fileURLToPath(new URL('../.env.local', import.meta.url));

/**
 * Credentials a module declares as client-scoped. Only these may be handed to the studio's
 * browser; a server-scoped value is read here and never leaves this process
 * (`docs/specs/connector-credentials.md`).
 */
const CLIENT_SCOPED = new Set(['SUPABASE_URL', 'SUPABASE_ANON_KEY']);

/**
 * The credential names this server will report holding. `DATABASE_URL` is never in CLIENT_SCOPED:
 * a connection string carries its own password, so the studio may learn that one exists and never
 * what it is (`docs/specs/connector-credentials.md`).
 */
const HELD = /^(SUPABASE_|DATABASE_URL$|FIREBASE_SERVICE_ACCOUNT$)/;

/**
 * A connection string, scrubbed out of whatever a driver said.
 *
 * `pg` puts the host in its errors and not the password, but "usually not" is not a rule, and an
 * error message travels to a browser and into a screenshot.
 */
function scrub(message: string, secret: string): string {
  const text = secret ? message.split(secret).join('the connection string') : message;
  return text.replace(/(postgres(?:ql)?|mysql):\/\/[^\s'"]+/gi, '$1://…');
}

/** A deliberately small .env reader: KEY=VALUE, # comments, optional surrounding quotes. */
function parseEnvFile(contents: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const rawLine of contents.split(NEWLINE)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const separator = line.indexOf('=');
    if (separator === -1) continue;

    const name = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (name) values[name] = value;
  }

  return values;
}

/**
 * Load `.env.local` into this process. The Preview's server code reads `process.env`, exactly as
 * it will on Vercel, so a file here and an env var there are the same thing by the time the
 * emitted handler runs.
 */
async function loadEnvFile(): Promise<string[]> {
  try {
    const values = parseEnvFile(await readFile(ENV_FILE, 'utf8'));
    for (const [name, value] of Object.entries(values)) {
      if (value) process.env[name] = value;
    }
    return Object.keys(values).filter((name) => values[name]);
  } catch {
    // No file is the normal case: the studio can still be given credentials through the UI.
    return [];
  }
}

interface EmittedFile {
  path: string;
  content: string;
}

/** Only write what actually changed; rewriting every file on each keystroke thrashes HMR. */
const lastWritten = new Map<string, string>();

/**
 * `added` counts files this session had never written before.
 *
 * HMR can absorb a module's *contents* changing. It cannot absorb one appearing: the first time a
 * project uses a message action the compiler emits `src/state/messages.tsx` and rewrites `App.tsx`
 * to wrap the router in its provider, and the running page happily applies the screen's update
 * against an App that has not re-rendered — so the screen calls a hook whose provider is not there
 * yet and the preview goes blank until someone reloads. A new module means a new module graph, and
 * that needs a full reload.
 */
async function writeEmitted(
  files: EmittedFile[],
): Promise<{ written: number; added: number; paths: string[] }> {
  const paths: string[] = [];
  let written = 0;
  let added = 0;

  for (const file of files) {
    if (typeof file?.path !== 'string' || typeof file.content !== 'string') continue;
    const target = resolve(PREVIEW_DIR, ...file.path.split('/'));
    // Emitted paths are compiler-generated, but this writes to disk: never let one escape.
    if (target !== PREVIEW_DIR && !target.startsWith(PREVIEW_DIR + sep)) {
      throw new Error(`Emitted path escapes the preview directory: ${file.path}`);
    }
    if (lastWritten.get(file.path) === file.content) continue;
    if (!lastWritten.has(file.path)) added += 1;

    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content, 'utf8');
    lastWritten.set(file.path, file.content);
    paths.push(target);
    written += 1;
  }

  return { written, added, paths };
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

/** In flight while the emitted app is being written; the Preview waits on it before serving. */
let writing: Promise<void> | undefined;

/** What the last build actually changed, so a repeat of it names the same modules and no others. */
let lastPaths: string[] = [];

export function loomPreview(): Plugin {
  let previewServer: ViteDevServer | undefined;
  let previewUrl = `http://localhost:${PREVIEW_PORT}/`;

  return {
    name: 'loom:preview',
    apply: 'serve',

    async configureServer(server) {
      await activePreview?.close();

      const fileNames = await loadEnvFile();
      if (fileNames.length > 0) {
        server.config.logger.info(`  loom env      ${fileNames.join(', ')} (.env.local)`);
      }

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
      /**
       * While a build is being written, the Preview serves nothing.
       *
       * This is the race that made the first edit after opening look like it did nothing: a page
       * asks for its modules, a build lands mid-flight, and the hot update goes to a page that is
       * not listening yet — so it renders the app from *before* the edit and never hears the
       * correction. Holding requests for the length of a write means a page loads either wholly
       * before it or wholly after it, and there is no in-between state to be caught in.
       *
       * A write is a handful of small files, so the wait is milliseconds.
       */
      previewServer.middlewares.use((_req, _res, next) => {
        if (!writing) return next();
        void writing.then(() => next(), () => next());
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
        if (req.method === 'GET') {
          // Names of everything held, but values only for client-scoped credentials. A service
          // role key is loaded, used by the Preview, and never handed to a browser.
          const names = Object.keys(process.env).filter((name) => HELD.test(name));
          const values: Record<string, string> = {};
          for (const name of names) {
            if (CLIENT_SCOPED.has(name)) values[name] = process.env[name] ?? '';
          }
          json(res, 200, { names: names.sort(), values });
          return;
        }
        if (req.method !== 'POST') return next();
        if (!fromStudio(req)) return json(res, 403, { ok: false, error: 'Not from the studio.' });

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

      /**
       * Schema introspection, run **here** rather than in the browser.
       *
       * A hosted Supabase project serves its PostgREST OpenAPI document only to the
       * `service_role` key ("Only the `service_role` API key can be used for this endpoint"),
       * and that key may never reach a browser (`docs/specs/connector-credentials.md`). So the
       * dev server makes the call with the key it holds and returns the document — table and
       * column names are not secret; the key is. A self-hosted project or a stub that answers
       * the anon key is read directly by the studio and never gets here.
       */
      server.middlewares.use('/__loom/introspect', (req, res, next) => {
        if (req.method !== 'POST') return next();
        if (!fromStudio(req)) return json(res, 403, { ok: false, error: 'Not from the studio.' });

        void (async () => {
          try {
            const body = JSON.parse(await readBody(req)) as { url?: string; key?: string };
            const base = String(body.url ?? '').replace(/\/+$/, '');
            if (!base) return json(res, 200, { ok: false, error: 'No project URL.' });

            // The browser may pass the client-scoped key it already holds; otherwise the
            // server-scoped one is used, and either way only the document travels back.
            const key = body.key || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
            if (!key) {
              return json(res, 200, {
                ok: false,
                error: 'No SUPABASE_SERVICE_ROLE_KEY on the dev server. Add it to .env.local.',
              });
            }

            const response = await fetch(`${base}/rest/v1/`, {
              headers: { apikey: key, authorization: `Bearer ${key}`, accept: 'application/json' },
            });
            const text = await response.text();
            json(res, 200, { ok: response.ok, status: response.status, body: text });
          } catch (error) {
            json(res, 200, { ok: false, error: (error as Error).message });
          }
        })();
      });

      /**
       * Schema introspection over a real connection.
       *
       * A browser cannot open a database socket, so this is not a relay of convenience like the
       * Supabase one above — it is the only place the read can happen. The connection string is
       * held here and answered with names only: tables and columns are not secret, the string is.
       *
       * The query itself is `INTROSPECT_SQL.postgres` in `packages/connectors/src/sql.ts`, copied
       * rather than imported because this file must stay free of workspace imports (see the note
       * at the top). The schema name travels as a parameter, like every other value loom sends.
       */
      server.middlewares.use('/__loom/introspect-sql', (req, res, next) => {
        if (req.method !== 'POST') return next();
        if (!fromStudio(req)) return json(res, 403, { ok: false, error: 'Not from the studio.' });

        void (async () => {
          const body = JSON.parse(await readBody(req)) as {
            connectionString?: string;
            schema?: string;
          };
          // An empty string means "use what you already hold", which is how a DATABASE_URL in
          // .env.local connects without anyone typing it into a browser.
          const connectionString = body.connectionString || process.env.DATABASE_URL || '';
          const schema = String(body.schema || 'public');

          if (!connectionString) {
            return json(res, 200, {
              ok: false,
              error: 'No connection string, and no DATABASE_URL on the dev server.',
            });
          }

          let pool: { query: (text: string, values: unknown[]) => Promise<{ rows: unknown[] }>; end: () => Promise<void> } | undefined;
          try {
            const { Pool } = (await import('pg')) as unknown as {
              Pool: new (config: Record<string, unknown>) => NonNullable<typeof pool>;
            };
            pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000 });
            // Three reads rather than one join: a column that is a foreign key *and* sits in two
            // indexes would come back three times from a single query, and a schema that reports
            // a column three times is worse than one that costs two more round trips.
            const result = await pool.query(INTROSPECT_POSTGRES, [schema]);
            const relations = await pool.query(INTROSPECT_RELATIONS, [schema]);
            const indexes = await pool.query(INTROSPECT_INDEXES, [schema]);
            json(res, 200, {
              ok: true,
              rows: result.rows,
              relations: relations.rows,
              indexes: indexes.rows,
            });
          } catch (error) {
            json(res, 200, { ok: false, error: scrub((error as Error).message, connectionString) });
          } finally {
            // A studio that connects five times in a row should not leave five pools open.
            await pool?.end().catch(() => undefined);
          }
        })();
      });

      /**
       * What a Firestore project holds, learnt by reading it.
       *
       * There is no schema to ask for, so this lists the collections and reads the first few
       * documents of each — which is also why it runs here: the service account holds a private
       * key, and a browser could not open the connection anyway. Only field names and sampled
       * values come back, and the key stays in this process.
       */
      server.middlewares.use('/__loom/introspect-firestore', (req, res, next) => {
        if (req.method !== 'POST') return next();
        if (!fromStudio(req)) return json(res, 403, { ok: false, error: 'Not from the studio.' });

        void (async () => {
          const body = JSON.parse(await readBody(req)) as { serviceAccount?: string };
          // An empty string means "use what you already hold", the same as the SQL endpoint.
          const raw = body.serviceAccount || process.env.FIREBASE_SERVICE_ACCOUNT || '';
          if (!raw) {
            return json(res, 200, {
              ok: false,
              error: 'No service account key, and no FIREBASE_SERVICE_ACCOUNT on the dev server.',
            });
          }

          let app: { name: string } | undefined;
          try {
            const key = JSON.parse(raw) as Record<string, string>;
            const admin = (await import('firebase-admin/app')) as unknown as {
              cert: (account: Record<string, string>) => unknown;
              initializeApp: (options: Record<string, unknown>, name: string) => { name: string };
              deleteApp: (app: { name: string }) => Promise<void>;
            };
            const store = (await import('firebase-admin/firestore')) as unknown as {
              getFirestore: (app: { name: string }) => {
                listCollections: () => Promise<
                  {
                    id: string;
                    limit: (n: number) => {
                      get: () => Promise<{
                        docs: { id: string; data: () => Record<string, unknown> }[];
                      }>;
                    };
                  }[]
                >;
              };
            };

            // A named app per attempt: connecting twice with different keys must not reuse the
            // first one, and the default app would.
            app = admin.initializeApp(
              {
                credential: admin.cert({
                  projectId: key.project_id ?? key.projectId ?? '',
                  clientEmail: key.client_email ?? key.clientEmail ?? '',
                  privateKey: (key.private_key ?? key.privateKey ?? '').split(BACKSLASH_N).join(NEWLINE),
                }),
              },
              `loom-introspect-${Date.now()}`,
            );

            const db = store.getFirestore(app);
            const collections = (await db.listCollections()).slice(0, 50);
            const docs: { collection: string; id: string; fields: Record<string, unknown> }[] = [];

            for (const collection of collections) {
              const page = await collection.limit(SAMPLE_DOCS).get();
              for (const doc of page.docs) {
                docs.push({ collection: collection.id, id: doc.id, fields: doc.data() });
              }
            }

            json(res, 200, { ok: true, docs, projectId: key.project_id ?? key.projectId ?? '' });
          } catch (error) {
            json(res, 200, { ok: false, error: scrub((error as Error).message, raw) });
          } finally {
            if (app) {
              const admin = (await import('firebase-admin/app')) as unknown as {
                deleteApp: (app: { name: string }) => Promise<void>;
              };
              await admin.deleteApp(app).catch(() => undefined);
            }
          }
        })();
      });

      /**
       * A schema change, run against the database the project is connected to.
       *
       * The statements are built in the browser (`packages/connectors/src/ddl.ts`), so this end
       * does not assume they were built there: each one has to be a single statement beginning
       * with a schema verb, and they run inside one transaction so a change that is two
       * statements cannot land half-applied.
       */
      server.middlewares.use('/__loom/apply-schema', (req, res, next) => {
        if (req.method !== 'POST') return next();
        if (!fromStudio(req)) return json(res, 403, { ok: false, error: 'Not from the studio.' });

        void (async () => {
          const body = JSON.parse(await readBody(req)) as { statements?: string[] };
          const statements = (body.statements ?? []).filter(
            (statement) => typeof statement === 'string' && statement.trim() !== '',
          );
          const connectionString = process.env.DATABASE_URL || '';

          if (statements.length === 0) {
            return json(res, 200, { ok: false, error: 'Nothing to apply.' });
          }
          if (!connectionString) {
            return json(res, 200, {
              ok: false,
              error:
                'No DATABASE_URL on the dev server. Schema changes are made over a database ' +
                'connection, so connect one first.',
            });
          }

          for (const statement of statements) {
            const text = statement.trim().toLowerCase();
            if (!DDL_VERBS.some((verb) => text.startsWith(verb))) {
              return json(res, 200, { ok: false, error: 'That is not a schema change.' });
            }
            if (statement.replace(/'(?:[^']|'')*'/g, "''").includes(';')) {
              return json(res, 200, { ok: false, error: 'A schema change is one statement.' });
            }
          }

          let pool:
            | {
                query: (text: string, values?: unknown[]) => Promise<unknown>;
                end: () => Promise<void>;
              }
            | undefined;
          try {
            const { Pool } = (await import('pg')) as unknown as {
              Pool: new (config: Record<string, unknown>) => NonNullable<typeof pool>;
            };
            pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000 });

            // All of it, or none of it.
            await pool.query('begin');
            try {
              for (const statement of statements) await pool.query(statement);
              await pool.query('commit');
            } catch (error) {
              await pool.query('rollback').catch(() => undefined);
              throw error;
            }

            json(res, 200, { ok: true });
          } catch (error) {
            json(res, 200, { ok: false, error: scrub((error as Error).message, connectionString) });
          } finally {
            await pool?.end().catch(() => undefined);
          }
        })();
      });

      /**
       * Rows put into a table so a screen has something to render.
       *
       * The statement is built in the browser with placeholders and the values travel beside it,
       * so this is an ordinary parameterised insert — the same rule every query in loom follows.
       * The check here is that it *is* one: an insert, one statement, values passed separately.
       */
      server.middlewares.use('/__loom/seed', (req, res, next) => {
        if (req.method !== 'POST') return next();
        if (!fromStudio(req)) return json(res, 403, { ok: false, error: 'Not from the studio.' });

        void (async () => {
          const body = JSON.parse(await readBody(req)) as { text?: string; values?: unknown[] };
          const text = String(body.text ?? '').trim();
          const values = body.values ?? [];
          const connectionString = process.env.DATABASE_URL || '';

          if (!text.toLowerCase().startsWith('insert into')) {
            return json(res, 200, { ok: false, error: 'That is not a row to add.' });
          }
          if (text.replace(/'(?:[^']|'')*'/g, "''").includes(';')) {
            return json(res, 200, { ok: false, error: 'Adding rows is one statement.' });
          }
          if (!connectionString) {
            return json(res, 200, { ok: false, error: 'No DATABASE_URL on the dev server.' });
          }

          let pool:
            | { query: (text: string, values?: unknown[]) => Promise<unknown>; end: () => Promise<void> }
            | undefined;
          try {
            const { Pool } = (await import('pg')) as unknown as {
              Pool: new (config: Record<string, unknown>) => NonNullable<typeof pool>;
            };
            pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000 });
            await pool.query(text, values);
            json(res, 200, { ok: true });
          } catch (error) {
            json(res, 200, { ok: false, error: scrub((error as Error).message, connectionString) });
          } finally {
            await pool?.end().catch(() => undefined);
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
            const body = JSON.parse(await readBody(req)) as {
              files?: EmittedFile[];
              /** A repeat of a build nobody was connected to hear the first time. */
              redeliver?: boolean;
            };
            let release = (): void => {};
            writing = new Promise<void>((resolve) => {
              release = resolve;
            });
            const { written, added, paths } = await writeEmitted(body.files ?? []).finally(() => {
              writing = undefined;
              release();
            });

            // A repeat writes nothing — the files are already right — so there is nothing for the
            // watcher to notice and nothing to hot-swap. Saying it again means naming the same
            // modules again, and **only** those: naming every emitted file would name `main.tsx`,
            // which nothing can hot-swap, so the page would reload and throw away whatever the
            // person had done in the running app.
            if (body.redeliver && written === 0) paths.push(...lastPaths);
            else if (written > 0) lastPaths = [...paths];
            // See `writeEmitted`: a module that did not exist a moment ago cannot be hot-swapped
            // into a page that never imported it.
            //
            // A build that lands while the Preview page is still loading reaches nobody — that
            // one is caught on the studio side, which knows when its frame finished loading and
            // what the app was at the time (`src/preview/PreviewWindow.tsx`).
            if (added > 0) {
              previewServer?.ws.send({ type: 'full-reload', path: '*' });
            } else {
              // Only modules a page has actually imported are in the graph, so a repeat naming
              // every emitted file still only wakes the ones being looked at.
              // Say what changed rather than waiting for the file watcher to notice: a watcher
              // still settling at start-up misses these writes entirely, and the studio already
              // knows exactly which files it wrote.
              for (const path of paths) {
                const modules = previewServer?.moduleGraph.getModulesByFile(
                  path.split(sep).join('/'),
                );
                for (const module of modules ?? []) void previewServer?.reloadModule(module);
              }
            }
            // How many pages heard it. A hot update sent to nobody is a Preview that will keep
            // showing the app from before this edit until something reloads it, and the studio
            // cannot see that from its side — so the server says.
            json(res, 200, { ok: true, written, clients: previewServer?.ws.clients.size ?? 0 });
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
