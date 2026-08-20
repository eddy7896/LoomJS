import { SCHEMA_VERSION, type Component, type Snapshot } from '@loom/ir';

/**
 * A deterministic twin of `createTrivialSnapshot()` — same shape, fixed ids, so golden-file
 * emission tests are stable (the real fixture generates nanoid ids).
 */
export function trivialSnapshot(): Snapshot {
  const root: Component = {
    id: 'cp_root000001',
    type: 'Frame',
    name: 'Root',
    props: {},
    layout: { direction: 'column', gap: 16, padding: 24, align: 'stretch', justify: 'start' },
    children: ['cp_text000001'],
  };

  const text: Component = {
    id: 'cp_text000001',
    type: 'Text',
    name: 'Greeting',
    props: { content: { kind: 'static', value: 'Hello loomJS' } },
  };

  return {
    schemaVersion: SCHEMA_VERSION,
    id: 'pj_test000001',
    name: 'Sample',
    entryArtboard: 'ab_home000001',
    artboards: { ab_home000001: { id: 'ab_home000001', name: 'Home', root: root.id } },
    components: { [root.id]: root, [text.id]: text },
    nodes: {},
    wires: {},
    flows: {},
    connectors: {},
  };
}

/**
 * Two artboards and a flow between them: the M2 shape. Home has a Button whose click follows
 * the flow to Item Detail, carrying a static payload into the destination's declared param.
 */
export function masterDetailSnapshot(): Snapshot {
  const base = trivialSnapshot();

  const homeRoot = base.components.cp_root000001!;
  const button: Component = {
    id: 'cp_button',
    type: 'Button',
    name: 'Open item',
    props: {
      label: { kind: 'static', value: 'Open item' },
      onClick: { kind: 'event', handler: { kind: 'navigate', flowId: 'fl_1' } },
    },
  };

  const detailRoot: Component = {
    id: 'cp_detail_root',
    type: 'Frame',
    name: 'Root',
    props: {},
    layout: { direction: 'column', gap: 8, padding: 24, align: 'start', justify: 'start' },
    children: ['cp_detail_text'],
  };

  const detailText: Component = {
    id: 'cp_detail_text',
    type: 'Text',
    name: 'Item id',
    props: { content: { kind: 'param', name: 'id' } },
  };

  return {
    ...base,
    artboards: {
      ...base.artboards,
      ab_detail00001: {
        id: 'ab_detail00001',
        name: 'Item Detail',
        root: detailRoot.id,
        params: [{ name: 'id', type: { kind: 'text' } }],
      },
    },
    components: {
      ...base.components,
      cp_root000001: { ...homeRoot, children: [...(homeRoot.children ?? []), button.id] },
      [button.id]: button,
      [detailRoot.id]: detailRoot,
      [detailText.id]: detailText,
    },
    flows: {
      fl_1: {
        id: 'fl_1',
        from: 'ab_home000001',
        to: 'ab_detail00001',
        payload: [{ kind: 'static', param: 'id', value: '42' }],
      },
    },
  };
}
