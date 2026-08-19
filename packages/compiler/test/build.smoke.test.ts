import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { compile, writeFiles } from '../src/index';
import { trivialSnapshot } from './fixtures';

const run = promisify(execFile);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/**
 * M0's done-when gate: `compiler.compile(fixture) -> /out`, then `npm i && npm run build`
 * succeeds and the built app contains the rendered text. Slow + networked, so it runs only
 * via `pnpm test:smoke` (excluded from the default vitest run).
 */
describe('emitted app builds for real', () => {
  it('installs and builds, and the bundle contains the rendered text', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'loom-smoke-'));
    const { files } = compile(trivialSnapshot());
    await writeFiles(files, dir, { clean: true });

    await run(npm, ['install', '--no-audit', '--no-fund'], { cwd: dir, shell: true });
    await run(npm, ['run', 'build'], { cwd: dir, shell: true });

    const dist = join(dir, 'dist');
    expect(await readFile(join(dist, 'index.html'), 'utf8')).toContain('<div id="root">');

    const assets = await readdir(join(dist, 'assets'));
    const bundle = assets.find((f) => f.endsWith('.js'));
    expect(bundle).toBeDefined();
    const code = await readFile(join(dist, 'assets', bundle!), 'utf8');
    expect(code).toContain('Hello loomJS');
  });
});
