import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CompileError, compile } from '../src/index';
import { writeFiles } from '../src/node';
import { trivialSnapshot } from './fixtures';

const byPath = (files: { path: string; content: string }[], path: string): string => {
  const found = files.find((f) => f.path === path);
  if (!found)
    throw new Error(`no emitted file at ${path}. Got: ${files.map((f) => f.path).join(', ')}`);
  return found.content;
};

describe('compile(trivial snapshot)', () => {
  it('emits a complete Vite + React + TS repo', () => {
    const { files } = compile(trivialSnapshot());
    expect(files.map((f) => f.path)).toEqual([
      '.gitignore',
      'index.html',
      'package.json',
      'src/App.tsx',
      'src/artboards/Home.tsx',
      'src/index.css',
      'src/main.tsx',
      'tsconfig.json',
      'vite.config.ts',
    ]);
  });

  it('emits the artboard as a React component with flex layout and the text content', () => {
    const { files } = compile(trivialSnapshot());
    const home = byPath(files, 'src/artboards/Home.tsx');

    expect(home).toContain('export default function Home()');
    expect(home).toContain('display: "flex"');
    expect(home).toContain('flexDirection: "column"');
    expect(home).toContain('gap: 16');
    expect(home).toContain('padding: 24');
    expect(home).toContain('alignItems: "stretch"');
    expect(home).toContain('justifyContent: "flex-start"');
    expect(home).toContain('<span>{"Hello loomJS"}</span>');
  });

  it('is byte-for-byte stable across runs (golden)', async () => {
    const { files } = compile(trivialSnapshot());
    await expect(byPath(files, 'src/artboards/Home.tsx')).toMatchFileSnapshot(
      './__golden__/Home.tsx.txt',
    );
    await expect(byPath(files, 'src/App.tsx')).toMatchFileSnapshot('./__golden__/App.tsx.txt');
    await expect(byPath(files, 'package.json')).toMatchFileSnapshot(
      './__golden__/package.json.txt',
    );
  });

  it('points App at the entry artboard', () => {
    const { files } = compile(trivialSnapshot());
    expect(byPath(files, 'src/App.tsx')).toContain("import Home from './artboards/Home'");
  });
});

describe('compile errors (Build tier)', () => {
  it('rejects a project with no artboards', () => {
    const snapshot = { ...trivialSnapshot(), artboards: {} };
    expect(() => compile(snapshot)).toThrow(CompileError);
  });

  it('rejects a dangling entryArtboard', () => {
    const snapshot = { ...trivialSnapshot(), entryArtboard: 'ab_missing' };
    expect(() => compile(snapshot)).toThrow(/does not exist/);
  });

  it('rejects an unknown component type and names the known ones', () => {
    const snapshot = trivialSnapshot();
    snapshot.components.cp_text000001!.type = 'Carousel';
    expect(() => compile(snapshot)).toThrow(/No template for component type "Carousel"/);
  });

  it('rejects a bound property until the binding runtime lands (M3)', () => {
    const snapshot = trivialSnapshot();
    snapshot.components.cp_text000001!.props.content = {
      kind: 'bound',
      source: { nodeId: 'nd_x', portId: 'pt_x' },
    };
    const error = (() => {
      try {
        compile(snapshot);
      } catch (e) {
        return e as CompileError;
      }
    })();
    expect(error).toBeInstanceOf(CompileError);
    expect(error!.entityId).toBe('cp_text000001');
  });

  it('rejects a component reachable twice (cycle)', () => {
    const snapshot = trivialSnapshot();
    snapshot.components.cp_root000001!.children = ['cp_text000001', 'cp_text000001'];
    expect(() => compile(snapshot)).toThrow(/appears twice/);
  });
});

describe('writeFiles', () => {
  it('writes the emitted set to disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'loom-emit-'));
    const { files } = compile(trivialSnapshot());
    await writeFiles(files, dir, { clean: true });
    const written = await readFile(join(dir, 'src', 'artboards', 'Home.tsx'), 'utf8');
    expect(written).toContain('export default function Home()');
  });

  it('refuses a path that escapes the output directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'loom-emit-'));
    await expect(writeFiles([{ path: '../escaped.txt', content: 'no' }], dir)).rejects.toThrow(
      /escapes the output directory/,
    );
  });
});
