import { apiPortsFromBody } from '@loom/components';
import { columnPortId, createDbNode } from '@loom/connectors';
import { SCHEMA_VERSION, type Component, type Node, type Snapshot } from '@loom/ir';

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

/**
 * The M3 shape: a TextField feeding an API route node whose body uppercases the value, fired by
 * a Button's trigger, with a Text bound to the result.
 */
export function pipelineSnapshot(): Snapshot {
  const base = trivialSnapshot();
  const homeRoot = base.components.cp_root000001!;

  const field: Component = {
    id: 'cp_field',
    type: 'TextField',
    name: 'Name',
    props: {
      value: { kind: 'static', value: '' },
      placeholder: { kind: 'static', value: 'Your name' },
    },
  };

  const button: Component = {
    id: 'cp_send',
    type: 'Button',
    name: 'Send',
    props: {
      label: { kind: 'static', value: 'Send' },
      onClick: {
        kind: 'event',
        handler: { kind: 'trigger', target: { nodeId: 'nd_api', portId: 'pt_run' } },
      },
    },
  };

  const output: Component = {
    id: 'cp_output',
    type: 'Text',
    name: 'Result',
    props: { content: { kind: 'bound', source: { nodeId: 'nd_api', portId: 'pt_result' } } },
  };

  const mirrorButton: Node = {
    id: 'nd_mirror_button',
    category: 'ui',
    kind: 'mirror',
    mirrorOf: button.id,
    position: { x: 0, y: 0 },
    ports: [
      {
        id: 'pt_click',
        name: 'onClick',
        direction: 'out',
        portKind: 'trigger',
        type: { kind: 'trigger' },
      },
    ],
  };

  const mirrorField: Node = {
    id: 'nd_mirror_field',
    category: 'ui',
    kind: 'mirror',
    mirrorOf: field.id,
    position: { x: 0, y: 120 },
    ports: [
      { id: 'pt_value', name: 'value', direction: 'out', portKind: 'data', type: { kind: 'text' } },
    ],
  };

  const compute: Node = {
    id: 'nd_compute',
    category: 'fn',
    kind: 'compute',
    name: 'Uppercase',
    position: { x: 320, y: 60 },
    config: { op: 'uppercase' },
    ports: [
      { id: 'pt_input', name: 'input', direction: 'in', portKind: 'data', type: { kind: 'text' } },
      { id: 'pt_result', name: 'result', direction: 'out', portKind: 'data', type: { kind: 'text' } },
    ],
  };

  const api: Node = {
    id: 'nd_api',
    category: 'api',
    kind: 'route',
    name: 'Shout',
    position: { x: 280, y: 0 },
    config: { method: 'POST', path: 'shout', body: [compute.id] },
    // The container exposes its body's edges: the compute step's input and output.
    ports: apiPortsFromBody([compute]),
  };

  return {
    ...base,
    components: {
      ...base.components,
      cp_root000001: {
        ...homeRoot,
        children: [...(homeRoot.children ?? []), field.id, button.id, output.id],
      },
      [field.id]: field,
      [button.id]: button,
      [output.id]: output,
    },
    nodes: {
      [mirrorButton.id]: mirrorButton,
      [mirrorField.id]: mirrorField,
      [compute.id]: compute,
      [api.id]: api,
    },
    wires: {
      wr_trigger: {
        id: 'wr_trigger',
        from: { nodeId: mirrorButton.id, portId: 'pt_click' },
        to: { nodeId: api.id, portId: 'pt_run' },
      },
      wr_input: {
        id: 'wr_input',
        from: { nodeId: mirrorField.id, portId: 'pt_value' },
        to: { nodeId: api.id, portId: 'pt_input' },
      },
    },
  };
}

const NOTES_TABLE = {
  name: 'notes',
  columns: [
    { name: 'id', type: { kind: 'number' as const }, required: false, primaryKey: true, generated: true },
    { name: 'title', type: { kind: 'text' as const }, required: true, primaryKey: false, generated: false },
    { name: 'body', type: { kind: 'text' as const }, required: false, primaryKey: false, generated: false },
  ],
};

/**
 * The M4 shape: a connected Supabase, a reactive read that fills a List, and a form whose submit
 * inserts a row. Both database nodes sit inside API routes — database work never runs in the
 * browser (`docs/specs/connector-credentials.md`).
 */
export function supabaseSnapshot(): Snapshot {
  const base = trivialSnapshot();
  const homeRoot = base.components.cp_root000001!;

  const rowText: Component = {
    id: 'cp_row_text',
    type: 'Text',
    name: 'Row title',
    props: { content: { kind: 'item', field: 'title' } },
  };

  const list: Component = {
    id: 'cp_list',
    type: 'List',
    name: 'Notes',
    props: {
      empty: { kind: 'static', value: 'No notes yet' },
      items: { kind: 'bound', source: { nodeId: 'nd_read', portId: 'pt_result' } },
    },
    layout: { direction: 'column', gap: 8, padding: 0, align: 'stretch', justify: 'start' },
    children: [rowText.id],
  };

  const titleField: Component = {
    id: 'cp_title',
    type: 'TextField',
    name: 'Title',
    props: { value: { kind: 'static', value: '' }, placeholder: { kind: 'static', value: 'Title' } },
  };

  const saveButton: Component = {
    id: 'cp_save',
    type: 'Button',
    name: 'Save',
    props: {
      label: { kind: 'static', value: 'Save' },
      onClick: {
        kind: 'event',
        handler: { kind: 'trigger', target: { nodeId: 'nd_write', portId: 'pt_run' } },
      },
    },
  };

  const selectNode = createDbNode('nd_select', { x: 0, y: 0 }, 'cn_supabase', NOTES_TABLE, 'select');
  const insertNode = createDbNode('nd_insert', { x: 0, y: 200 }, 'cn_supabase', NOTES_TABLE, 'insert');

  const readRoute: Node = {
    id: 'nd_read',
    category: 'api',
    kind: 'route',
    name: 'List notes',
    position: { x: 320, y: 0 },
    config: { method: 'POST', path: 'notes', body: [selectNode.id] },
    ports: apiPortsFromBody([selectNode]),
  };

  const writeRoute: Node = {
    id: 'nd_write',
    category: 'api',
    kind: 'route',
    name: 'Create note',
    position: { x: 320, y: 200 },
    config: { method: 'POST', path: 'createnote', body: [insertNode.id] },
    ports: apiPortsFromBody([insertNode]),
  };

  const mirrorTitle: Node = {
    id: 'nd_mirror_title',
    category: 'ui',
    kind: 'mirror',
    mirrorOf: titleField.id,
    position: { x: 0, y: 320 },
    ports: [
      { id: 'pt_value', name: 'value', direction: 'out', portKind: 'data', type: { kind: 'text' } },
    ],
  };

  const mirrorSave: Node = {
    id: 'nd_mirror_save',
    category: 'ui',
    kind: 'mirror',
    mirrorOf: saveButton.id,
    position: { x: 0, y: 420 },
    ports: [
      {
        id: 'pt_click',
        name: 'onClick',
        direction: 'out',
        portKind: 'trigger',
        type: { kind: 'trigger' },
      },
    ],
  };

  return {
    ...base,
    components: {
      ...base.components,
      cp_root000001: {
        ...homeRoot,
        children: [...(homeRoot.children ?? []), list.id, titleField.id, saveButton.id],
      },
      [list.id]: list,
      [rowText.id]: rowText,
      [titleField.id]: titleField,
      [saveButton.id]: saveButton,
    },
    nodes: {
      [selectNode.id]: selectNode,
      [insertNode.id]: insertNode,
      [readRoute.id]: readRoute,
      [writeRoute.id]: writeRoute,
      [mirrorTitle.id]: mirrorTitle,
      [mirrorSave.id]: mirrorSave,
    },
    wires: {
      wr_save: {
        id: 'wr_save',
        from: { nodeId: mirrorSave.id, portId: 'pt_click' },
        to: { nodeId: writeRoute.id, portId: 'pt_run' },
      },
      wr_title: {
        id: 'wr_title',
        from: { nodeId: mirrorTitle.id, portId: 'pt_value' },
        to: { nodeId: writeRoute.id, portId: columnPortId('title') },
      },
    },
    connectors: {
      cn_supabase: {
        id: 'cn_supabase',
        moduleId: 'supabase',
        // Config carries the project URL and the cached schema. Never a key.
        config: { url: 'https://demo.supabase.co' },
        credentialRef: 'default',
      },
    },
  };
}
