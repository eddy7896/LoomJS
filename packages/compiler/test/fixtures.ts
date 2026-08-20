import { apiPortsFromBody, componentDefs, createComponent } from '@loom/components';
import { inferBackend } from '@loom/inference';
import { columnPortId, createDbNode } from '@loom/connectors';
import { applyOps, SCHEMA_VERSION, type Component, type Node, type Snapshot } from '@loom/ir';

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

/**
 * The M5 starting point: a form the designer drew, and a connection whose schema is cached —
 * everything inference reads, and nothing it produces. `inferBackend` turns this into the
 * pipeline; the compiler then treats the result as an ordinary document, which is the point.
 */
export function formSnapshot(): Snapshot {
  const base = trivialSnapshot();
  const homeRoot = base.components.cp_root000001!;

  const titleField: Component = {
    id: 'cp_title',
    type: 'TextField',
    name: 'Title',
    props: { value: { kind: 'static', value: '' }, placeholder: { kind: 'static', value: 'Title' } },
  };

  const bodyField: Component = {
    id: 'cp_body',
    type: 'TextField',
    name: 'Body',
    props: { value: { kind: 'static', value: '' }, placeholder: { kind: 'static', value: 'Body' } },
  };

  const saveButton: Component = {
    id: 'cp_save',
    type: 'Button',
    name: 'Save',
    props: { label: { kind: 'static', value: 'Save' } },
  };

  const form: Component = {
    id: 'cp_form',
    type: 'Frame',
    name: 'New note',
    props: {},
    layout: { direction: 'column', gap: 8, padding: 16, align: 'stretch', justify: 'start' },
    children: [titleField.id, bodyField.id, saveButton.id],
  };

  const status: Component = {
    id: 'cp_status',
    type: 'Text',
    name: 'Status',
    props: { content: { kind: 'static', value: '' } },
  };

  return {
    ...base,
    components: {
      ...base.components,
      cp_root000001: { ...homeRoot, children: [...(homeRoot.children ?? []), form.id, status.id] },
      [form.id]: form,
      [titleField.id]: titleField,
      [bodyField.id]: bodyField,
      [saveButton.id]: saveButton,
      [status.id]: status,
    },
    connectors: {
      cn_supabase: {
        id: 'cn_supabase',
        moduleId: 'supabase',
        // The cached schema is what inference matches the form against; the URL is not a secret.
        config: { url: 'https://demo.supabase.co', schema: { tables: [NOTES_TABLE] } },
        credentialRef: 'default',
      },
    },
  };
}

/** Infer the backend for the form fixture, and bind the status Text to the screen bucket. */
export function inferredSnapshot(): { snapshot: Snapshot; stateId: string; routePath: string } {
  const base = formSnapshot();
  const result = inferBackend(base, { frameId: 'cp_form' });
  if (!result.ok) throw new Error(result.reason);

  const snapshot = applyOps(base, [
    ...result.proposal.ops,
    {
      type: 'setProp',
      componentId: 'cp_status',
      key: 'content',
      value: { kind: 'bound', source: { nodeId: result.proposal.nodes.state, portId: 'pt_value' } },
    },
  ]);

  return { snapshot, stateId: result.proposal.nodes.state, routePath: result.proposal.route };
}

/**
 * One of every component the studio can place. The point is the emitted app's own `tsc`: a
 * template that produces invalid TSX is a broken editor, and this is where that shows up.
 */
export function everyComponentSnapshot(): Snapshot {
  const base = trivialSnapshot();
  const root = base.components.cp_root000001!;
  const components: Record<string, Component> = {};

  for (const def of componentDefs()) {
    if (def.type === 'Frame') continue;
    const component = createComponent(def.type, `cp_${def.type.toLowerCase()}`);
    if (def.type === 'Select') component.props.options = { kind: 'static', value: 'Low, High' };
    components[component.id] = component;
  }

  return {
    ...base,
    components: {
      ...base.components,
      cp_root000001: { ...root, children: [...(root.children ?? []), ...Object.keys(components)] },
      ...components,
    },
  };
}

/**
 * The inferred pipeline with one of every operator step wired into its body. Its job is the
 * emitted app's own `tsc`: the operator templates declare locals, and a local nothing reads
 * fails a build with `noUnusedLocals` — which no amount of string matching here would catch.
 */
export function operatorPipelineSnapshot(): Snapshot {
  const { snapshot } = inferredSnapshot();
  const route = Object.values(snapshot.nodes).find((node) => node.category === 'api')!;
  const body = (route.config as { body: string[] }).body;

  const step = (id: string, kind: string, config: Record<string, unknown>): Node => ({
    id,
    category: 'fn',
    kind,
    name: kind,
    ports: [
      { id: 'pt_input', name: 'input', direction: 'in', portKind: 'data', type: { kind: 'any' } },
      { id: 'pt_result', name: 'result', direction: 'out', portKind: 'data', type: { kind: 'any' } },
    ],
    position: { x: 0, y: 0 },
    config,
  });

  const steps = [
    step('nd_math', 'math', {
      left: 'quantity',
      operator: 'multiply',
      rightKind: 'field',
      right: 'price',
      into: 'total',
    }),
    // Reads nothing from the record and writes nowhere: the shape that must NOT declare `source`.
    step('nd_math_bare', 'math', { left: '', operator: 'add', rightKind: 'value', right: '1', into: '' }),
    step('nd_compare', 'compare', {
      left: 'total',
      operator: 'atLeast',
      rightKind: 'value',
      right: '10',
      into: 'is_big',
    }),
    step('nd_logic', 'logic', {
      left: 'is_big',
      operator: 'or',
      rightKind: 'field',
      right: 'is_big',
      into: 'flagged',
    }),
    step('nd_gate', 'gate', { field: 'title', condition: 'isFilled', value: '', message: '' }),
  ];

  return applyOps(snapshot, [
    ...steps.map((node) => ({ type: 'addNode', node }) as const),
    {
      type: 'setNodeConfig',
      nodeId: route.id,
      config: {
        ...(route.config as object),
        body: [body[0]!, ...steps.map((node) => node.id), body[1]!],
      },
    },
  ]);
}

/**
 * A button-fired Math node folding two number fields into a Text. Its job is the emitted app's
 * own `tsc`: a triggered derivation emits state, a setter function and a helper, and any of the
 * three can be wrong in a way no string match here would notice.
 */
export function triggeredMathSnapshot(): Snapshot {
  const base = formSnapshot();

  const numberField = (id: string, name: string): Component => ({
    id,
    type: 'NumberField',
    name,
    props: { value: { kind: 'static', value: 0 } },
  });

  const mirror = (id: string, componentId: string): Node => ({
    id,
    category: 'ui',
    kind: 'mirror',
    mirrorOf: componentId,
    ports: [
      { id: 'pt_value', name: 'value', direction: 'out', portKind: 'data', type: { kind: 'number' } },
    ],
    position: { x: 0, y: 0 },
  });

  return applyOps(base, [
    { type: 'addComponent', parentId: 'cp_form', component: numberField('cp_a', 'A') },
    { type: 'addComponent', parentId: 'cp_form', component: numberField('cp_b', 'B') },
    { type: 'addNode', node: mirror('nd_ma', 'cp_a') },
    { type: 'addNode', node: mirror('nd_mb', 'cp_b') },
    {
      type: 'addNode',
      node: {
        id: 'nd_go',
        category: 'ui',
        kind: 'mirror',
        mirrorOf: 'cp_save',
        ports: [
          {
            id: 'pt_click',
            name: 'onClick',
            direction: 'out',
            portKind: 'trigger',
            type: { kind: 'trigger' },
          },
        ],
        position: { x: 0, y: 0 },
      },
    },
    {
      type: 'addNode',
      node: {
        id: 'nd_math',
        category: 'fn',
        kind: 'math',
        name: 'Math',
        ports: [
          { id: 'pt_run', name: 'run', direction: 'in', portKind: 'trigger', type: { kind: 'trigger' } },
          { id: 'pt_in_0', name: 'input 1', direction: 'in', portKind: 'data', type: { kind: 'number' } },
          { id: 'pt_in_1', name: 'input 2', direction: 'in', portKind: 'data', type: { kind: 'number' } },
          { id: 'pt_result', name: 'result', direction: 'out', portKind: 'data', type: { kind: 'number' } },
        ],
        position: { x: 0, y: 0 },
        config: { operator: 'divide', inputs: 2 },
      },
    },
    {
      type: 'addWire',
      wire: { id: 'wr_a', from: { nodeId: 'nd_ma', portId: 'pt_value' }, to: { nodeId: 'nd_math', portId: 'pt_in_0' } },
    },
    {
      type: 'addWire',
      wire: { id: 'wr_b', from: { nodeId: 'nd_mb', portId: 'pt_value' }, to: { nodeId: 'nd_math', portId: 'pt_in_1' } },
    },
    {
      type: 'addWire',
      wire: { id: 'wr_go', from: { nodeId: 'nd_go', portId: 'pt_click' }, to: { nodeId: 'nd_math', portId: 'pt_run' } },
    },
    {
      type: 'setProp',
      componentId: 'cp_save',
      key: 'onClick',
      value: {
        kind: 'event',
        handler: { kind: 'trigger', target: { nodeId: 'nd_math', portId: 'pt_run' } },
      },
    },
    {
      type: 'setProp',
      componentId: 'cp_status',
      key: 'content',
      value: { kind: 'bound', source: { nodeId: 'nd_math', portId: 'pt_result' } },
    },
  ]);
}
