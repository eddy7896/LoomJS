import { describe, expect, it } from 'vitest';
import { componentDefs, createComponent } from '@loom/components';
import { SCHEMA_VERSION, applyOp, createEmptyProject, type Snapshot } from '@loom/ir';
import { compile, knownComponentTypes } from '../src/index';

/**
 * The authoring vocabulary (@loom/components) and the emission templates (here) are two halves
 * of one contract. A type the studio can place but the compiler cannot emit is a broken editor,
 * so the drift is a test failure rather than a runtime surprise.
 */
describe('vocabulary <-> templates', () => {
  it('every component definition has a code template', () => {
    const templates = knownComponentTypes();
    for (const def of componentDefs()) {
      expect(templates, `no template for ${def.type}`).toContain(def.type);
    }
  });

  /**
   * Every emitted module is real TypeScript.
   *
   * Three times now an emitter has produced markup that read fine and would not parse — an IIFE
   * closed with `)()}` instead of `})()}`, once in a carousel and twice more in a calendar and a
   * chat. Each time the only thing that noticed was a smoke gate: `npm install` plus `tsc`, half a
   * minute per run, and only when someone remembered to run it.
   *
   * esbuild parses the same file in about a millisecond. It does not type-check — that is still the
   * smoke gate's job — but it makes a syntax error a failure you get before you have looked away.
   */
  it('every emitted module parses', async () => {
    const { transform } = await import('esbuild');
    const root = createComponent('Frame', 'cp_root');
    let snapshot: Snapshot = applyOp(createEmptyProject('Vocab'), {
      type: 'addArtboard',
      artboard: { id: 'ab_1', name: 'Home', root: root.id },
      root,
    });

    /**
     * Every element, in **every variant it offers**.
     *
     * The first version of this test placed each element once, at its default, and missed the very
     * bug it was written for: the broken close was in a calendar's `agenda` shape, which nothing
     * had drawn. A variant that changes the emitted markup is a variant that can break it.
     */
    for (const def of componentDefs()) {
      if (def.type === 'Frame') continue;
      const shapes = def.variants?.find((axis) => axis.key === 'variant')?.options ?? [''];

      for (const shape of shapes) {
        const component = createComponent(def.type, `cp_${def.type.toLowerCase()}_${shape || 'x'}`);
        if (shape) component.props.variant = { kind: 'static', value: shape };
        snapshot = applyOp(snapshot, { type: 'addComponent', component, parentId: root.id });
      }
    }

    for (const file of compile(snapshot).files) {
      if (!/\.tsx?$/.test(file.path)) continue;
      await expect(
        transform(file.content, {
          loader: file.path.endsWith('.tsx') ? 'tsx' : 'ts',
          format: 'esm',
        }),
        `${file.path} is not valid TypeScript`,
      ).resolves.toBeTruthy();
    }
  });

  it('a project built from the definitions compiles', () => {
    const root = createComponent('Frame', 'cp_root');
    let snapshot: Snapshot = applyOp(createEmptyProject('Vocab'), {
      type: 'addArtboard',
      artboard: { id: 'ab_1', name: 'Home', root: root.id },
      root,
    });

    for (const def of componentDefs()) {
      if (def.type === 'Frame') continue;
      snapshot = applyOp(snapshot, {
        type: 'addComponent',
        component: createComponent(def.type, `cp_${def.type.toLowerCase()}`),
        parentId: root.id,
      });
    }

    expect(snapshot.schemaVersion).toBe(SCHEMA_VERSION);
    expect(() => compile(snapshot)).not.toThrow();
  });
});
