import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CompileError, compile } from '../src/index';
import { writeFiles } from '../src/node';
import { applyOps } from '@loom/ir';
import { supabaseSnapshot, trivialSnapshot } from './fixtures';

const byPath = (files: { path: string; content: string }[], path: string): string => {
  const found = files.find((f) => f.path === path);
  if (!found)
    throw new Error(`no emitted file at ${path}. Got: ${files.map((f) => f.path).join(', ')}`);
  return found.content;
};

describe('compile(trivial snapshot)', () => {
  it('emits a complete Vite + React + TS repo', () => {
    const { files } = compile(trivialSnapshot());
    expect(files.map((f) => f.path).sort()).toEqual(
      [
        '.gitignore',
        'index.html',
        'package.json',
        'src/App.tsx',
        'src/artboards/Home.tsx',
        'src/index.css',
        'src/main.tsx',
        'src/components.css',
        'src/theme.css',
        'tsconfig.json',
        'vite.config.ts',
        // Somewhere to run it that is not a platform (C1, `docs/18-containers.md`). Every project
        // gets these: they are four small files, and "the repo is yours" means it runs anywhere.
        'server.ts',
        'Dockerfile',
        '.dockerignore',
        'docker-compose.yml',
        // Every project explains itself, written from what it actually is (`docs/25-readme.md`).
        'README.md',
        // The one thing emitted whether or not the project asks for it (L1): a render error that
        // is not caught takes the whole page with it, and insurance added after the crash is not
        // insurance.
        'src/state/boundary.tsx',
        // Compared as a set: the emitted order is the compiler's business, and pinning it here
        // makes every new file a two-line edit for no reader's benefit.
      ].sort(),
    );
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
    expect(home).toContain('<span className="loom-text loom-text--body">{"Hello loomJS"}</span>');
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
    // A type nobody has ever implemented. This used to say "Carousel", which stopped being a
    // useful example of an unknown type the day the vocabulary grew one (`docs/28-media.md`).
    snapshot.components.cp_text000001!.type = 'Hologram';
    expect(() => compile(snapshot)).toThrow(/No template for component type "Hologram"/);
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

describe('a Table renders rows as a table', () => {
  const withTable = (props: Record<string, unknown>): string => {
    const base = supabaseSnapshot();
    const snapshot = applyOps(base, [
      {
        type: 'addComponent',
        parentId: 'cp_root000001',
        component: {
          id: 'cp_table',
          type: 'Table',
          name: 'Notes table',
          props: {
            items: { kind: 'bound', source: { nodeId: 'nd_read', portId: 'pt_result' } },
            ...Object.fromEntries(
              Object.entries(props).map(([key, value]) => [key, { kind: 'static', value }]),
            ),
          },
        },
      },
    ]);
    const file = compile(snapshot).files.find((entry) => entry.path === 'src/artboards/Home.tsx');
    return file!.content;
  };

  it('names its columns once, so every row lines up', () => {
    const home = withTable({ columns: 'title, body', empty: 'Nothing yet' });
    expect(home).toContain('["title","body"]');
    expect(home).toContain('<thead>');
    expect(home).toContain('borderCollapse');
  });

  it('falls back to what the first row carries when no columns were named', () => {
    const home = withTable({ columns: '' });
    // Worked out once, so a row missing a field cannot reorder the columns after it.
    expect(home).toContain('Object.keys(');
  });

  it('renders the empty text rather than an empty grid', () => {
    expect(withTable({ columns: 'title', empty: 'No notes yet' })).toContain('"No notes yet"');
  });
});
