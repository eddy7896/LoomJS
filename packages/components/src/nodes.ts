import type { Id, Node, NodeCategory, Port, TypeRef } from '@loom/ir';
import type { FieldDef } from './defs';

/**
 * The Nodes-mode vocabulary: one definition per node kind, shared by the studio (palette +
 * inspector) and read alongside the compiler's emission templates. Ports are *derived from
 * config*, so changing a Compute node's operation retypes its ports immediately — inference over
 * annotation (`docs/specs/type-registry.md`).
 */

/**
 * Where a node sits in the palette. Not the same as its `category`, which is what it *is* in the
 * language: a Compute and a Math are both `fn`, but a designer looks for one under "values" and
 * the other under "maths" (`docs/11-editor-shell.md`).
 */
export type NodeGroup = 'backend' | 'values' | 'logic' | 'data';

export const NODE_GROUPS: readonly { id: NodeGroup; label: string }[] = [
  { id: 'backend', label: 'Backend' },
  { id: 'values', label: 'Values' },
  { id: 'logic', label: 'Logic' },
  { id: 'data', label: 'Data' },
];

export interface NodeDef {
  category: NodeCategory;
  kind: string;
  label: string;
  /** Palette section. Editor metadata; it never reaches the emitted app. */
  group: NodeGroup;
  /** Words someone might search for that are not in the label. */
  keywords?: readonly string[];
  /** An API route node contains the function nodes that run server-side (spec 4). */
  isContainer?: boolean;
  fields: readonly FieldDef[];
  ports: (config: Record<string, unknown>) => Port[];
  defaultConfig: Record<string, unknown>;
}

const port = (
  id: string,
  name: string,
  direction: Port['direction'],
  portKind: Port['portKind'],
  type: TypeRef,
): Port => ({ id, name, direction, portKind, type });

/** Operations a Compute node offers. Each one is a real typed function, chosen — never typed out. */
export const COMPUTE_OPS = {
  uppercase: { label: 'Uppercase', in: { kind: 'text' }, out: { kind: 'text' } },
  lowercase: { label: 'Lowercase', in: { kind: 'text' }, out: { kind: 'text' } },
  trim: { label: 'Trim', in: { kind: 'text' }, out: { kind: 'text' } },
  length: { label: 'Length', in: { kind: 'text' }, out: { kind: 'number' } },
  double: { label: 'Double', in: { kind: 'number' }, out: { kind: 'number' } },
  negate: { label: 'Negate', in: { kind: 'number' }, out: { kind: 'number' } },
  isEmpty: { label: 'Is empty', in: { kind: 'text' }, out: { kind: 'boolean' } },
  not: { label: 'Not', in: { kind: 'boolean' }, out: { kind: 'boolean' } },
} as const satisfies Record<string, { label: string; in: TypeRef; out: TypeRef }>;

export type ComputeOp = keyof typeof COMPUTE_OPS;

export const API_ROUTE_DEF: NodeDef = {
  category: 'api',
  kind: 'route',
  label: 'API route',
  group: 'backend',
  keywords: ['server', 'endpoint', 'request', 'pipeline'],
  isContainer: true,
  defaultConfig: { method: 'POST', path: 'run' },
  fields: [
    { key: 'method', label: 'Method', control: 'select', options: ['POST', 'GET'], default: 'POST' },
    { key: 'path', label: 'Path', control: 'text', default: 'run' },
  ],
  ports: () => [
    port('pt_run', 'run', 'in', 'trigger', { kind: 'trigger' }),
    port('pt_input', 'input', 'in', 'data', { kind: 'any' }),
    port('pt_result', 'result', 'out', 'data', { kind: 'any' }),
    // Status ports: bind them to show a spinner or a message. Unbound, they emit nothing.
    port('pt_pending', 'pending', 'out', 'data', { kind: 'boolean' }),
    port('pt_error', 'error', 'out', 'data', { kind: 'optional', of: { kind: 'text' } }),
  ],
};

export const COMPUTE_DEF: NodeDef = {
  category: 'fn',
  kind: 'compute',
  label: 'Compute',
  group: 'values',
  keywords: ['transform', 'uppercase', 'trim', 'length'],
  defaultConfig: { op: 'uppercase' },
  fields: [
    {
      key: 'op',
      label: 'Operation',
      control: 'select',
      options: Object.keys(COMPUTE_OPS),
      default: 'uppercase',
    },
  ],
  ports: (config) => {
    const op = (COMPUTE_OPS as Record<string, { in: TypeRef; out: TypeRef }>)[
      String(config.op ?? 'uppercase')
    ];
    return [
      // Wire something into `run` and the value only updates when that fires; leave it unwired
      // and it recomputes as its input changes. Derived from the wiring, never configured
      // (`docs/specs/binding-trigger-runtime.md`).
      port('pt_run', 'run', 'in', 'trigger', { kind: 'trigger' }),
      port('pt_input', 'input', 'in', 'data', op?.in ?? { kind: 'any' }),
      port('pt_result', 'result', 'out', 'data', op?.out ?? { kind: 'any' }),
    ];
  },
};

export const CODE_DEF: NodeDef = {
  category: 'fn',
  kind: 'code',
  label: 'Code',
  group: 'backend',
  keywords: ['javascript', 'typescript', 'custom', 'escape hatch'],
  // The escape hatch for the arbitrary 20% (guardrail 7). Its output is `any` and marked as such.
  defaultConfig: { source: 'return String(input).split("").reverse().join("");' },
  fields: [{ key: 'source', label: 'Body', control: 'text', default: 'return input;' }],
  ports: () => [
    port('pt_input', 'input', 'in', 'data', { kind: 'any' }),
    port('pt_result', 'result', 'out', 'data', { kind: 'any' }),
  ],
};


/** One field a Validate node checks, mirroring the form input it came from. */
export interface ValidationField {
  name: string;
  type: TypeRef;
  required: boolean;
}

export interface ValidateConfig {
  fields: ValidationField[];
}

/**
 * Validate is the first step of an inferred write pipeline (M5). Its ports **are** the form's
 * fields, so the API route that contains it exposes exactly those inputs, and a required field
 * left empty fails on the server where it cannot be bypassed.
 *
 * It has no inspector fields on purpose: its shape is inferred from the form, and hand-editing
 * the shape is what Detach is for (`docs/06-glossary.md`).
 */
export const VALIDATE_DEF: NodeDef = {
  category: 'fn',
  kind: 'validate',
  label: 'Validate',
  group: 'logic',
  keywords: ['required', 'check', 'rules'],
  defaultConfig: { fields: [] },
  fields: [],
  ports: (config) => {
    const fields = Array.isArray(config.fields) ? (config.fields as ValidationField[]) : [];
    const inputs = fields.map((field) =>
      port(
        `pt_f_${field.name}`,
        field.name,
        'in',
        'data',
        field.required ? field.type : { kind: 'optional', of: field.type },
      ),
    );
    return [...inputs, port('pt_values', 'values', 'out', 'data', { kind: 'record' })];
  },
};

/**
 * Where a variable lives (`docs/06-glossary.md` §State scope).
 *
 * - `screen` — one artboard's own value, React local state in that screen's module.
 * - `global` — one value the whole app shares, held in a context above the router. Two global
 *   nodes carrying the same **name** are the same variable, which is what lets one screen write
 *   what another screen reads.
 *
 * The third bucket, `env`, is deliberately not a node: secrets are server-only, referenced by
 * name, and never cross into the browser (`docs/specs/connector-credentials.md`).
 */
export type StateScope = 'screen' | 'global';

export const STATE_SCOPES = ['screen', 'global'] as const satisfies readonly StateScope[];

export interface StateWriteConfig {
  scope: StateScope;
  key: string;
}

/** A node's scope, defaulting to `screen` — the narrower of the two is the safer default. */
export function stateScopeOf(node: Node): StateScope {
  return ((node.config ?? {}) as { scope?: unknown }).scope === 'global' ? 'global' : 'screen';
}

/**
 * A variable's name, which is its identity when the scope is global. Blank falls back to
 * `value` so a freshly dropped node is never nameless.
 */
export function stateKeyOf(node: Node): string {
  const key = String(((node.config ?? {}) as { key?: unknown }).key ?? '').trim();
  return key.length > 0 ? key : 'value';
}

/**
 * A variable: it holds whatever is wired into it for the rest of its scope's life, so a result
 * outlives the call or the click that produced it. It runs in the browser — React state, never
 * inside an API route's body — and its `set` port is the one port in the language that takes
 * many wires: **many writers, one reader, last write wins**.
 */
export const STATE_WRITE_DEF: NodeDef = {
  category: 'state',
  kind: 'write',
  label: 'Variable',
  group: 'values',
  keywords: ['state', 'store', 'remember', 'bucket'],
  defaultConfig: { scope: 'screen', key: 'value' },
  fields: [
    { key: 'key', label: 'Name', control: 'text', default: 'value' },
    { key: 'scope', label: 'Scope', control: 'select', options: STATE_SCOPES, default: 'screen' },
  ],
  ports: () => [
    port('pt_set', 'set', 'in', 'data', { kind: 'any' }),
    port('pt_value', 'value', 'out', 'data', { kind: 'any' }),
  ],
};


/**
 * Current user — the app's own signed-in person (spec 10), read in the browser.
 *
 * It is `state` because that is what a session is: something the app holds while someone is here.
 * That also means the compiler's existing rule applies unchanged — a state node cannot sit inside
 * an API route's body, and inside a stateless function the session comes from the request's cookie
 * rather than from a node.
 *
 * There is no new mechanism behind any of its ports: binding `email` to a Text shows who is here,
 * and `signed in` in a `visibleWhen` is auth-gated visibility using spec 6 exactly as written.
 */
export const CURRENT_USER_DEF: NodeDef = {
  category: 'state',
  kind: 'currentUser',
  label: 'Current user',
  group: 'data',
  keywords: ['auth', 'session', 'signed in', 'login', 'account', 'me'],
  defaultConfig: {},
  fields: [],
  ports: () => [
    port('pt_signedIn', 'signed in', 'out', 'data', { kind: 'boolean' }),
    port('pt_email', 'email', 'out', 'data', { kind: 'text' }),
    port('pt_id', 'id', 'out', 'data', { kind: 'text' }),
    // Why the last attempt failed, for the designer to show. Unbound, it emits nothing.
    port('pt_error', 'error', 'out', 'data', { kind: 'optional', of: { kind: 'text' } }),
  ],
};

/**
 * A variable, as opposed to the other thing in the `state` category.
 *
 * Everything that means "a bucket someone writes into" has to ask this rather than the category:
  * the Current user is app state too, and it is nobody's to set.
 */
export function isVariable(node: Node): boolean {
  return node.category === 'state' && node.kind === 'write';
}

/**
 * The conditions a Gate can test. Each is a phrase, not an operator symbol — "is greater than"
 * rather than `>` — because the promise is that a designer never feels they left the canvas
 * (`docs/06-glossary.md`: "calmest accurate word for the scary things").
 */
export const GATE_CONDITIONS = {
  isFilled: { label: 'is not empty', needsValue: false },
  isEmpty: { label: 'is empty', needsValue: false },
  isTrue: { label: 'is checked', needsValue: false },
  isFalse: { label: 'is not checked', needsValue: false },
  equals: { label: 'equals', needsValue: true },
  notEquals: { label: 'does not equal', needsValue: true },
  greaterThan: { label: 'is greater than', needsValue: true },
  lessThan: { label: 'is less than', needsValue: true },
} as const satisfies Record<string, { label: string; needsValue: boolean }>;

export type GateCondition = keyof typeof GATE_CONDITIONS;

export interface GateConfig {
  /** A field of the incoming record, or blank to test the whole value. */
  field: string;
  condition: GateCondition;
  /** The value compared against, for the conditions that need one. */
  value: string;
  /** Shown to the person using the app when the condition does not hold. */
  message: string;
}

/**
 * Gate — the only control-flow node (`docs/06-glossary.md`). One condition: when it does not
 * hold, the pipeline stops and the message is the failure.
 *
 * **V1 shape:** stop, rather than two branch edges. A route body is an ordered pipeline, and a
 * second branch would need a second body — real work with no demand behind it yet. Everything a
 * form actually needs ("only insert when the box is ticked") is this shape, and the deferral is
 * recorded in `docs/specs/binding-trigger-runtime.md` rather than hidden.
 */
export const GATE_DEF: NodeDef = {
  category: 'fn',
  kind: 'gate',
  label: 'Gate',
  group: 'logic',
  keywords: ['stop', 'guard', 'only when', 'refuse'],
  defaultConfig: { field: '', condition: 'isFilled', value: '', message: '' },
  fields: [
    { key: 'field', label: 'Field', control: 'text', default: '' },
    {
      key: 'condition',
      label: 'Condition',
      control: 'select',
      options: Object.keys(GATE_CONDITIONS),
      default: 'isFilled',
    },
    { key: 'value', label: 'Value', control: 'text', default: '' },
    { key: 'message', label: 'Message', control: 'text', default: '' },
  ],
  // A Gate passes what it was given straight through, so it chains without reshaping anything.
  ports: () => [
    port('pt_input', 'input', 'in', 'data', { kind: 'any' }),
    port('pt_result', 'result', 'out', 'data', { kind: 'any' }),
  ],
};

/** The sentence shown when a Gate stops a pipeline, when the designer has not written one. */
export function gateMessage(config: Partial<GateConfig>): string {
  if (config.message) return config.message;
  const subject = config.field || 'the value';
  const condition = GATE_CONDITIONS[(config.condition ?? 'isFilled') as GateCondition];
  const comparand = condition.needsValue ? ` ${config.value ?? ''}`.trimEnd() : '';
  return `${subject} ${condition.label}${comparand} is required.`;
}


/**
 * Operator nodes: Math, Compare, Logic.
 *
 * All three are the glossary's **Compute** — "a single derived value from a small expression"
 * (`docs/06-glossary.md`) — split by what they operate on, because one node with twelve operators
 * and a type that changes underneath you is harder to read than three that each mean one thing.
 * They are *kinds* inside the FN family, not a new category; flagged here rather than slipped in.
 *
 * Each reads named fields of the record flowing through the route and writes its answer back
 * into a named field, so a pipeline stays one value moving forward rather than a web of wires.
 */

/** Where one side of an operation comes from. */
export interface OperandConfig {
  /** Field of the incoming record; blank means the whole value. */
  left: string;
  /** `value` compares against what the designer typed; `field` against another column. */
  rightKind: 'value' | 'field';
  right: string;
  /** Field the answer is written into; blank replaces the whole value. */
  into: string;
}

const operandFields = (rightLabel: string): readonly FieldDef[] => [
  { key: 'left', label: 'Left', control: 'text', default: '' },
  { key: 'rightKind', label: 'Right is', control: 'select', options: ['value', 'field'], default: 'value' },
  { key: 'right', label: rightLabel, control: 'text', default: '' },
  { key: 'into', label: 'Write to', control: 'text', default: '' },
];

/** Arithmetic. Each is a word, not a symbol — the designer picks "times", never `*`. */
export const MATH_OPERATORS = {
  add: 'plus',
  subtract: 'minus',
  multiply: 'times',
  divide: 'divided by',
  remainder: 'remainder of',
  min: 'smaller of',
  max: 'larger of',
} as const satisfies Record<string, string>;

export type MathOperator = keyof typeof MATH_OPERATORS;

/** How many operands a Math node takes on the canvas. Two is the common case; five is plenty. */
export const MATH_MIN_INPUTS = 2;
export const MATH_MAX_INPUTS = 5;

export const mathInputPortId = (index: number): string => `pt_in_${index}`;

export function mathInputCount(config: Record<string, unknown>): number {
  const raw = Number(config.inputs ?? MATH_MIN_INPUTS);
  if (!Number.isFinite(raw)) return MATH_MIN_INPUTS;
  return Math.min(MATH_MAX_INPUTS, Math.max(MATH_MIN_INPUTS, Math.round(raw)));
}

/**
 * Math takes its operands **from wires on the canvas** and folds them left to right, so
 * `a + b + c` is one node rather than a chain of two.
 *
 * Inside an API route's body it works differently, and deliberately: a body is one value flowing
 * through ordered steps with no wires between them, so there the operands are named fields of the
 * request body (`left` / `right` in config). Same operator vocabulary, resolved from whatever the
 * surrounding environment actually has.
 */
export const MATH_DEF: NodeDef = {
  category: 'fn',
  kind: 'math',
  label: 'Math',
  group: 'values',
  keywords: ['add', 'subtract', 'multiply', 'divide', 'sum'],
  defaultConfig: {
    inputs: MATH_MIN_INPUTS,
    left: '',
    operator: 'add',
    rightKind: 'value',
    right: '0',
    into: '',
  },
  fields: [
    {
      key: 'operator',
      label: 'Operation',
      control: 'select',
      options: Object.keys(MATH_OPERATORS),
      default: 'add',
    },
    { key: 'inputs', label: 'Inputs', control: 'number', default: MATH_MIN_INPUTS },
    { key: 'left', label: 'Left', control: 'text', default: '' },
    ...operandFields('Right').filter((field) => field.key !== 'left'),
  ],
  ports: (config) => [
    port('pt_run', 'run', 'in', 'trigger', { kind: 'trigger' }),
    ...Array.from({ length: mathInputCount(config) }, (_, index) =>
      port(mathInputPortId(index), `input ${index + 1}`, 'in', 'data', { kind: 'number' }),
    ),
    port('pt_result', 'result', 'out', 'data', { kind: 'number' }),
  ],
};

/** Config keys that apply on the canvas, and the ones that apply inside an API route's body. */
export const MATH_CANVAS_FIELDS = ['operator', 'inputs'] as const;
export const MATH_BODY_FIELDS = ['operator', 'left', 'rightKind', 'right', 'into'] as const;

/** Comparison. Where a Gate stops the pipeline, a Compare hands the answer on as a boolean. */
export const COMPARE_OPERATORS = {
  equals: 'equals',
  notEquals: 'does not equal',
  greaterThan: 'is greater than',
  lessThan: 'is less than',
  atLeast: 'is at least',
  atMost: 'is at most',
} as const satisfies Record<string, string>;

export type CompareOperator = keyof typeof COMPARE_OPERATORS;

export const COMPARE_DEF: NodeDef = {
  category: 'fn',
  kind: 'compare',
  label: 'Compare',
  group: 'logic',
  keywords: ['equals', 'greater', 'less', 'condition'],
  defaultConfig: { left: '', operator: 'equals', rightKind: 'value', right: '', into: '' },
  fields: [
    { key: 'left', label: 'Left', control: 'text', default: '' },
    {
      key: 'operator',
      label: 'Condition',
      control: 'select',
      options: Object.keys(COMPARE_OPERATORS),
      default: 'equals',
    },
    ...operandFields('Right').filter((field) => field.key !== 'left'),
  ],
  ports: () => [
    port('pt_input', 'input', 'in', 'data', { kind: 'any' }),
    port('pt_result', 'result', 'out', 'data', { kind: 'boolean' }),
  ],
};

/** Boolean algebra over two fields. `not` stays on Compute, where a one-sided operation belongs. */
export const LOGIC_OPERATORS = { and: 'and', or: 'or' } as const satisfies Record<string, string>;

export type LogicOperator = keyof typeof LOGIC_OPERATORS;

export const LOGIC_DEF: NodeDef = {
  category: 'fn',
  kind: 'logic',
  label: 'Logic',
  group: 'logic',
  keywords: ['and', 'or', 'not', 'boolean'],
  defaultConfig: { left: '', operator: 'and', rightKind: 'field', right: '', into: '' },
  fields: [
    { key: 'left', label: 'Left', control: 'text', default: '' },
    {
      key: 'operator',
      label: 'Operation',
      control: 'select',
      options: Object.keys(LOGIC_OPERATORS),
      default: 'and',
    },
    ...operandFields('Right').filter((field) => field.key !== 'left'),
  ],
  ports: () => [
    port('pt_input', 'input', 'in', 'data', { kind: 'any' }),
    port('pt_result', 'result', 'out', 'data', { kind: 'boolean' }),
  ],
};

const DEFS: readonly NodeDef[] = [
  API_ROUTE_DEF,
  COMPUTE_DEF,
  GATE_DEF,
  MATH_DEF,
  COMPARE_DEF,
  LOGIC_DEF,
  CODE_DEF,
  VALIDATE_DEF,
  STATE_WRITE_DEF,
  CURRENT_USER_DEF,
];
const BY_KIND = new Map(DEFS.map((def) => [`${def.category}:${def.kind}`, def]));

export function nodeDefs(): readonly NodeDef[] {
  return DEFS;
}

export function nodeDefFor(category: NodeCategory, kind: string): NodeDef | undefined {
  return BY_KIND.get(`${category}:${kind}`);
}

export function defForNode(node: Node): NodeDef | undefined {
  return nodeDefFor(node.category, node.kind);
}

/** Ports a node should currently have, given its config. */
export function portsForNode(node: Node): Port[] {
  const def = defForNode(node);
  if (!def) return node.ports;
  return def.ports((node.config as Record<string, unknown>) ?? {});
}

export function createNode(
  category: NodeCategory,
  kind: string,
  id: string,
  position: { x: number; y: number },
): Node {
  const def = nodeDefFor(category, kind);
  if (!def) throw new Error(`Unknown node kind "${category}:${kind}".`);
  const config = { ...def.defaultConfig };
  return {
    id,
    category: def.category,
    kind: def.kind,
    name: def.label,
    ports: def.ports(config),
    position,
    config,
  };
}

/**
 * An API route node's ports are **derived from its body**: the container exposes its body's
 * edges. The first step's inputs become the route's inputs (so a form wires straight into the
 * columns an insert needs), and the last step's output types the route's result.
 *
 * This is what makes the container honest — its shape is exactly what the server side needs and
 * returns, rather than a generic `any` in and `any` out.
 */
export function apiPortsFromBody(body: Node[]): Port[] {
  const ports: Port[] = [port('pt_run', 'run', 'in', 'trigger', { kind: 'trigger' })];

  const first = body[0];
  const inputs = (first?.ports ?? []).filter((p) => p.direction === 'in' && p.portKind === 'data');
  if (inputs.length > 0) {
    ports.push(...inputs.map((p) => ({ ...p, direction: 'in' as const })));
  } else {
    ports.push(port('pt_input', 'input', 'in', 'data', { kind: 'any' }));
  }

  const last = body[body.length - 1];
  const output = (last?.ports ?? []).find((p) => p.direction === 'out' && p.portKind === 'data');
  ports.push(port('pt_result', 'result', 'out', 'data', output?.type ?? { kind: 'any' }));
  ports.push(port('pt_pending', 'pending', 'out', 'data', { kind: 'boolean' }));
  ports.push(port('pt_error', 'error', 'out', 'data', { kind: 'optional', of: { kind: 'text' } }));

  return ports;
}

/**
 * Ports a UI component exposes when mirrored into Nodes mode. The component stays on the
 * artboard — the mirror is a view of it, never a second copy (guardrail 13).
 */
export function mirrorPortsFor(componentType: string): Port[] {
  switch (componentType) {
    case 'Button':
      return [port('pt_click', 'onClick', 'out', 'trigger', { kind: 'trigger' })];
    case 'TextField':
    case 'MultilineField':
      return [port('pt_value', 'value', 'out', 'data', { kind: 'text' })];
    case 'NumberField':
    case 'Slider':
      return [port('pt_value', 'value', 'out', 'data', { kind: 'number' })];
    case 'Checkbox':
      return [port('pt_value', 'checked', 'out', 'data', { kind: 'boolean' })];
    case 'Select':
    case 'RadioGroup':
      // `text` rather than an enum of the options: typing it would need the mirror to read the
      // component's config, which is a wider change than this vocabulary needs.
      return [port('pt_value', 'value', 'out', 'data', { kind: 'text' })];
    case 'DateField':
      // The browser hands back `YYYY-MM-DD`, and that string is exactly what a date column
      // accepts. Typing this `date` would promise a conversion nothing performs.
      return [port('pt_value', 'value', 'out', 'data', { kind: 'text' })];
    case 'Text':
      return [port('pt_content', 'content', 'in', 'data', { kind: 'any' })];
    case 'Image':
      return [port('pt_src', 'source', 'in', 'data', { kind: 'text' })];
    case 'Link':
      return [port('pt_href', 'address', 'in', 'data', { kind: 'text' })];
    case 'List':
      return [port('pt_items', 'items', 'in', 'data', { kind: 'list', of: { kind: 'record' } })];
    default:
      return [];
  }
}

/**
 * What a node calls itself on the canvas.
 *
 * A node's `name` belongs to the person, and it starts life as the def's label — which means four
 * Math nodes all read "Math", and a calculator's graph tells you nothing about which button does
 * what. While the name is still that untouched default, the canvas shows what the node is
 * *configured to do* instead. Rename one and the name wins again, immediately.
 */
export function nodeTitle(node: Node): string {
  const def = defForNode(node);
  if (!def) return node.name ?? node.kind;
  if (node.name && node.name !== def.label) return node.name;

  const config = (node.config ?? {}) as Record<string, unknown>;

  if (node.kind === 'math') {
    const operator = MATH_OPERATORS[config.operator as MathOperator];
    return operator ? `${def.label} — ${operator}` : def.label;
  }
  if (node.kind === 'compute') {
    const op = COMPUTE_OPS[config.op as ComputeOp];
    return op ? `${def.label} — ${op.label.toLowerCase()}` : def.label;
  }
  if (isVariable(node)) {
    // A variable's name is the whole point of it: several results answer into "total", and the
    // reader needs to know which "total" a wire is landing in — and whether that "total" is this
    // screen's or the whole app's, because a global one is shared with every other screen.
    const scope = stateScopeOf(node);
    const label = scope === 'global' ? 'Global' : def.label;
    return `${label} — ${stateKeyOf(node)}`;
  }

  return def.label;
}

/**
 * The one port in the language that takes many wires.
 *
 * Every other input port holds a single value, and rewiring one replaces what was there — that is
 * what makes a graph readable: follow the wire back and there is exactly one answer. A screen
 * bucket is the deliberate exception, because "four operations, one display" cannot be said any
 * other way. Many writers, one reader, last write wins (`packages/compiler/src/emit/state.ts`).
 */
export function acceptsManyWires(node: Node, portId: Id): boolean {
  return isVariable(node) && portId === 'pt_set';
}

/**
 * Component types whose value lives in local state in the emitted app — the inputs. A binding
 * pointing at one of these mirrors reads what the person typed, with no pipeline in between.
 */
const FIELD_STATE_TYPES = new Set([
  'TextField',
  'MultilineField',
  'NumberField',
  'Checkbox',
  'Select',
  'RadioGroup',
  'DateField',
  'Slider',
]);

export function hasFieldState(componentType: string): boolean {
  return FIELD_STATE_TYPES.has(componentType);
}

export function canMirror(componentType: string): boolean {
  return mirrorPortsFor(componentType).length > 0;
}
