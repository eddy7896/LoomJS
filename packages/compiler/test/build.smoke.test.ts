import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import { compile } from '../src/index';
import { writeFiles } from '../src/node';
import { pipelineSnapshot, trivialSnapshot } from './fixtures';

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

afterAll(() => {
  for (const child of children) child.kill();
});

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
    const port = 5311;

    const child = spawn(npm, ['run', 'dev', '--', '--port', String(port), '--strictPort'], {
      cwd: dir,
      shell: true,
      stdio: 'ignore',
    });
    children.push(child);

    // Wait for the dev server to answer at all.
    const deadline = Date.now() + 60_000;
    let up = false;
    while (Date.now() < deadline && !up) {
      try {
        await fetch(`http://localhost:${port}/`);
        up = true;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    expect(up).toBe(true);

    const response = await fetch(`http://localhost:${port}/api/shout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: 'quiet words' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: 'QUIET WORDS' });

    child.kill();
  });
});
