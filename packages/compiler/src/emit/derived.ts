import type { Artboard, Id, Node, Snapshot } from '@loom/ir';
import { COMPUTE_OPS } from '@loom/components';
import { CompileError } from '../types';
import { stateNameForComponent, type PipelinePlan } from './pipeline';

/**
 * Derived values — the browser half of the FN family.
 *
 * The container boundary is the network boundary (`docs/specs/binding-trigger-runtime.md`), so a
 * function node **inside** an API route runs on the server and one **outside** it runs in the
 * browser. This file is the outside case: a Compute wired from a field's mirror into a Text is a
 * derivation of local state, and it compiles to exactly what a developer would write — one
 * `const`, no request, no state, no runtime library.
 *
 * Only Compute runs here. The record-shaped steps (Math, Compare, Logic, Validate, Gate) read
 * named fields of a request body, and a Code node's body may await; both belong inside a route,
 * and asking for them out here is a Build error that says so.
 */

export interface DerivedPlan {
  node: Node;
  /** Local constant holding the value. */
  name: string;
  /** The expression it is assigned. */
  expr: string;
}

const jsIdent = (id: string): string => id.replace(/[^a-zA-Z0-9_]/g, '_');

export const derivedName = (nodeId: Id): string => `derived_${jsIdent(nodeId)}`;

/** Function kinds that can run in the browser, with why the others cannot. */
const CLIENT_KINDS: Record<string, string | undefined> = {
  compute: undefined,
  math: 'Math works on the fields of a request body, so it belongs inside an API route.',
  compare: 'Compare works on the fields of a request body, so it belongs inside an API route.',
  logic: 'Logic works on the fields of a request body, so it belongs inside an API route.',
  validate: 'Validate runs on the server, where it cannot be bypassed. Put it inside an API route.',
  gate: 'A Gate stops a request, so it belongs inside an API route.',
  code: 'A Code node runs on the server. Put it inside an API route.',
};

/** The expression for one Compute operation, applied to an expression rather than a variable. */
function computeExpr(node: Node, input: string): string {
  const op = String(((node.config ?? {}) as { op?: string }).op ?? '');
  switch (op) {
    case 'uppercase':
      return `String(${input}).toUpperCase()`;
    case 'lowercase':
      return `String(${input}).toLowerCase()`;
    case 'trim':
      return `String(${input}).trim()`;
    case 'length':
      return `String(${input}).length`;
    case 'double':
      return `Number(${input}) * 2`;
    case 'negate':
      return `-Number(${input})`;
    case 'isEmpty':
      return `String(${input} ?? "").trim() === ""`;
    case 'not':
      return `!(${input} === true || ${input} === "true")`;
    default:
      throw new CompileError(
        `Compute node has unknown operation "${op}". Known: ${Object.keys(COMPUTE_OPS).join(', ')}.`,
        node.id,
      );
  }
}

/** Every node id that sits inside some API route's body. */
export function nodesInsideRoutes(snapshot: Snapshot): Set<Id> {
  const inside = new Set<Id>();
  for (const node of Object.values(snapshot.nodes)) {
    if (node.category !== 'api') continue;
    for (const id of ((node.config ?? {}) as { body?: Id[] }).body ?? []) inside.add(id);
  }
  return inside;
}

/** Components belonging to one artboard. */
function componentsOf(snapshot: Snapshot, artboard: Artboard): Set<Id> {
  const ids = new Set<Id>();
  const walk = (id: Id): void => {
    ids.add(id);
    for (const child of snapshot.components[id]?.children ?? []) walk(child);
  };
  walk(artboard.root);
  return ids;
}

/**
 * Plan the derived values one artboard needs.
 *
 * **Demand-driven**, like every other local the compiler emits: a derivation nobody binds is not
 * emitted at all, because the generated app builds with `noUnusedLocals` and a dead `const` would
 * fail its own `tsc`. So this starts from the properties that actually read something and walks
 * *backwards* along the wires.
 *
 * `plans` is read to resolve a Compute fed by an API route's result, and its `binds.result` is
 * set when that happens — the route's state has to exist for the derivation to read it.
 */
export function planDerived(
  snapshot: Snapshot,
  artboard: Artboard,
  plans: PipelinePlan[],
): DerivedPlan[] {
  const inside = nodesInsideRoutes(snapshot);
  const owned = componentsOf(snapshot, artboard);

  // Deliberately a plain predicate rather than a type guard: the negative branch has to keep
  // narrowing the node to what it is (a mirror, a route), not to `never`.
  const isDerivable = (node: Node | undefined): boolean =>
    Boolean(node && node.category === 'fn' && !inside.has(node.id));

  // 1. What does this screen actually read?
  const wanted: Id[] = [];
  for (const component of Object.values(snapshot.components)) {
    if (!owned.has(component.id)) continue;
    for (const value of Object.values(component.props)) {
      if (value.kind !== 'bound') continue;
      const target = snapshot.nodes[value.source.nodeId];
      if (target && isDerivable(target)) wanted.push(target.id);
    }
  }
  if (wanted.length === 0) return [];

  const wireInto = (nodeId: Id): { nodeId: Id; portId: Id } | undefined =>
    Object.values(snapshot.wires).find(
      (wire) => wire.to.nodeId === nodeId && wire.to.portId === 'pt_input',
    )?.from;

  // 2. Walk backwards, deepest first, so a chain of Computes comes out in dependency order.
  const ordered: Node[] = [];
  const state = new Map<Id, 'visiting' | 'done'>();

  const visit = (nodeId: Id): void => {
    const status = state.get(nodeId);
    if (status === 'done') return;
    if (status === 'visiting') {
      throw new CompileError('These function nodes feed each other in a circle.', nodeId);
    }

    const node = snapshot.nodes[nodeId];
    if (!node || !isDerivable(node)) return;

    const reason = CLIENT_KINDS[node.kind];
    if (reason !== undefined) throw new CompileError(reason, nodeId);

    state.set(nodeId, 'visiting');
    const from = wireInto(nodeId);
    if (from && isDerivable(snapshot.nodes[from.nodeId])) visit(from.nodeId);
    state.set(nodeId, 'done');
    ordered.push(node);
  };

  for (const id of wanted) visit(id);

  // 3. Turn each into a `const`, resolving what feeds it.
  return ordered.map((node) => {
    const from = wireInto(node.id);
    if (!from) {
      throw new CompileError(
        `"${node.name ?? node.id}" has nothing wired into its input, so there is no value to derive.`,
        node.id,
      );
    }

    const source = snapshot.nodes[from.nodeId];
    if (!source) throw new CompileError(`Wire into "${node.id}" comes from an unknown node.`, node.id);

    let input: string;
    if (isDerivable(source)) {
      input = derivedName(source.id);
    } else if (source.category === 'ui' && source.mirrorOf && owned.has(source.mirrorOf)) {
      // A field's mirror stands for the component's local state — the value the person typed.
      input = stateNameForComponent(source.mirrorOf);
    } else if (source.category === 'api') {
      const plan = plans.find((candidate) => candidate.node.id === source.id);
      if (!plan || from.portId !== 'pt_result') {
        throw new CompileError(
          `"${node.name ?? node.id}" reads a route output this screen does not produce.`,
          node.id,
        );
      }
      // The route's result has to exist as state for this derivation to read it.
      plan.binds.result = true;
      input = `(${plan.names.state} ?? "")`;
    } else {
      throw new CompileError(
        `"${node.name ?? node.id}" reads "${source.name ?? source.id}", which produces no value in the browser.`,
        node.id,
      );
    }

    return { node, name: derivedName(node.id), expr: computeExpr(node, input) };
  });
}

/** The `const` lines, in dependency order. */
export function emitDerived(derived: DerivedPlan[]): string[] {
  return derived.map((entry) => `  const ${entry.name} = ${entry.expr};`);
}
