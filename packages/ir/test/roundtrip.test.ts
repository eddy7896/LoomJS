import { describe, expect, it } from 'vitest';
import {
  applyOps,
  createEmptyProject,
  createTrivialSnapshot,
  deserializeSnapshot,
  newArtboardId,
  newComponentId,
  serializeSnapshot,
  SnapshotSchema,
  type Op,
} from '../src/index';

describe('snapshot schema', () => {
  it('accepts the trivial snapshot', () => {
    const snap = createTrivialSnapshot();
    expect(() => SnapshotSchema.parse(snap)).not.toThrow();
  });

  it('round-trips serialize -> deserialize as identity', () => {
    const snap = createTrivialSnapshot();
    const restored = deserializeSnapshot(serializeSnapshot(snap));
    expect(restored).toEqual(snap);
  });

  it('rejects an invalid schema version', () => {
    const bad = { ...createTrivialSnapshot(), schemaVersion: 999 };
    expect(() => SnapshotSchema.parse(bad)).toThrow();
  });

  it('rejects an unknown property-value kind', () => {
    const snap = createTrivialSnapshot();
    const textId = Object.keys(snap.components).find((id) => snap.components[id]?.type === 'Text')!;
    const bad = structuredClone(snap);
    // @ts-expect-error deliberately invalid to prove validation bites
    bad.components[textId]!.props.content = { kind: 'nope', value: 'x' };
    expect(() => SnapshotSchema.parse(bad)).toThrow();
  });
});

describe('atomic ops', () => {
  it('builds a valid snapshot from fine-grained ops', () => {
    const artboardId = newArtboardId();
    const rootId = newComponentId();
    const textId = newComponentId();

    const ops: Op[] = [
      {
        type: 'addArtboard',
        artboard: { id: artboardId, name: 'Home', root: rootId },
        root: { id: rootId, type: 'Frame', props: {}, children: [] },
      },
      {
        type: 'addComponent',
        parentId: rootId,
        component: {
          id: textId,
          type: 'Text',
          props: { content: { kind: 'static', value: 'Hello loomJS' } },
        },
      },
      {
        type: 'setProp',
        componentId: textId,
        key: 'content',
        value: { kind: 'static', value: 'Hi' },
      },
    ];

    const snap = applyOps(createEmptyProject('Sample'), ops);

    expect(() => SnapshotSchema.parse(snap)).not.toThrow();
    expect(snap.entryArtboard).toBe(artboardId);
    expect(snap.components[rootId]?.children).toEqual([textId]);
    expect(snap.components[textId]?.props['content']).toEqual({ kind: 'static', value: 'Hi' });
  });

  it('does not mutate the input snapshot', () => {
    const base = createEmptyProject('Sample');
    const before = serializeSnapshot(base);
    applyOps(base, [
      {
        type: 'addNode',
        node: { id: 'nd_x', category: 'fn', kind: 'compute', ports: [], position: { x: 0, y: 0 } },
      },
    ]);
    expect(serializeSnapshot(base)).toBe(before);
  });

  it('removing a component deletes its mirror node', () => {
    const cpId = newComponentId();
    let snap = createEmptyProject('Sample');
    snap = applyOps(snap, [
      {
        type: 'addArtboard',
        artboard: { id: newArtboardId(), name: 'Home', root: cpId },
        root: { id: cpId, type: 'Frame', props: {}, children: [] },
      },
      {
        type: 'addNode',
        node: {
          id: 'nd_mirror',
          category: 'ui',
          kind: 'mirror',
          mirrorOf: cpId,
          ports: [],
          position: { x: 0, y: 0 },
        },
      },
      { type: 'removeComponent', componentId: cpId },
    ]);
    expect(snap.components[cpId]).toBeUndefined();
    expect(snap.nodes['nd_mirror']).toBeUndefined();
  });
});
