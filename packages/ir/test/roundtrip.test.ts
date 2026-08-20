import { describe, expect, it } from 'vitest';
import {
  applyOp,
  applyOps,
  createEmptyProject,
  createTrivialSnapshot,
  deserializeSnapshot,
  newArtboardId,
  newComponentId,
  serializeSnapshot,
  SnapshotSchema,
  type Component,
  type Op,
  type Snapshot,
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

describe('editing ops', () => {
  const base = (): Snapshot => {
    const snapshot = createTrivialSnapshot();
    return snapshot;
  };

  const rootOf = (s: Snapshot): string => s.artboards[s.entryArtboard!]!.root;

  it('setLayout merges into an existing layout', () => {
    const s = base();
    const next = applyOp(s, { type: 'setLayout', componentId: rootOf(s), layout: { gap: 4 } });
    expect(next.components[rootOf(s)]!.layout).toMatchObject({ gap: 4, direction: 'column' });
  });

  it('setLayout refuses a component that is not a container', () => {
    const s = base();
    const textId = s.components[rootOf(s)]!.children![0]!;
    expect(() => applyOp(s, { type: 'setLayout', componentId: textId, layout: { gap: 4 } })).toThrow(
      /not a container/,
    );
  });

  it('moveComponent reparents and reorders without duplicating', () => {
    const s = base();
    const root = rootOf(s);
    const textId = s.components[root]!.children![0]!;
    const frame: Component = {
      id: 'cp_frame2',
      type: 'Frame',
      props: {},
      layout: { direction: 'row', gap: 0, padding: 0, align: 'start', justify: 'start' },
      children: [],
    };
    let next = applyOp(s, { type: 'addComponent', component: frame, parentId: root });
    next = applyOp(next, { type: 'moveComponent', componentId: textId, parentId: 'cp_frame2' });
    expect(next.components[root]!.children).toEqual(['cp_frame2']);
    expect(next.components.cp_frame2!.children).toEqual([textId]);
  });

  it('moveComponent refuses to put a container inside itself', () => {
    const s = base();
    const root = rootOf(s);
    const textId = s.components[root]!.children![0]!;
    expect(() =>
      applyOp(s, { type: 'moveComponent', componentId: root, parentId: textId }),
    ).toThrow(/is inside/);
  });

  it('removeComponent deletes the whole subtree', () => {
    const s = base();
    const root = rootOf(s);
    const textId = s.components[root]!.children![0]!;
    const next = applyOp(s, { type: 'removeComponent', componentId: root });
    expect(next.components[root]).toBeUndefined();
    expect(next.components[textId]).toBeUndefined();
  });
});

describe('artboard and flow ops', () => {
  const twoScreens = (): { snapshot: Snapshot; home: string; detail: string } => {
    const home = createTrivialSnapshot();
    const homeId = home.entryArtboard!;
    const detailRoot: Component = { id: 'cp_d_root', type: 'Frame', props: {}, children: [] };
    const snapshot = applyOp(home, {
      type: 'addArtboard',
      artboard: { id: 'ab_detail', name: 'Detail', root: detailRoot.id },
      root: detailRoot,
    });
    return { snapshot, home: homeId, detail: 'ab_detail' };
  };

  it('keeps the first artboard as the entry when a second is added', () => {
    const { snapshot, home } = twoScreens();
    expect(snapshot.entryArtboard).toBe(home);
    expect(Object.keys(snapshot.artboards)).toHaveLength(2);
  });

  it('refuses a flow between artboards that do not exist', () => {
    const { snapshot, home } = twoScreens();
    expect(() =>
      applyOp(snapshot, { type: 'addFlow', flow: { id: 'fl_x', from: home, to: 'ab_ghost' } }),
    ).toThrow(/unknown artboard/);
  });

  it('removing an artboard takes its tree and its flows', () => {
    const { snapshot, home, detail } = twoScreens();
    const withFlow = applyOp(snapshot, {
      type: 'addFlow',
      flow: { id: 'fl_1', from: home, to: detail },
    });
    const next = applyOp(withFlow, { type: 'removeArtboard', artboardId: detail });
    expect(next.artboards[detail]).toBeUndefined();
    expect(next.components.cp_d_root).toBeUndefined();
    expect(next.flows.fl_1).toBeUndefined();
  });

  it('re-points the entry when the entry artboard is removed', () => {
    const { snapshot, home, detail } = twoScreens();
    const next = applyOp(snapshot, { type: 'removeArtboard', artboardId: home });
    expect(next.entryArtboard).toBe(detail);
  });

  it('removeProp drops a handler entirely rather than leaving an empty one', () => {
    const { snapshot, home } = twoScreens();
    const textId = snapshot.components[snapshot.artboards[home]!.root]!.children![0]!;
    const next = applyOp(snapshot, { type: 'removeProp', componentId: textId, key: 'content' });
    expect(next.components[textId]!.props.content).toBeUndefined();
  });

  it('setArtboardParams and setEntryArtboard validate their target', () => {
    const { snapshot } = twoScreens();
    expect(() =>
      applyOp(snapshot, { type: 'setArtboardParams', artboardId: 'ab_ghost', params: [] }),
    ).toThrow(/unknown artboard/);
    expect(() => applyOp(snapshot, { type: 'setEntryArtboard', artboardId: 'ab_ghost' })).toThrow(
      /unknown artboard/,
    );
  });
});
