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
