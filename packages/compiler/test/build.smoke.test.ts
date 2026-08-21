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
  conditionalSnapshot,
  everyComponentSnapshot,
  operatorPipelineSnapshot,
  triggeredMathSnapshot,
  inferredSnapshot,
  pipelineSnapshot,
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
function stop(child: ReturnType<typeof spawn>): void {
  if (child.pid && process.platform === 'win32') {
    try {
      spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
      return;
    } catch {
      /* fall through to the portable path */
    }
  }
  child.kill();
}

afterAll(() => {
  for (const child of children) stop(child);
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
