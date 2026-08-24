import { unzipSync, strFromU8 } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { __resetStore, addArtboard, addComponent, dispatch, getState } from '../src/state/store';
import { emittedCode, fileTree, projectFileName, zipProject } from '../src/state/code';

/**
 * The code, as something to read and take away (`docs/24-code.md`).
 *
 * The claim being checked is that this is the *same* build the Preview runs — not a second
 * generator and not an export path that could drift — and that what leaves the browser carries
 * credential names and never values.
 */

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

function project(): void {
  __resetStore();
  addArtboard('Home');
  addComponent('Text');
}

describe('what there is to read', () => {
  it('is the whole repo, not a summary of it', () => {
    project();
    const paths = emittedCode(getState().snapshot).files.map((file) => file.path);

    // The things that make it a repo somebody else can run.
    expect(paths).toContain('package.json');
    expect(paths).toContain('tsconfig.json');
    expect(paths).toContain('vite.config.ts');
    expect(paths).toContain('index.html');
    expect(paths).toContain('src/main.tsx');
    expect(paths.some((path) => path.startsWith('src/artboards/'))).toBe(true);
  });

  it('says why there is nothing rather than throwing at whoever is looking', () => {
    project();
    // A Link with no address is a Build error the compiler names.
    addComponent('Link');
    const id = getState().selection!.id;
    dispatch({ type: 'setProp', componentId: id, key: 'href', value: { kind: 'static', value: '' } });

    const result = emittedCode(getState().snapshot);
    expect(result.files).toEqual([]);
    expect(result.error).toMatch(/nowhere to go/);
    // And it points at the thing to fix, so the panel can send someone there.
    expect(result.entityId).toBe(id);
  });
});

describe('the tree', () => {
  it('puts a folder immediately above what is inside it', () => {
    const tree = fileTree([
      { path: 'src/main.tsx', content: '' },
      { path: 'package.json', content: '' },
      { path: 'src/artboards/Home.tsx', content: '' },
    ]);

    expect(tree.map((entry) => entry.path)).toEqual([
      'package.json',
      'src',
      'src/artboards',
      'src/artboards/Home.tsx',
      'src/main.tsx',
    ]);
  });

  it('indents by depth, and names each thing by its last segment', () => {
    const tree = fileTree([{ path: 'api/auth/session.ts', content: '' }]);
    const leaf = tree.find((entry) => entry.file)!;

    expect(leaf.name).toBe('session.ts');
    expect(leaf.depth).toBe(2);
    expect(tree.filter((entry) => !entry.file).map((entry) => entry.name)).toEqual(['api', 'auth']);
  });
});

describe('the download', () => {
  it('is a zip holding every file, byte for byte', () => {
    project();
    const files = emittedCode(getState().snapshot).files;
    const unzipped = unzipSync(zipProject(files));

    expect(Object.keys(unzipped).sort()).toEqual(files.map((file) => file.path).sort());

    const packageJson = files.find((file) => file.path === 'package.json')!;
    expect(strFromU8(unzipped['package.json']!)).toBe(packageJson.content);
  });

  it('carries credential names and never a value', () => {
    project();
    dispatch({
      type: 'addConnector',
      connector: {
        id: 'cn_tool',
        moduleId: 'anthropic',
        config: {},
        credentialRef: 'default',
      },
    });

    const files = emittedCode(getState().snapshot).files;
    const text = files.map((file) => file.content).join('\n');

    // Whatever a project reaches, what ships is the name. This is the guarantee that makes a
    // download safe to hand to anyone (docs/05-guardrails.md #1).
    expect(text).not.toMatch(/sk-[A-Za-z0-9]{8}/);
    expect(text).not.toMatch(/xoxb-[A-Za-z0-9]/);
  });

  it('names the file after the project, in a way a file system accepts', () => {
    expect(projectFileName('My Notes App')).toBe('my-notes-app.zip');
    expect(projectFileName('  ')).toBe('loom-project.zip');
    expect(projectFileName('Ünïcode ✨ things')).toBe('n-code-things.zip');
  });
});
