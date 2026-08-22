import {
  apiPortsFromBody,
  componentDefs,
  createComponent,
  CURRENT_USER_DEF,
} from '@loom/components';
import { inferBackend } from '@loom/inference';
import { columnPortId, createDbNode, dbNodePorts, filterPortId } from '@loom/connectors';
import {
  applyOps,
  SCHEMA_VERSION,
  type Action,
  type Component,
  type Node,
  type Op,
  type Snapshot,
} from '@loom/ir';

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

export const NOTES_TABLE = {
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
        config: { url: 'https://demo.supabase.co', schema: { tables: [NOTES_TABLE] } },
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
    if (def.type === 'Select' || def.type === 'RadioGroup') {
      component.props.options = { kind: 'static', value: 'Low, High' };
    }
    components[component.id] = component;
  }

  // Styled and themed, so the build also proves the token plumbing: a project override reaches
  // the stylesheet, and every styled property emits a custom property the app defines.
  const styledRoot: Component = {
    ...root,
    children: [...(root.children ?? []), ...Object.keys(components)],
    style: {
      background: { kind: 'token', token: 'color.canvas' },
      radius: { kind: 'token', token: 'radius.lg' },
      borderColor: { kind: 'token', token: 'color.hairline' },
      borderWidth: 1,
    },
  };

  const styledText = components.cp_text;
  if (styledText) {
    components.cp_text = {
      ...styledText,
      style: {
        textColor: { kind: 'token', token: 'color.brand' },
        fontSize: { kind: 'token', token: 'text.xl' },
        fontWeight: { kind: 'token', token: 'weight.bold' },
        align: 'center',
      },
    };
  }

  return {
    ...base,
    theme: { 'color.brand': '#0055ff' },
    components: {
      ...base.components,
      cp_root000001: styledRoot,
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

/**
 * A screen whose parts appear, disappear and restyle with a checkbox. Its job is the emitted
 * app's own `tsc`: a visibility wrap and a conditional style spread are both real TSX, and either
 * can be malformed in a way no string match here would notice.
 */
export function conditionalSnapshot(): Snapshot {
  const base = formSnapshot();

  return applyOps(base, [
    {
      type: 'addComponent',
      parentId: 'cp_form',
      component: {
        id: 'cp_agree',
        type: 'Checkbox',
        name: 'Agree',
        props: {
          value: { kind: 'static', value: false },
          label: { kind: 'static', value: 'Agree' },
        },
      },
    },
    {
      type: 'addNode',
      node: {
        id: 'nd_m_agree',
        category: 'ui',
        kind: 'mirror',
        mirrorOf: 'cp_agree',
        ports: [
          {
            id: 'pt_value',
            name: 'checked',
            direction: 'out',
            portKind: 'data',
            type: { kind: 'boolean' },
          },
        ],
        position: { x: 0, y: 0 },
      },
    },
    {
      type: 'setVisibleWhen',
      componentId: 'cp_status',
      condition: { source: { nodeId: 'nd_m_agree', portId: 'pt_value' } },
    },
    {
      type: 'setStyle',
      componentId: 'cp_form',
      style: { background: { kind: 'token', token: 'color.surface' } },
    },
    {
      type: 'setConditionalStyles',
      componentId: 'cp_form',
      styles: [
        {
          when: { source: { nodeId: 'nd_m_agree', portId: 'pt_value' } },
          style: { background: { kind: 'token', token: 'color.brand-tint' } },
        },
        {
          when: { source: { nodeId: 'nd_m_agree', portId: 'pt_value' }, test: 'not' },
          style: { radius: { kind: 'token', token: 'radius.pill' } },
        },
      ],
    },
  ]);
}

/** The four operations a calculator offers, and the shape the bug report used. */
export const CALCULATOR_OPERATORS = ['add', 'subtract', 'multiply', 'divide'] as const;

/**
 * The calculator from the bug report: `operators.length` Math nodes fed by the same two fields,
 * each fired by its own button, all answering into one bucket that one Text displays.
 */
export function calculatorSnapshot(
  options: {
    operators?: readonly string[];
    triggered?: boolean;
    bindMathDirectly?: boolean;
    /** `global` shares the variable with every screen; `screen` keeps it to this one. */
    scope?: 'screen' | 'global';
    /** The running total: each operation reads the variable it writes. */
    runningTotal?: boolean;
    /** A second screen that displays the same global, without writing it. */
    secondScreen?: boolean;
  } = {},
): Snapshot {
  const operators = options.operators ?? CALCULATOR_OPERATORS;
  const triggered = options.triggered ?? true;
  const scope = options.scope ?? 'screen';

  const fields: Op[] = ['a', 'b'].flatMap((key) => [
    {
      type: 'addComponent',
      parentId: 'cp_form',
      component: {
        id: `cp_${key}`,
        type: 'NumberField',
        name: key.toUpperCase(),
        props: { value: { kind: 'static', value: 0 } },
      },
    },
    {
      type: 'addNode',
      node: {
        id: `nd_m_${key}`,
        category: 'ui',
        kind: 'mirror',
        mirrorOf: `cp_${key}`,
        position: { x: 0, y: 0 },
        ports: [
          {
            id: 'pt_value',
            name: 'value',
            direction: 'out',
            portKind: 'data',
            type: { kind: 'number' },
          },
        ],
      },
    },
  ]);

  const perOperator: Op[] = operators.flatMap((operator, index) => {
    const math = `nd_math_${operator}`;
    const button = `cp_btn_${operator}`;
    const mirror = `nd_btn_${operator}`;

    const ops: Op[] = [
      {
        type: 'addComponent',
        parentId: 'cp_form',
        component: {
          id: button,
          type: 'Button',
          name: operator,
          props: { label: { kind: 'static', value: operator } },
        },
      },
      {
        type: 'addNode',
        node: {
          id: math,
          category: 'fn',
          kind: 'math',
          name: `Math ${operator}`,
          position: { x: 0, y: index * 100 },
          config: { operator, inputs: 2 },
          ports: [
            {
              id: 'pt_run',
              name: 'run',
              direction: 'in',
              portKind: 'trigger',
              type: { kind: 'trigger' },
            },
            {
              id: 'pt_in_0',
              name: 'input 1',
              direction: 'in',
              portKind: 'data',
              type: { kind: 'number' },
            },
            {
              id: 'pt_in_1',
              name: 'input 2',
              direction: 'in',
              portKind: 'data',
              type: { kind: 'number' },
            },
            {
              id: 'pt_result',
              name: 'result',
              direction: 'out',
              portKind: 'data',
              type: { kind: 'number' },
            },
          ],
        },
      },
      {
        type: 'addWire',
        wire: {
          id: `wr_a_${operator}`,
          // A running total reads the variable it is about to write: `total = total + b`.
          from: options.runningTotal
            ? { nodeId: 'nd_bucket', portId: 'pt_value' }
            : { nodeId: 'nd_m_a', portId: 'pt_value' },
          to: { nodeId: math, portId: 'pt_in_0' },
        },
      },
      {
        type: 'addWire',
        wire: {
          id: `wr_b_${operator}`,
          from: { nodeId: 'nd_m_b', portId: 'pt_value' },
          to: { nodeId: math, portId: 'pt_in_1' },
        },
      },
      // Every answer lands in the same bucket. This is the wire that did not exist before.
      {
        type: 'addWire',
        wire: {
          id: `wr_set_${operator}`,
          from: { nodeId: math, portId: 'pt_result' },
          to: { nodeId: 'nd_bucket', portId: 'pt_set' },
        },
      },
    ];

    if (!triggered) return ops;

    return [
      ...ops,
      {
        type: 'addNode',
        node: {
          id: mirror,
          category: 'ui',
          kind: 'mirror',
          mirrorOf: button,
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
        },
      },
      {
        type: 'addWire',
        wire: {
          id: `wr_run_${operator}`,
          from: { nodeId: mirror, portId: 'pt_click' },
          to: { nodeId: math, portId: 'pt_run' },
        },
      },
      {
        type: 'setProp',
        componentId: button,
        key: 'onClick',
        value: {
          kind: 'event',
          handler: { kind: 'trigger', target: { nodeId: math, portId: 'pt_run' } },
        },
      },
    ];
  });

  // A second Text reading one operation directly, so that derivation is both kept and read.
  const bindDirectly: Op[] = options.bindMathDirectly
    ? [
        {
          type: 'addComponent',
          parentId: 'cp_form',
          component: {
            id: 'cp_echo',
            type: 'Text',
            name: 'Echo',
            props: {
              content: {
                kind: 'bound',
                source: { nodeId: `nd_math_${operators[0]}`, portId: 'pt_result' },
              },
            },
          },
        },
      ]
    : [];

  /**
   * A second screen that only *reads* the total, through its own Global node carrying the same
   * name. Two nodes, one variable — which is the whole point of a global: the screen that
   * computes the answer is not the screen that shows it.
   */
  const secondScreen: Op[] = options.secondScreen
    ? [
        {
          type: 'addArtboard',
          artboard: { id: 'ab_report00001', name: 'Report', root: 'cp_report_root' },
          root: {
            id: 'cp_report_root',
            type: 'Frame',
            name: 'Root',
            props: {},
            layout: { direction: 'column', gap: 8, padding: 24, align: 'start', justify: 'start' },
            children: [],
          },
        },
        {
          type: 'addComponent',
          parentId: 'cp_report_root',
          component: {
            id: 'cp_report_total',
            type: 'Text',
            name: 'Total',
            props: {
              content: { kind: 'bound', source: { nodeId: 'nd_bucket_2', portId: 'pt_value' } },
            },
          },
        },
        {
          type: 'addNode',
          node: {
            id: 'nd_bucket_2',
            category: 'state',
            kind: 'write',
            name: 'Answer',
            position: { x: 600, y: 0 },
            config: { scope: 'global', key: 'answer' },
            ports: [
              {
                id: 'pt_set',
                name: 'set',
                direction: 'in',
                portKind: 'data',
                type: { kind: 'any' },
              },
              {
                id: 'pt_value',
                name: 'value',
                direction: 'out',
                portKind: 'data',
                type: { kind: 'any' },
              },
            ],
          },
        },
      ]
    : [];

  return applyOps(formSnapshot(), [
    {
      type: 'addNode',
      node: {
        id: 'nd_bucket',
        category: 'state',
        kind: 'write',
        name: 'Answer',
        position: { x: 0, y: 0 },
        config: { scope, key: 'answer' },
        ports: [
          { id: 'pt_set', name: 'set', direction: 'in', portKind: 'data', type: { kind: 'any' } },
          {
            id: 'pt_value',
            name: 'value',
            direction: 'out',
            portKind: 'data',
            type: { kind: 'any' },
          },
        ],
      },
    },
    ...fields,
    ...perOperator,
    ...bindDirectly,
    // One Text, reading the variable.
    {
      type: 'setProp',
      componentId: 'cp_status',
      key: 'content',
      value: { kind: 'bound', source: { nodeId: 'nd_bucket', portId: 'pt_value' } },
    },
    ...secondScreen,
  ]);
}

/**
 * P3's done-when: a submit button that saves, clears the form, confirms, and navigates — in that
 * order (`docs/specs/actions.md`).
 *
 * Built on the inferred backend, because the interesting part is the ordering around a real
 * awaited request: everything after the save has to happen *after* it, and nothing after it may
 * happen at all when it fails.
 */
export function submitSequenceSnapshot(
  options: { conditional?: boolean; extras?: boolean } = {},
): Snapshot {
  const { snapshot, stateId } = inferredSnapshot();

  const actions: Action[] = [
    { kind: 'trigger', target: { nodeId: routeNodeIdOf(snapshot), portId: 'pt_run' } },
    { kind: 'clearField', componentId: 'cp_title' },
    { kind: 'clearField', componentId: 'cp_body' },
    { kind: 'message', text: 'Saved', tone: 'ok' },
    {
      kind: 'navigate',
      flowId: 'fl_done',
      ...(options.conditional
        ? { when: { source: { nodeId: stateId, portId: 'pt_value' } } }
        : {}),
    },
  ];

  if (options.extras) {
    actions.splice(
      4,
      0,
      { kind: 'setField', componentId: 'cp_title', value: { kind: 'static', value: 'next' } },
      { kind: 'openUrl', url: 'https://example.com/receipt' },
      { kind: 'copy', value: { kind: 'bound', source: { nodeId: stateId, portId: 'pt_value' } } },
    );
  }

  return applyOps(snapshot, [
    {
      type: 'addArtboard',
      artboard: { id: 'ab_done000001', name: 'Done', root: 'cp_done_root' },
      root: {
        id: 'cp_done_root',
        type: 'Frame',
        name: 'Root',
        props: {},
        layout: { direction: 'column', gap: 8, padding: 24, align: 'start', justify: 'start' },
        children: [],
      },
    },
    { type: 'addFlow', flow: { id: 'fl_done', from: 'ab_home000001', to: 'ab_done000001' } },
    {
      type: 'setProp',
      componentId: 'cp_save',
      key: 'onClick',
      value: { kind: 'event', handler: { kind: 'actions', actions } },
    },
  ]);
}

/** The API route the inference proposed, found the way the compiler finds it. */
function routeNodeIdOf(snapshot: Snapshot): string {
  const route = Object.values(snapshot.nodes).find((node) => node.category === 'api');
  if (!route) throw new Error('no API route in the inferred snapshot');
  return route.id;
}

/**
 * P4's shape: one table, all four operations, and a search.
 *
 * Built on the M4 fixture, which already lists and inserts. What is added is the half that makes
 * it an app rather than a demo — editing a row, removing one, and narrowing the list by something
 * the person typed.
 */
export function crudSnapshot(options: { search?: boolean; pageSize?: number } = {}): Snapshot {
  const base = supabaseSnapshot();

  const updateNode = createDbNode('nd_upd', { x: 0, y: 400 }, 'cn_supabase', NOTES_TABLE, 'update');
  const deleteNode = createDbNode('nd_del', { x: 0, y: 600 }, 'cn_supabase', NOTES_TABLE, 'delete');

  const ops: Op[] = [
    { type: 'addNode', node: updateNode },
    { type: 'addNode', node: deleteNode },
    {
      type: 'addNode',
      node: {
        id: 'nd_edit',
        category: 'api',
        kind: 'route',
        name: 'Edit note',
        position: { x: 320, y: 400 },
        config: { method: 'POST', path: 'editnote', body: [updateNode.id] },
        ports: apiPortsFromBody([updateNode]),
      },
    },
    {
      type: 'addNode',
      node: {
        id: 'nd_remove',
        category: 'api',
        kind: 'route',
        name: 'Remove note',
        position: { x: 320, y: 600 },
        config: { method: 'POST', path: 'removenote', body: [deleteNode.id] },
        ports: apiPortsFromBody([deleteNode]),
      },
    },
    // Buttons to fire them, so both routes belong to this screen.
    ...['edit', 'remove'].flatMap((which): Op[] => [
      {
        type: 'addComponent',
        parentId: 'cp_root000001',
        component: {
          id: `cp_${which}`,
          type: 'Button',
          name: which,
          props: {
            label: { kind: 'static', value: which },
            onClick: {
              kind: 'event',
              handler: {
                kind: 'trigger',
                target: { nodeId: which === 'edit' ? 'nd_edit' : 'nd_remove', portId: 'pt_run' },
              },
            },
          },
        },
      },
      {
        type: 'addNode',
        node: {
          id: `nd_m_${which}`,
          category: 'ui',
          kind: 'mirror',
          mirrorOf: `cp_${which}`,
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
        },
      },
      {
        type: 'addWire',
        wire: {
          id: `wr_${which}`,
          from: { nodeId: `nd_m_${which}`, portId: 'pt_click' },
          to: { nodeId: which === 'edit' ? 'nd_edit' : 'nd_remove', portId: 'pt_run' },
        },
      },
    ]),
  ];

  if (options.search) {
    // The read narrows by a value the screen supplies — which is all a search box is.
    const filters = [{ column: 'title', operator: 'contains' as const, source: 'input' as const }];
    const select = base.nodes.nd_select!;
    ops.push({
      type: 'setNodeConfig',
      nodeId: select.id,
      config: { ...(select.config as Record<string, unknown>), filters },
      ports: dbNodePorts(NOTES_TABLE, 'select', filters),
    });

    const searchField: Component = {
      id: 'cp_search',
      type: 'TextField',
      name: 'Search',
      props: { value: { kind: 'static', value: '' } },
    };
    ops.push(
      { type: 'addComponent', parentId: 'cp_root000001', component: searchField },
      {
        type: 'addNode',
        node: {
          id: 'nd_m_search',
          category: 'ui',
          kind: 'mirror',
          mirrorOf: searchField.id,
          position: { x: 0, y: 0 },
          ports: [
            {
              id: 'pt_value',
              name: 'value',
              direction: 'out',
              portKind: 'data',
              type: { kind: 'text' },
            },
          ],
        },
      },
    );
  }

  const withOps = applyOps(base, ops);

  // The read route has to be retyped after its step gained a filter port, then wired.
  if (options.search) {
    const select = withOps.nodes.nd_select!;
    const retyped = applyOps(withOps, [
      {
        type: 'setNodeConfig',
        nodeId: 'nd_read',
        config: (withOps.nodes.nd_read!.config ?? {}) as Record<string, unknown>,
        ports: apiPortsFromBody([select]),
      },
      {
        type: 'addWire',
        wire: {
          id: 'wr_search',
          from: { nodeId: 'nd_m_search', portId: 'pt_value' },
          to: { nodeId: 'nd_read', portId: filterPortId('title') },
        },
      },
    ]);
    return options.pageSize ? withPageSize(retyped, options.pageSize) : retyped;
  }

  return options.pageSize ? withPageSize(withOps, options.pageSize) : withOps;
}

/**
 * A project with users (P5, `docs/specs/app-auth.md`).
 *
 * The CRUD project, plus a Sign in screen and a guard on the one that shows the rows. The sign-in
 * form is what a designer would build: two fields, a button, and a sequence that signs in and then
 * goes somewhere.
 */
export function authSnapshot(options: { guard?: boolean } = {}): Snapshot {
  const base = crudSnapshot();

  const ops: Op[] = [
    {
      type: 'addArtboard',
      artboard: { id: 'ab_signin00001', name: 'Sign in', root: 'cp_signin_root' },
      root: {
        id: 'cp_signin_root',
        type: 'Frame',
        name: 'Root',
        props: {},
        layout: { direction: 'column', gap: 8, padding: 24, align: 'start', justify: 'start' },
        children: [],
      },
    },
    {
      type: 'addComponent',
      parentId: 'cp_signin_root',
      component: {
        id: 'cp_email',
        type: 'TextField',
        name: 'Email',
        props: { value: { kind: 'static', value: '' } },
      },
    },
    {
      type: 'addComponent',
      parentId: 'cp_signin_root',
      component: {
        id: 'cp_password',
        type: 'TextField',
        name: 'Password',
        props: { value: { kind: 'static', value: '' } },
      },
    },
    ...['email', 'password'].map((which): Op => ({
      type: 'addNode',
      node: {
        id: `nd_m_${which}`,
        category: 'ui',
        kind: 'mirror',
        mirrorOf: `cp_${which}`,
        position: { x: 0, y: 0 },
        ports: [
          { id: 'pt_value', name: 'value', direction: 'out', portKind: 'data', type: { kind: 'text' } },
        ],
      },
    })),
    { type: 'addFlow', flow: { id: 'fl_in', from: 'ab_signin00001', to: 'ab_home000001' } },
    {
      type: 'addComponent',
      parentId: 'cp_signin_root',
      component: {
        id: 'cp_signin',
        type: 'Button',
        name: 'Sign in',
        props: {
          label: { kind: 'static', value: 'Sign in' },
          onClick: {
            kind: 'event',
            handler: {
              kind: 'actions',
              actions: [
                {
                  kind: 'signIn',
                  email: { kind: 'bound', source: { nodeId: 'nd_m_email', portId: 'pt_value' } },
                  password: {
                    kind: 'bound',
                    source: { nodeId: 'nd_m_password', portId: 'pt_value' },
                  },
                },
                { kind: 'navigate', flowId: 'fl_in' },
              ],
            },
          },
        },
      },
    },
    // What went wrong, shown where someone typing a password can see it.
    {
      type: 'addNode',
      node: {
        id: 'nd_me',
        category: 'state',
        kind: 'currentUser',
        name: 'Current user',
        position: { x: 0, y: 0 },
        config: {},
        ports: CURRENT_USER_DEF.ports({}),
      },
    },
    {
      type: 'addComponent',
      parentId: 'cp_signin_root',
      component: {
        id: 'cp_autherror',
        type: 'Text',
        name: 'Sign in problem',
        props: { content: { kind: 'bound', source: { nodeId: 'nd_me', portId: 'pt_error' } } },
      },
    },
    // On the guarded screen: who is here, and a way to stop being here.
    {
      type: 'addComponent',
      parentId: 'cp_root000001',
      component: {
        id: 'cp_who',
        type: 'Text',
        name: 'Who',
        props: { content: { kind: 'bound', source: { nodeId: 'nd_me', portId: 'pt_email' } } },
      },
    },
    {
      type: 'addComponent',
      parentId: 'cp_root000001',
      component: {
        id: 'cp_signout',
        type: 'Button',
        name: 'Sign out',
        props: {
          label: { kind: 'static', value: 'Sign out' },
          onClick: { kind: 'event', handler: { kind: 'actions', actions: [{ kind: 'signOut' }] } },
        },
      },
    },
  ];

  if (options.guard !== false) {
    ops.push({
      type: 'setArtboardGuard',
      artboardId: 'ab_home000001',
      guard: { redirectTo: 'ab_signin00001' },
    });
  }

  return applyOps(base, ops);
}

function withPageSize(snapshot: Snapshot, pageSize: number): Snapshot {
  return applyOps(snapshot, [
    { type: 'setProp', componentId: 'cp_list', key: 'pageSize', value: { kind: 'static', value: pageSize } },
  ]);
}
