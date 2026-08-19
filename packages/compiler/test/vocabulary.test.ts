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
