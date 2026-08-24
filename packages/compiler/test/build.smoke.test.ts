import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import { compile } from '../src/index';
import { writeFiles } from '../src/node';
import {
  authSnapshot,
  calculatorSnapshot,
  conditionalSnapshot,
  crudSnapshot,
  everyComponentSnapshot,
  firestoreOperationsSnapshot,
  operatorPipelineSnapshot,
  triggeredMathSnapshot,
  inferredSnapshot,
  pipelineSnapshot,
  mysqlSnapshot,
  postgresOperationsSnapshot,
  ssoSnapshot,
  toolSnapshot,
  postgresSnapshot,
  submitSequenceSnapshot,
  supabaseSnapshot,
  trivialSnapshot,
} from './fixtures';

const run = promisify(execFile);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/**
 * The done-when gates, run for real: the emitted app installs and builds (M0), and the emitted
 * serverless function actually answers a request (M3). Slow + networked, so these run only via
 * `pnpm test:smoke` (excluded from the default vitest run).
 */

async function emitProject(snapshot: Parameters<typeof compile>[0]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'loom-smoke-'));
  await writeFiles(compile(snapshot).files, dir, { clean: true });
  await run(npm, ['install', '--no-audit', '--no-fund'], { cwd: dir, shell: true });
  return dir;
}

const children: ReturnType<typeof spawn>[] = [];

/**
 * `npm run dev` starts vite in a shell, so killing the npm process leaves vite holding the port.
 * A stale server serving a previous build is worse than a failure: it answers, and it lies.
 */
async function stop(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.pid && process.platform === 'win32') {
    // And *waited for*: spawning the kill and returning leaves it racing this process's own
    // exit. A run that ended without it left a vite holding a port, and because these servers
    // are started with `--strictPort`, the next run's gate on that port failed to start at all —
    // a green suite turning red for a reason nothing in the failing test could explain.
    await new Promise<void>((resolve) => {
      const killer = spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
      killer.on('close', () => resolve());
      killer.on('error', () => {
        child.kill();
        resolve();
      });
    });
    return;
  }
  child.kill();
}

afterAll(async () => {
  await Promise.all(children.map((child) => stop(child)));
});

/** A fresh port per run, so a leftover server can never answer for this one. */
let nextPort = 5320 + Math.floor(Math.random() * 200);
const takePort = (): number => nextPort++;

async function waitForServer(port: number): Promise<boolean> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://localhost:${port}/`);
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  return false;
}

describe('emitted app builds for real', () => {
  it('installs and builds, and the bundle contains the rendered text', async () => {
    const dir = await emitProject(trivialSnapshot());
    await run(npm, ['run', 'build'], { cwd: dir, shell: true });

    const dist = join(dir, 'dist');
    expect(await readFile(join(dist, 'index.html'), 'utf8')).toContain('<div id="root">');

    const assets = await readdir(join(dist, 'assets'));
    const bundle = assets.find((f) => f.endsWith('.js'));
    expect(bundle).toBeDefined();
    const code = await readFile(join(dist, 'assets', bundle!), 'utf8');
    expect(code).toContain('Hello loomJS');
  });

  it('type-checks every component the studio can place', async () => {
    const dir = await emitProject(everyComponentSnapshot());
    await run(npm, ['run', 'build'], { cwd: dir, shell: true });

    const home = await readFile(join(dir, 'src', 'artboards', 'Home.tsx'), 'utf8');
    // The typed inputs keep their types all the way into the emitted state.
    expect(home).toContain('type="number"');
    expect(home).toContain('type="checkbox"');
    expect(home).toContain('<option');

    // And the design system reached the built app: a token reference in the markup, the
    // project's override in the stylesheet, and the brand faces in the document head.
    expect(home).toContain('var(--loom-color-brand)');
    expect(await readFile(join(dir, 'src', 'theme.css'), 'utf8')).toContain(
      '--loom-color-brand: #0055ff;',
    );
    expect(await readFile(join(dir, 'index.html'), 'utf8')).toContain('Archivo');
  });

  it('type-checks a route body holding every operator step', async () => {
    const dir = await emitProject(operatorPipelineSnapshot());
    await run(npm, ['run', 'build'], { cwd: dir, shell: true });

    const api = await readFile(join(dir, 'api', 'createnotes.ts'), 'utf8');
    expect(api).toContain('const answer = left * right;');
    expect(api).toContain('Number(left) >= Number(right)');
    expect(api).toContain('const answer = left || right;');
  });

  it('type-checks a button-fired derivation with no backend at all', async () => {
    const dir = await emitProject(triggeredMathSnapshot());
    await run(npm, ['run', 'build'], { cwd: dir, shell: true });

    const home = await readFile(join(dir, 'src', 'artboards', 'Home.tsx'), 'utf8');
    expect(home).toContain('const [derived_nd_math, set_derived_nd_math] = useState<number>(0);');
    expect(home).toContain('safeDivide');
    // Nothing here talks to a server: the whole derivation runs in the browser.
    expect(home).not.toContain('fetch(');
  });

  it('type-checks a calculator: four operations, one answer', async () => {
    const dir = await emitProject(calculatorSnapshot());
    await run(npm, ['run', 'build'], { cwd: dir, shell: true });

    const home = await readFile(join(dir, 'src', 'artboards', 'Home.tsx'), 'utf8');
    // One bucket, four writers, one reader — the shape four Texts used to be needed for.
    expect(home.match(/useState<number \| null>\(null\)/g)).toHaveLength(1);
    expect(home.match(/set_state_nd_bucket\(/g)).toHaveLength(4);
    expect(home.match(/state_nd_bucket \?\? ""/g)).toHaveLength(1);
    // No derivation local for a value nothing reads by name: the app builds with noUnusedLocals,
    // so a dead `const` here would fail this very build rather than any assertion below.
    expect(home).not.toContain('derived_nd_math_add,');
    expect(home).not.toContain('fetch(');
  });

  it('type-checks a global variable two screens share, and a running total', async () => {
    // Two gates in one build: the context module and its provider have to type-check, and the
    // screen that only *reads* the total must not drag the other screen's Math node in with it.
    const dir = await emitProject(
      calculatorSnapshot({
        operators: ['add'],
        scope: 'global',
        secondScreen: true,
        runningTotal: true,
      }),
    );
    await run(npm, ['run', 'build'], { cwd: dir, shell: true });

    const globals = await readFile(join(dir, 'src', 'state', 'globals.tsx'), 'utf8');
    expect(globals).toContain('const [answer, set_answer] = useState<number | null>(null);');

    const home = await readFile(join(dir, 'src', 'artboards', 'Home.tsx'), 'utf8');
    // `total = total + b`: the variable is read inside the very handler that writes it.
    expect(home).toContain('set_global_answer((Number((global_answer ?? "")) + Number(field_cp_b)))');

    const report = await readFile(join(dir, 'src', 'artboards', 'Report.tsx'), 'utf8');
    expect(report).toContain('global_answer ?? ""');
    expect(report).not.toContain('field_cp_b');
  });

  it('type-checks a submit sequence: save, clear, confirm, navigate', async () => {
    const dir = await emitProject(submitSequenceSnapshot({ extras: true }));
    await run(npm, ['run', 'build'], { cwd: dir, shell: true });

    const home = await readFile(join(dir, 'src', 'artboards', 'Home.tsx'), 'utf8');
    // An awaited run inside an async handler, a self-dismissing toast, and a `window.open` are
    // three different ways to write TSX that a string match would accept and `tsc` would not.
    expect(home).toContain('onClick={async () => {');
    expect(home).toMatch(/if \(!\(await run_[a-zA-Z0-9_]+\(\)\)\) return;/);
    expect(home).toContain('showMessage({');
    expect(home).toContain('noopener,noreferrer');
    expect(home).toContain('navigator.clipboard?.writeText');
  });

  it('type-checks a screen whose parts appear and restyle with a condition', async () => {
    const dir = await emitProject(conditionalSnapshot());
    await run(npm, ['run', 'build'], { cwd: dir, shell: true });

    const home = await readFile(join(dir, 'src', 'artboards', 'Home.tsx'), 'utf8');
    expect(home).toContain('{isOn(field_cp_agree) ? (');
    expect(home).toContain('...(isOn(field_cp_agree) ?');
    expect(home).toContain('...(!isOn(field_cp_agree) ?');
  });

  it('type-checks and builds an app with a backend pipeline', async () => {
    const dir = await emitProject(pipelineSnapshot());
    // `npm run build` is `tsc --noEmit && vite build`, so this also type-checks the emitted
    // serverless function and the generated pipeline code.
    await run(npm, ['run', 'build'], { cwd: dir, shell: true });
    expect(await readFile(join(dir, 'api', 'shout.ts'), 'utf8')).toContain('toUpperCase');
  });

  it('type-checks an app that reaches a database by SQL rather than by HTTP', async () => {
    // A statement is built as a *string in the emitted file*, so a quoted identifier has to
    // survive being written into one. Nothing but a real `tsc` proves that it did: an emitted
    // `"SELECT * FROM "notes""` reads fine in a diff and does not compile.
    const dir = await emitProject(postgresSnapshot());
    await run(npm, ['run', 'build'], { cwd: dir, shell: true });

    const api = await readFile(join(dir, 'api', 'notes.ts'), 'utf8');
    expect(api).toContain("import { Pool } from 'pg'");
    expect(api).toContain('SELECT * FROM');

    // The driver is installed, and the credential is asked for by name only.
    const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies.pg).toBeDefined();
    expect(await readFile(join(dir, '.env.example'), 'utf8')).toBe('DATABASE_URL=\n');
  });

  it('type-checks a count, a save and a total sharing one connection', async () => {
    // Three routes, one pool, one set of helpers — and each route emitting only the helpers it
    // calls, which `noUnusedLocals` in the emitted project is what proves.
    const dir = await emitProject(postgresOperationsSnapshot());
    await run(npm, ['run', 'build'], { cwd: dir, shell: true });

    expect(await readFile(join(dir, 'api', 'countnotes.ts'), 'utf8')).toContain('SELECT COUNT(*)');
    expect(await readFile(join(dir, 'api', 'upsertnotes.ts'), 'utf8')).toContain('ON CONFLICT');
    expect(await readFile(join(dir, 'api', 'aggregatenotes.ts'), 'utf8')).toContain('SUM(');
  });

  it('type-checks an app that signs in through a provider', async () => {
    // The redirect routes use node:crypto, the URL API and the cookie helpers — none of which a
    // string match in a unit test would have checked.
    const dir = await emitProject(ssoSnapshot());
    await run(npm, ['run', 'build'], { cwd: dir, shell: true });

    const start = await readFile(join(dir, 'api', 'auth', 'start.ts'), 'utf8');
    expect(start).toContain("createHash('sha256')");
    expect(start).toContain('/auth/v1/authorize');

    const callback = await readFile(join(dir, 'api', 'auth', 'callback.ts'), 'utf8');
    expect(callback).toContain('grant_type=pkce');
  });

  it('type-checks an app that talks to MySQL', async () => {
    // MySQL's writes read the row back rather than returning it, which is two statements and a
    // result header — none of which a string match would have type-checked.
    const dir = await emitProject(mysqlSnapshot());
    await run(npm, ['run', 'build'], { cwd: dir, shell: true });

    const insert = await readFile(join(dir, 'api', 'createnote.ts'), 'utf8');
    expect(insert).toContain("import mysql from 'mysql2/promise'");
    expect(insert).toContain('written.insertId');

    const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies.mysql2).toBeDefined();
    expect(pkg.dependencies.pg).toBeUndefined();
  });

  it('type-checks an app whose data lives in a document store', async () => {
    // The Firestore admin SDK is heavily typed, and the emitted code uses its query builder
    // rather than strings — so `tsc` here checks the mapping itself, not just the syntax.
    const dir = await emitProject(firestoreOperationsSnapshot());
    await run(npm, ['run', 'build'], { cwd: dir, shell: true });

    const counted = await readFile(join(dir, 'api', 'countnotes.ts'), 'utf8');
    expect(counted).toContain("import { cert, getApps, initializeApp } from 'firebase-admin/app'");
    expect(counted).toContain('query.count().get()');

    // The document id is the row's identity, added on the way out and never stored as a field.
    const read = await readFile(join(dir, 'api', 'notes.ts'), 'utf8');
    expect(read).toContain('found.docs.map((doc) => ({ id: doc.id, ...doc.data() }))');

    const totalled = await readFile(join(dir, 'api', 'aggregatenotes.ts'), 'utf8');
    expect(totalled).toContain('AggregateField.sum("weight")');

    const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies['firebase-admin']).toBeDefined();
    expect(pkg.dependencies.pg).toBeUndefined();
    expect(await readFile(join(dir, '.env.example'), 'utf8')).toBe(
      'FIREBASE_SERVICE_ACCOUNT=\n',
    );
  });
});

describe('the container server', () => {
  /**
   * The image cannot be built here — there is no Docker in this environment — so what is checked
   * is the half that matters and can be: the server the container's CMD runs. If `npm run start`
   * serves the built app and answers an API route, the Dockerfile is a wrapper around a thing
   * that works; if it does not, no Dockerfile would have saved it.
   */
  it('serves the built app and answers an API route', async () => {
    const stub = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify([{ id: 1, title: 'first note', body: null }]));
    });
    const stubPort = takePort();
    await new Promise<void>((resolve) => stub.listen(stubPort, resolve));

    try {
      const snapshot = supabaseSnapshot();
      snapshot.connectors.cn_supabase!.config = { url: `http://localhost:${stubPort}` };

      const dir = await emitProject(snapshot);
      await run(npm, ['run', 'build'], { cwd: dir, shell: true });

      const port = takePort();
      const child = spawn(npm, ['run', 'start'], {
        cwd: dir,
        shell: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          PORT: String(port),
          SUPABASE_URL: `http://localhost:${stubPort}`,
          SUPABASE_SERVICE_ROLE_KEY: 'stub-service-key',
        },
      });
      children.push(child);

      expect(await waitForServer(port)).toBe(true);

      // The built front end.
      const page = await fetch(`http://localhost:${port}/`);
      expect(page.headers.get('content-type')).toContain('text/html');
      expect(await page.text()).toContain('<div id="root">');

      // A screen that only exists in the browser's router still gets the app, not a 404.
      expect((await fetch(`http://localhost:${port}/somewhere`)).status).toBe(200);

      // And the API route, through the same process.
      const api = await fetch(`http://localhost:${port}/api/notes`, { method: 'POST' });
      expect(await api.json()).toEqual({ result: [{ id: 1, title: 'first note', body: null }] });

      // A route that does not exist says so as JSON rather than handing back the app.
      const missing = await fetch(`http://localhost:${port}/api/nope`);
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({ error: 'No such route.' });

      // And nothing outside the built app is reachable by asking for it.
      const escape = await fetch(`http://localhost:${port}/../package.json`);
      expect(await escape.text()).not.toContain('"devDependencies"');
    } finally {
      stub.close();
    }
  });
});

describe('a tool call answers for real', () => {
  /**
   * The vendor is a stub; everything else is real (T1, `docs/22-api-connectors.md`).
   *
   * The emitted route, the helper it calls through, the headers it sends and the path it reads
   * the answer from are all the shipped ones — exercised without a key and without a bill, which
   * is the same bargain the Supabase gate makes.
   */
  it('sends what the vendor expects and hands back the answer', async () => {
    const seen: { headers: Record<string, string | string[] | undefined>; body: string }[] = [];

    const stub = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        seen.push({ headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
        res.setHeader('content-type', 'application/json');
        // The shape Claude answers with: content blocks, the text in one of them.
        res.end(JSON.stringify({ content: [{ type: 'text', text: 'a stubbed answer' }] }));
      });
    });

    const stubPort = takePort();
    await new Promise<void>((resolve) => stub.listen(stubPort, resolve));

    try {
      // The tool's base URL is the stub's, so nothing leaves the machine.
      const snapshot = toolSnapshot('request', '', {
        url: `http://localhost:${stubPort}/v1/messages`,
        method: 'POST',
      });

      const dir = await emitProject(snapshot);
      await run(npm, ['run', 'build'], { cwd: dir, shell: true });

      const port = takePort();
      const child = spawn(npm, ['run', 'dev', '--', '--port', String(port), '--strictPort'], {
        cwd: dir,
        shell: true,
        stdio: 'ignore',
        env: { ...process.env, TOOL_API_KEY: 'stub-key' },
      });
      children.push(child);

      expect(await waitForServer(port)).toBe(true);

      const answer = await fetch(`http://localhost:${port}/api/ask`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: { prompt: 'hello' } }),
      });
      expect(await answer.json()).toEqual({
        result: { content: [{ type: 'text', text: 'a stubbed answer' }] },
      });

      // The key travelled as a header, from the environment — never in the body, never from the
      // browser.
      expect(seen).toHaveLength(1);
      expect(seen[0]!.headers.authorization).toBe('Bearer stub-key');
      expect(seen[0]!.body).toContain('hello');
      expect(seen[0]!.body).not.toContain('stub-key');
    } finally {
      stub.close();
    }
  });
});

describe('a tool that does not speak JSON', () => {
  /**
   * Stripe and Twilio take form encoding and HTTP basic auth (T2, `docs/22-api-connectors.md`).
   *
   * A preset's address is the vendor's, so this cannot be pointed at a stub the way the generic
   * request tool can — what it checks is that the emitted project *builds* with both, which is
   * where a mistake in either would show up. The encoder's behaviour is checked separately, by
   * running the emitted function itself.
   */
  it('builds with form encoding and basic auth', async () => {
    const dir = await emitProject(toolSnapshot('stripe', 'checkout'));
    await run(npm, ['run', 'build'], { cwd: dir, shell: true });

    // The fixture's route is named for its screen, not for the operation, so this reads whatever
    // route was emitted rather than guessing at a filename.
    const routes = await readdir(join(dir, 'api'));
    const route = await readFile(join(dir, 'api', routes[0]!), 'utf8');
    expect(route).toContain('function formBody(');
    expect(route).toContain('"authorization": "Basic " + Buffer.from(');
    expect(route).toContain('https://api.stripe.com/v1/checkout/sessions');
  });
});

describe('emitted serverless function answers for real', () => {
  it('runs the API route through the dev server the Preview uses', async () => {
    const dir = await emitProject(pipelineSnapshot());
    const port = takePort();

    const child = spawn(npm, ['run', 'dev', '--', '--port', String(port), '--strictPort'], {
      cwd: dir,
      shell: true,
      stdio: 'ignore',
    });
    children.push(child);

    expect(await waitForServer(port)).toBe(true);

    const response = await fetch(`http://localhost:${port}/api/shout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: 'quiet words' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: 'QUIET WORDS' });

    stop(child);
  });
});

/**
 * M4's gate, minus the account: a stub that speaks PostgREST's protocol stands in for a Supabase
 * project, so the emitted app's real `@supabase/supabase-js` calls are exercised end to end.
 * Pointing this at a real project is a URL and a key, nothing more.
 */
describe('emitted app talks to a Supabase-shaped backend', () => {
  it('lists rows and inserts one through the emitted functions', async () => {
    const rows = [{ id: 1, title: 'first note', body: null }];

    const stub = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      res.setHeader('content-type', 'application/json');

      if (req.method === 'GET' && url.pathname === '/rest/v1/notes') {
        res.end(JSON.stringify(rows));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/rest/v1/notes') {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
          const inserted = { id: rows.length + 1, body: null, ...body };
          rows.push(inserted as (typeof rows)[number]);
          res.statusCode = 201;
          // `.single()` asks PostgREST for one object rather than an array, via Accept.
          const wantsObject = (req.headers.accept ?? '').includes('vnd.pgrst.object+json');
          res.end(JSON.stringify(wantsObject ? inserted : [inserted]));
        });
        return;
      }
      res.end(JSON.stringify({ definitions: {} }));
    });

    const stubPort = takePort();
    await new Promise<void>((resolve) => stub.listen(stubPort, resolve));

    try {
      const snapshot = supabaseSnapshot();
      snapshot.connectors.cn_supabase!.config = { url: `http://localhost:${stubPort}` };

      const dir = await mkdtemp(join(tmpdir(), 'loom-smoke-'));
      await writeFiles(compile(snapshot).files, dir, { clean: true });
      await run(npm, ['install', '--no-audit', '--no-fund'], { cwd: dir, shell: true });

      const port = takePort();
      const child = spawn(npm, ['run', 'dev', '--', '--port', String(port), '--strictPort'], {
        cwd: dir,
        shell: true,
        stdio: 'ignore',
        // The env bucket, injected by name — exactly what Vercel does at deploy (M6).
        env: {
          ...process.env,
          SUPABASE_URL: `http://localhost:${stubPort}`,
          SUPABASE_SERVICE_ROLE_KEY: 'stub-service-key',
        },
      });
      children.push(child);

      expect(await waitForServer(port)).toBe(true);

      const read = await fetch(`http://localhost:${port}/api/notes`, { method: 'POST' });
      expect(await read.json()).toEqual({ result: [{ id: 1, title: 'first note', body: null }] });

      const write = await fetch(`http://localhost:${port}/api/createnote`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: { title: 'from the form' } }),
      });
      expect(await write.json()).toEqual({
        result: { id: 2, title: 'from the form', body: null },
      });

      stop(child);
    } finally {
      stub.close();
    }
  });
});

/**
 * M5's gate at the compiler level: the pipeline *inference proposed* is a real backend. Nothing
 * here is written by hand — the document comes out of `inferBackend`, and the same compiler that
 * handles a hand-wired graph emits it.
 */
describe('a CRUD resource runs for real', () => {
  /**
   * P4's gate: create, list, edit, delete and search one table, through the emitted functions.
   *
   * The stub speaks PostgREST including its filter grammar (`col=eq.1`, `col=ilike.*term*`),
   * because the emitted client is the real `@supabase/postgrest-js` and the point is that it
   * cannot tell the difference.
   */
  it('creates, searches, edits and deletes through the emitted functions', async () => {
    let rows: Record<string, unknown>[] = [{ id: 1, title: 'first note', body: null }];
    let nextId = 2;

    const matches = (row: Record<string, unknown>, url: URL): boolean => {
      for (const [column, raw] of url.searchParams) {
        if (['select', 'order', 'limit', 'offset'].includes(column)) continue;
        const [operator, ...rest] = String(raw).split('.');
        const value = rest.join('.');
        const actual = row[column];
        if (operator === 'eq' && String(actual) !== value) return false;
        if (operator === 'ilike') {
          const needle = value.replace(/[*%]/g, '').toLowerCase();
          if (!String(actual ?? '').toLowerCase().includes(needle)) return false;
        }
      }
      return true;
    };

    const body = async (req: Parameters<Parameters<typeof createServer>[0]>[0]) =>
      new Promise<Record<string, unknown>>((resolve) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {});
        });
      });

    const stub = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      res.setHeader('content-type', 'application/json');
      if (url.pathname !== '/rest/v1/notes') {
        res.end(JSON.stringify({ definitions: {} }));
        return;
      }

      const one = (req.headers.accept ?? '').includes('vnd.pgrst.object+json');
      const selected = rows.filter((row) => matches(row, url));

      if (req.method === 'GET') {
        res.end(JSON.stringify(selected));
        return;
      }
      if (req.method === 'POST') {
        void body(req).then((posted) => {
          const inserted = { id: nextId++, body: null, ...posted };
          rows.push(inserted);
          res.statusCode = 201;
          res.end(JSON.stringify(one ? inserted : [inserted]));
        });
        return;
      }
      if (req.method === 'PATCH') {
        void body(req).then((patch) => {
          for (const row of selected) Object.assign(row, patch);
          res.end(JSON.stringify(one ? selected[0] : selected));
        });
        return;
      }
      if (req.method === 'DELETE') {
        rows = rows.filter((row) => !selected.includes(row));
        res.end(JSON.stringify(one ? selected[0] : selected));
        return;
      }
      res.statusCode = 405;
      res.end(JSON.stringify({ message: 'no' }));
    });

    const stubPort = takePort();
    await new Promise<void>((resolve) => stub.listen(stubPort, resolve));

    try {
      const snapshot = crudSnapshot({ search: true, pageSize: 2 });
      snapshot.connectors.cn_supabase!.config = {
        url: `http://localhost:${stubPort}`,
        schema: (snapshot.connectors.cn_supabase!.config as { schema: unknown }).schema,
      };

      const dir = await mkdtemp(join(tmpdir(), 'loom-smoke-'));
      await writeFiles(compile(snapshot).files, dir, { clean: true });
      await run(npm, ['install', '--no-audit', '--no-fund'], { cwd: dir, shell: true });

      const port = takePort();
      const child = spawn(npm, ['run', 'dev', '--', '--port', String(port), '--strictPort'], {
        cwd: dir,
        shell: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          SUPABASE_URL: `http://localhost:${stubPort}`,
          SUPABASE_SERVICE_ROLE_KEY: 'stub-service-key',
        },
      });
      children.push(child);
      expect(await waitForServer(port)).toBe(true);

      const call = async (route: string, input?: unknown) => {
        const response = await fetch(`http://localhost:${port}/api/${route}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input === undefined ? {} : { input }),
        });
        return (await response.json()) as { result?: unknown; error?: string };
      };

      // Create.
      const created = (await call('createnote', { title: 'buy milk' })).result as { id: number };
      expect(created.id).toBe(2);

      // Search — the filter value travels as a route input, keyed by column name.
      const found = (await call('notes', { title: 'milk' })).result as { title: string }[];
      expect(found).toHaveLength(1);
      expect(found[0]!.title).toBe('buy milk');

      // An empty search narrows nothing, rather than matching nothing.
      expect((await call('notes', { title: '' })).result).toHaveLength(2);

      // Edit.
      const edited = (await call('editnote', { id: created.id, title: 'buy oat milk' })).result as {
        title: string;
      };
      expect(edited.title).toBe('buy oat milk');

      // Delete, and it is gone from the list.
      await call('removenote', { id: created.id });
      expect((await call('notes', { title: '' })).result).toHaveLength(1);

      // An update with no row named is refused rather than rewriting the table.
      expect((await call('editnote', { title: 'nope' })).error).toMatch(/needs the row/);
    } finally {
      stub.close();
    }
  });
});

describe('an app with users runs for real', () => {
  /**
   * P5's gate: sign up, sign in, be recognised, be answered as yourself, and sign out — through
   * the emitted functions, against a stub that speaks GoTrue and PostgREST.
   *
   * The stub enforces the thing the design rests on: a request carrying a person's access token
   * sees that person's rows, and a request carrying only the publishable key sees none. If the
   * emitted route ever went back to the service-role key, every row would come back and this
   * would fail.
   */
  it('signs someone up, in, and out, and answers as them in between', async () => {
    const ANON = 'stub-anon-key';
    const accounts = new Map<string, { id: string; password: string }>();
    const tokens = new Map<string, string>(); // access token -> user id
    const rows = [
      { id: 1, title: 'ada note', body: null, owner: 'user-1' },
      { id: 2, title: 'grace note', body: null, owner: 'user-2' },
    ];

    const body = async (req: Parameters<Parameters<typeof createServer>[0]>[0]) =>
      new Promise<Record<string, unknown>>((resolve) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {});
        });
      });

    // A token that carries its own expiry, because the emitted server reads `exp` to decide when
    // to spend the refresh token. Unsigned: nothing in this test verifies it, and neither does
    // the emitted code — only Supabase does.
    const mint = (userId: string): string => {
      const claims = Buffer.from(
        JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + 3600 }),
      ).toString('base64url');
      const token = `header.${claims}.signature`;
      tokens.set(token, userId);
      return token;
    };

    const sessionFor = (userId: string, email: string) => ({
      access_token: mint(userId),
      refresh_token: `refresh-${userId}`,
      token_type: 'bearer',
      expires_in: 3600,
      user: { id: userId, email },
    });

    const stub = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      res.setHeader('content-type', 'application/json');
      const bearer = (req.headers.authorization ?? '').replace(/^Bearer /, '');
      const who = tokens.get(bearer);

      if (url.pathname === '/auth/v1/signup') {
        void body(req).then((posted) => {
          const email = String(posted.email ?? '');
          const id = `user-${accounts.size + 1}`;
          accounts.set(email, { id, password: String(posted.password ?? '') });
          res.statusCode = 200;
          res.end(JSON.stringify(sessionFor(id, email)));
        });
        return;
      }

      if (url.pathname === '/auth/v1/token') {
        void body(req).then((posted) => {
          if (url.searchParams.get('grant_type') === 'refresh_token') {
            res.end(JSON.stringify(sessionFor('user-1', 'ada@example.com')));
            return;
          }
          const email = String(posted.email ?? '');
          const account = accounts.get(email);
          if (!account || account.password !== String(posted.password ?? '')) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'invalid_grant', error_description: 'no' }));
            return;
          }
          res.statusCode = 200;
          res.end(JSON.stringify(sessionFor(account.id, email)));
        });
        return;
      }

      if (url.pathname === '/auth/v1/user') {
        if (!who) {
          res.statusCode = 401;
          res.end(JSON.stringify({ message: 'no' }));
          return;
        }
        const email = [...accounts].find(([, account]) => account.id === who)?.[0] ?? '';
        res.end(JSON.stringify({ id: who, email }));
        return;
      }

      if (url.pathname === '/auth/v1/logout') {
        tokens.delete(bearer);
        res.statusCode = 204;
        res.end('');
        return;
      }

      if (url.pathname === '/rest/v1/notes') {
        // Row-level security, in one line: you see your own rows, and a request with only the
        // publishable key sees none.
        res.end(JSON.stringify(who ? rows.filter((row) => row.owner === who) : []));
        return;
      }

      res.end(JSON.stringify({ definitions: {} }));
    });

    const stubPort = takePort();
    await new Promise<void>((resolve) => stub.listen(stubPort, resolve));

    try {
      const snapshot = authSnapshot();
      snapshot.connectors.cn_supabase!.config = {
        url: `http://localhost:${stubPort}`,
        schema: (snapshot.connectors.cn_supabase!.config as { schema: unknown }).schema,
      };

      const dir = await emitProject(snapshot);
      // The auth modules are the ones a dev server would never typecheck, so this gate does:
      // `npm run build` is `tsc --noEmit && vite build`, and the emitted app builds with
      // noUnusedLocals.
      await run(npm, ['run', 'build'], { cwd: dir, shell: true });

      const port = takePort();
      const child = spawn(npm, ['run', 'dev', '--', '--port', String(port), '--strictPort'], {
        cwd: dir,
        shell: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          SUPABASE_URL: `http://localhost:${stubPort}`,
          SUPABASE_ANON_KEY: ANON,
        },
      });
      children.push(child);
      expect(await waitForServer(port)).toBe(true);

      const base = `http://localhost:${port}`;
      let jar = '';
      const call = async (route: string, payload?: unknown) => {
        const response = await fetch(`${base}${route}`, {
          method: payload === undefined ? 'GET' : 'POST',
          headers: {
            ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
            ...(jar ? { cookie: jar } : {}),
          },
          body: payload === undefined ? undefined : JSON.stringify(payload),
        });
        const cookies = response.headers.getSetCookie?.() ?? [];
        if (cookies.length > 0) {
          jar = cookies.map((cookie) => cookie.split(';')[0]).join('; ');
        }
        return { response, body: (await response.json()) as Record<string, unknown> };
      };

      // Nobody, before anyone signs in.
      expect((await call('/api/auth/session')).body.user).toBeNull();

      // Sign up. The tokens come back as cookies the browser could not read.
      const signup = await call('/api/auth/signup', {
        email: 'ada@example.com',
        password: 'correct horse',
      });
      const setCookie = signup.response.headers.getSetCookie?.() ?? [];
      expect(setCookie.join(' ')).toContain('HttpOnly');
      expect(setCookie.join(' ')).toContain('SameSite=Lax');
      expect(signup.body.user).toMatchObject({ email: 'ada@example.com' });

      // Signed in, and answered as themselves: their row, and not the other one.
      const mine = (await call('/api/notes', { title: '' })).body.result as { title: string }[];
      expect(mine).toHaveLength(1);
      expect(mine[0]!.title).toBe('ada note');

      // A wrong password is refused, and says nothing about whether the address exists.
      const wrong = await call('/api/auth/signin', {
        email: 'ada@example.com',
        password: 'wrong',
      });
      expect(wrong.response.status).toBe(401);

      // Signing back in works, and so does signing out.
      jar = '';
      const back = await call('/api/auth/signin', {
        email: 'ada@example.com',
        password: 'correct horse',
      });
      expect(back.body.user).toMatchObject({ email: 'ada@example.com' });
      expect((await call('/api/auth/session')).body.user).toMatchObject({ id: 'user-1' });

      await call('/api/auth/signout', {});
      expect((await call('/api/auth/session')).body.user).toBeNull();
      // And with nobody signed in, the route sees nothing rather than everything.
      expect((await call('/api/notes', { title: '' })).body.result).toHaveLength(0);
    } finally {
      stub.close();
    }
  });
});

describe('an inferred backend runs for real', () => {
  it('validates on the server and inserts the row the form filled', async () => {
    const rows: Record<string, unknown>[] = [];

    const stub = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      res.setHeader('content-type', 'application/json');

      if (req.method === 'POST' && url.pathname === '/rest/v1/notes') {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
          const inserted = { id: rows.length + 1, body: null, ...body };
          rows.push(inserted);
          res.statusCode = 201;
          const wantsObject = (req.headers.accept ?? '').includes('vnd.pgrst.object+json');
          res.end(JSON.stringify(wantsObject ? inserted : [inserted]));
        });
        return;
      }
      res.end(JSON.stringify({ definitions: {} }));
    });

    const stubPort = takePort();
    await new Promise<void>((resolve) => stub.listen(stubPort, resolve));

    try {
      const { snapshot } = inferredSnapshot();
      snapshot.connectors.cn_supabase!.config = { url: `http://localhost:${stubPort}` };

      const dir = await mkdtemp(join(tmpdir(), 'loom-smoke-'));
      await writeFiles(compile(snapshot).files, dir, { clean: true });
      await run(npm, ['install', '--no-audit', '--no-fund'], { cwd: dir, shell: true });
      // `npm run build` is `tsc --noEmit && vite build`: the inferred code type-checks too.
      await run(npm, ['run', 'build'], { cwd: dir, shell: true });

      const port = takePort();
      const child = spawn(npm, ['run', 'dev', '--', '--port', String(port), '--strictPort'], {
        cwd: dir,
        shell: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          SUPABASE_URL: `http://localhost:${stubPort}`,
          SUPABASE_SERVICE_ROLE_KEY: 'stub-service-key',
        },
      });
      children.push(child);

      expect(await waitForServer(port)).toBe(true);

      const created = await fetch(`http://localhost:${port}/api/createnotes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: { title: 'inferred row', body: '' } }),
      });
      expect(created.status).toBe(200);
      expect(await created.json()).toEqual({ result: { id: 1, title: 'inferred row', body: null } });

      // An empty optional column is left out rather than written as an empty string.
      expect(rows[0]).toEqual({ id: 1, title: 'inferred row', body: null });

      // The required check is server-side, so an empty title never reaches the table.
      const rejected = await fetch(`http://localhost:${port}/api/createnotes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: { title: '', body: 'orphan' } }),
      });
      expect(rejected.status).toBe(500);
      expect(await rejected.json()).toEqual({ error: 'title is required.' });
      expect(rows).toHaveLength(1);

      stop(child);
    } finally {
      stub.close();
    }
  });
});
