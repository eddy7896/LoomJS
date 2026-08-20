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

const DEFS: readonly NodeDef[] = [API_ROUTE_DEF, COMPUTE_DEF, CODE_DEF];
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
