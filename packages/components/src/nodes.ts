import type { Node, NodeCategory, Port, TypeRef } from '@loom/ir';
import type { FieldDef } from './defs';

/**
 * The Nodes-mode vocabulary: one definition per node kind, shared by the studio (palette +
 * inspector) and read alongside the compiler's emission templates. Ports are *derived from
 * config*, so changing a Compute node's operation retypes its ports immediately — inference over
 * annotation (`docs/specs/type-registry.md`).
 */

export interface NodeDef {
  category: NodeCategory;
  kind: string;
  label: string;
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

export interface StateWriteConfig {
  /** V1 has one scope; the global bucket is a later addition (`docs/06-glossary.md`). */
  scope: 'screen';
  key: string;
}

/**
 * A screen-bucket write: it holds whatever is wired into it for the rest of the screen's life,
 * so a pipeline's result outlives the call that produced it. It runs in the browser — it is
 * React local state, and it is never inside an API route's body.
 */
export const STATE_WRITE_DEF: NodeDef = {
  category: 'state',
  kind: 'write',
  label: 'State',
  defaultConfig: { scope: 'screen', key: 'value' },
  fields: [{ key: 'key', label: 'Name', control: 'text', default: 'value' }],
  ports: () => [
    port('pt_set', 'set', 'in', 'data', { kind: 'any' }),
    port('pt_value', 'value', 'out', 'data', { kind: 'any' }),
  ],
};


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
      return [port('pt_value', 'value', 'out', 'data', { kind: 'text' })];
    case 'NumberField':
      return [port('pt_value', 'value', 'out', 'data', { kind: 'number' })];
    case 'Checkbox':
      return [port('pt_value', 'checked', 'out', 'data', { kind: 'boolean' })];
    case 'Select':
      // `text` rather than an enum of the options: typing it would need the mirror to read the
      // component's config, which is a wider change than this vocabulary needs.
      return [port('pt_value', 'value', 'out', 'data', { kind: 'text' })];
    case 'Text':
      return [port('pt_content', 'content', 'in', 'data', { kind: 'any' })];
    case 'List':
      return [port('pt_items', 'items', 'in', 'data', { kind: 'list', of: { kind: 'record' } })];
    default:
      return [];
  }
}

export function canMirror(componentType: string): boolean {
  return mirrorPortsFor(componentType).length > 0;
}
