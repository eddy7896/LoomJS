import { describe, expect, it } from 'vitest';
import { createComponent } from '@loom/components';
import { applyOp, createEmptyProject, type Component, type Snapshot } from '@loom/ir';
import { compile } from '../src/index';
import { CompileError } from '../src/types';
import { definitionComponentName, orderDefinitions } from '../src/emit/definition';

/**
 * Reusable components (R1, `docs/V1-COMPLETION.md`).
 *
 * The gate: **a header is defined once, placed on three screens, edited once, and all three
 * change.** That sentence is only true if the instances are *references* — so the assertions below
 * are mostly about there being one definition of the thing and three calls to it, rather than
 * three copies that happen to look alike.
 */

/** A project with one definition and `count` screens that each place an instance of it. */
function withDefinition(count: number, params: { name: string; type: 'text' }[] = []): Snapshot {
  const definitionRoot: Component = {
    ...createComponent('Frame', 'cp_defroot'),
    children: ['cp_deftext'],
  };
  const definitionText: Component = {
    ...createComponent('Text', 'cp_deftext'),
    props: params.length
      ? { content: { kind: 'param', name: params[0]!.name } }
      : { content: { kind: 'static', value: 'Acme' } },
  };

  let snapshot = createEmptyProject('Shared');
  const components: Record<string, Component> = {
    [definitionRoot.id]: definitionRoot,
    [definitionText.id]: definitionText,
  };

  for (let index = 0; index < count; index += 1) {
    const root: Component = {
      ...createComponent('Frame', `cp_root${index}`),
      children: [`cp_inst${index}`],
    };
    const instance: Component = {
      ...createComponent('Instance', `cp_inst${index}`),
      props: {
        defId: { kind: 'static', value: 'def_header' },
        ...(params.length
          ? { [params[0]!.name]: { kind: 'static' as const, value: `Screen ${index}` } }
          : {}),
      },
    };
    components[root.id] = root;
    components[instance.id] = instance;

    snapshot = applyOp(snapshot, {
      type: 'addArtboard',
      artboard: { id: `ab_${index}`, name: `Screen${index}`, root: root.id },
      root,
    });
  }

  return {
    ...snapshot,
    components: { ...snapshot.components, ...components },
    definitions: {
      def_header: {
        id: 'def_header',
        name: 'Site header',
        root: definitionRoot.id,
        params: params.map((param) => ({ name: param.name, type: { kind: 'text' as const } })),
      },
    },
  };
}

describe('defined once, used everywhere', () => {
  it('emits one real React component, with a real name', () => {
    const files = compile(withDefinition(3)).files;
    const module = files.find((file) => file.path === 'src/components/SiteHeader.tsx');

    expect(module).toBeDefined();
    expect(module!.content).toContain('export default function SiteHeader');
  });

  /** The gate: three screens, one definition. Not three copies that happen to look alike. */
  it('is one definition and three calls to it, not three trees', () => {
    const files = compile(withDefinition(3)).files;

    const modules = files.filter((file) => file.path.startsWith('src/components/'));
    expect(modules).toHaveLength(1);

    for (const index of [0, 1, 2]) {
      const screen = files.find((file) => file.path.endsWith(`Screen${index}.tsx`))!;
      // A call to the component, and the import that makes it resolve.
      expect(screen.content).toContain('<SiteHeader');
      expect(screen.content).toContain("import SiteHeader from '../components/SiteHeader';");
      // The definition's own contents are emitted once, in the component — never inlined here.
      expect(screen.content).not.toContain('Acme');
    }
  });

  it('passes params as real props, with real types', () => {
    const snapshot = withDefinition(2, [{ name: 'title', type: 'text' }]);
    const files = compile(snapshot).files;

    const module = files.find((file) => file.path === 'src/components/SiteHeader.tsx')!;
    // Destructured and typed, the way a developer would have written it.
    expect(module.content).toContain('{ title }: { title?: string }');

    const screen = files.find((file) => file.path.endsWith('Screen0.tsx'))!;
    expect(screen.content).toContain('title={"Screen 0"}');
  });

  it('emits nothing at all for a project with no definitions', () => {
    const plain = applyOp(createEmptyProject('Plain'), {
      type: 'addArtboard',
      artboard: { id: 'ab_1', name: 'Home', root: 'cp_root' },
      root: createComponent('Frame', 'cp_root'),
    });
    expect(
      compile(plain).files.filter((file) => file.path.startsWith('src/components/')),
    ).toHaveLength(0);
  });
});

describe('what a definition is refused', () => {
  /**
   * A component holding itself never finishes rendering. Without this the failure is a stack
   * overflow in the emitted app at run time — a crash with no line number and no relation to the
   * decision that caused it.
   */
  it('refuses a component that contains itself', () => {
    const base = withDefinition(1);
    const selfRef: Component = {
      ...createComponent('Instance', 'cp_self'),
      props: { defId: { kind: 'static', value: 'def_header' } },
    };
    const snapshot: Snapshot = {
      ...base,
      components: {
        ...base.components,
        [selfRef.id]: selfRef,
        cp_defroot: { ...base.components.cp_defroot!, children: ['cp_deftext', 'cp_self'] },
      },
    };

    expect(() => orderDefinitions(snapshot)).toThrow(CompileError);
    expect(() => orderDefinitions(snapshot)).toThrow(/contains itself/);
  });

  it('refuses an instance pointing at nothing, rather than rendering a blank', () => {
    const base = withDefinition(1);
    const snapshot: Snapshot = { ...base, definitions: {} };
    expect(() => compile(snapshot)).toThrow(/does not point at a definition/);
  });

  it('reads a param the definition does not declare as the error it is', () => {
    const base = withDefinition(1);
    const snapshot: Snapshot = {
      ...base,
      components: {
        ...base.components,
        cp_deftext: {
          ...base.components.cp_deftext!,
          props: { content: { kind: 'param', name: 'nope' } },
        },
      },
    };
    expect(() => compile(snapshot)).toThrow(/does not declare/);
  });
});

describe('naming', () => {
  it('turns a name someone typed into a legal component name', () => {
    expect(definitionComponentName({ id: 'def_1', name: 'Invoice header', root: 'x' })).toBe(
      'InvoiceHeader',
    );
    expect(definitionComponentName({ id: 'def_1', name: 'nav-bar', root: 'x' })).toBe('NavBar');
  });

  it('still produces an identifier when the name survives nothing', () => {
    const name = definitionComponentName({ id: 'def_abc', name: '123', root: 'x' });
    expect(name).toMatch(/^[A-Za-z]/);
  });
});
