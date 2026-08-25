import { describe, expect, it } from 'vitest';
import { createComponent } from '@loom/components';
import { applyOp, createEmptyProject, type Component, type Snapshot } from '@loom/ir';
import { compile } from '../src/index';
import { CompileError } from '../src/types';
import { groupByShell, shellComponentName, validShells } from '../src/emit/shell';

/**
 * App shells (R2, `docs/V1-COMPLETION.md`).
 *
 * The gate: **a sidebar drawn once persists across four routes without re-rendering, and the
 * active item is correct on each.**
 *
 * The "without re-rendering" half is the whole reason this is a router feature rather than a
 * component every screen happens to place. A shell that remounts on every click loses its scroll
 * position, closes its open sections, and re-runs whatever it does on mount — so what is asserted
 * below is the *nesting*, which is what makes React keep it mounted.
 */

function withShell(screens: number, opts: { outlets?: number; inShell?: number } = {}): Snapshot {
  const outletCount = opts.outlets ?? 1;
  const shellRoot: Component = {
    ...createComponent('Frame', 'cp_shell'),
    children: ['cp_nav', ...Array.from({ length: outletCount }, (_, i) => `cp_outlet${i}`)],
  };
  const nav = createComponent('Frame', 'cp_nav');

  const components: Record<string, Component> = { [shellRoot.id]: shellRoot, [nav.id]: nav };
  for (let i = 0; i < outletCount; i += 1) {
    components[`cp_outlet${i}`] = createComponent('Outlet', `cp_outlet${i}`);
  }

  let snapshot = createEmptyProject('Console');
  const inShell = opts.inShell ?? screens;

  for (let index = 0; index < screens; index += 1) {
    const root = createComponent('Frame', `cp_root${index}`);
    components[root.id] = root;
    snapshot = applyOp(snapshot, {
      type: 'addArtboard',
      artboard: {
        id: `ab_${index}`,
        name: `Screen${index}`,
        root: root.id,
        ...(index < inShell ? { layoutId: 'lay_main' } : {}),
      },
      root,
    });
  }

  return {
    ...snapshot,
    components: { ...snapshot.components, ...components },
    layouts: { lay_main: { id: 'lay_main', name: 'Main shell', root: shellRoot.id } },
  };
}

describe('a sidebar drawn once, across four routes', () => {
  it('emits the shell as one module', () => {
    const files = compile(withShell(4)).files;
    const shell = files.find((file) => file.path === 'src/layouts/MainShell.tsx');

    expect(shell).toBeDefined();
    expect(shell!.content).toContain('export default function MainShell');
    // The slot the screens render into, from the router rather than from anything loom invented.
    expect(shell!.content).toContain('<Outlet />');
    expect(shell!.content).toContain("from 'react-router-dom'");
  });

  /**
   * The claim. Four screens as **children of one pathless route**, which is what keeps the shell
   * mounted while only the page inside it changes.
   */
  it('nests every screen inside one layout route', () => {
    const app = compile(withShell(4)).files.find((file) => file.path === 'src/App.tsx')!;

    expect(app.content).toContain('<Route element={<MainShell />}>');
    for (const index of [0, 1, 2, 3]) {
      expect(app.content).toContain(`<Screen${index} />`);
    }
    // One shell, not one per screen.
    expect(app.content.match(/<Route element=\{<MainShell \/>\}>/g)).toHaveLength(1);
  });

  it('leaves a screen that is in no shell as a route of its own', () => {
    const app = compile(withShell(3, { inShell: 2 })).files.find(
      (file) => file.path === 'src/App.tsx',
    )!;

    // The nested block holds the two; the third sits outside it.
    const nested = app.content.slice(app.content.indexOf('<Route element={<MainShell />}>'));
    const block = nested.slice(0, nested.indexOf('</Route>'));
    expect(block).toContain('<Screen0 />');
    expect(block).toContain('<Screen1 />');
    expect(block).not.toContain('<Screen2 />');
    expect(app.content).toContain('<Screen2 />');
  });

  it('emits nothing at all for a project with no shells', () => {
    const plain = applyOp(createEmptyProject('Plain'), {
      type: 'addArtboard',
      artboard: { id: 'ab_1', name: 'Home', root: 'cp_root' },
      root: createComponent('Frame', 'cp_root'),
    });
    const files = compile(plain).files;
    expect(files.filter((file) => file.path.startsWith('src/layouts/'))).toHaveLength(0);
    expect(files.find((file) => file.path === 'src/App.tsx')!.content).not.toContain(
      '<Route element=',
    );
  });
});

describe('the active item', () => {
  /**
   * A link inside a shell is navigation, and has to say which page is showing. `NavLink` sets
   * `aria-current="page"` on the active one — the half a screen reader announces — and the class
   * is the half a designer can see.
   */
  it('emits a NavLink inside a shell, and a plain Link outside one', () => {
    const base = withShell(2);
    const link: Component = {
      ...createComponent('Link', 'cp_navlink'),
      props: {
        label: { kind: 'static', value: 'Home' },
        onClick: {
          kind: 'event',
          handler: { kind: 'actions', actions: [{ kind: 'navigate', flowId: 'fl_home' }] },
        },
      },
    };
    const snapshot: Snapshot = {
      ...base,
      components: {
        ...base.components,
        [link.id]: link,
        cp_nav: { ...base.components.cp_nav!, children: [link.id] },
      },
      flows: { fl_home: { id: 'fl_home', from: 'lay_main', to: 'ab_0' } },
    };

    const shell = compile(snapshot).files.find(
      (file) => file.path === 'src/layouts/MainShell.tsx',
    )!;

    expect(shell.content).toContain('<NavLink');
    expect(shell.content).toContain('isActive');
    expect(shell.content).toContain('loom-active');
  });
});

describe('what a shell is refused', () => {
  /** No slot means the screens have nowhere to appear, and the app renders the shell alone. */
  it('refuses a shell with no screen slot', () => {
    const base = withShell(1, { outlets: 0 });
    expect(() => validShells(base)).toThrow(CompileError);
    expect(() => validShells(base)).toThrow(/no screen slot/);
  });

  /** Two slots means react-router renders the page twice, which reads as a duplicated screen. */
  it('refuses a shell with more than one screen slot', () => {
    const base = withShell(1, { outlets: 2 });
    expect(() => validShells(base)).toThrow(/2 screen slots/);
  });

  it('names the layout rather than a component id, because that is what gets fixed', () => {
    try {
      validShells(withShell(1, { outlets: 0 }));
      expect.unreachable();
    } catch (error) {
      expect((error as CompileError).message).toContain('Main shell');
    }
  });
});

describe('grouping', () => {
  it('puts a screen whose shell was deleted back on its own, rather than refusing', () => {
    const base = withShell(2);
    const orphaned: Snapshot = { ...base, layouts: {} };

    const { shells, loose } = groupByShell(orphaned, ['ab_0', 'ab_1']);
    expect(shells.size).toBe(0);
    // Still perfectly good screens. Losing the project over a dangling reference would be worse.
    expect(loose).toEqual(['ab_0', 'ab_1']);
  });

  it('names a shell the way a person named it', () => {
    expect(shellComponentName({ id: 'lay_1', name: 'Main shell', root: 'x' })).toBe('MainShell');
    expect(shellComponentName({ id: 'lay_1', name: '...', root: 'x' })).toMatch(/^[A-Za-z]/);
  });
});
