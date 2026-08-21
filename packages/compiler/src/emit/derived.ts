import type { Artboard, Id, Node, PortRef, Snapshot, TypeRef } from '@loom/ir';
import { COMPUTE_OPS, mathInputCount, mathInputPortId, MATH_OPERATORS } from '@loom/components';
import { tsTypeOf } from '@loom/typesys';
import { CompileError } from '../types';
import { stateNameForComponent, type PipelinePlan } from './pipeline';
import { stateFallback, statesWrittenBy, type ScreenStatePlan } from './state';

/**
 * Derived values — the browser half of the FN family.
 *
 * The container boundary is the network boundary (`docs/specs/binding-trigger-runtime.md`), so a
 * function node **inside** an API route runs on the server and one **outside** it runs in the
 * browser. This file is the outside case: a Compute wired from a field's mirror into a Text is a
 * derivation of local state, and it compiles to exactly what a developer would write.
 *
 * **Triggered or reactive is read from the wiring, never configured** — the same rule pipelines
 * follow. Nothing wired into `run` means the value recomputes as its inputs change, and compiles
 * to a plain `const`. A trigger wired in means it holds its last answer in state and only updates
 * when that trigger fires.
 */

export interface DerivedPlan {
  node: Node;
  /** Local holding the value: a `const` when reactive, a state variable when triggered. */
  name: string;
  /** The expression that computes it. */
  expr: string;
  /** The type it produces, for the initial value of triggered state. */
  type: TypeRef;
  /** Set when a trigger is wired into `run`; the name of the function that recomputes. */
  runName: string | undefined;
  /**
   * Whether anything reads this derivation *by name* — a bound property, or another derivation.
   * A derivation that only feeds a screen bucket needs no local of its own, and emitting one would
   * be a dead binding in an app that builds with `noUnusedLocals`.
   */
  bound: boolean;
  /** The setters of the variables this derivation's run writes (`emit/state.ts`). */
  writes: string[];
}

const jsIdent = (id: string): string => id.replace(/[^a-zA-Z0-9_]/g, '_');

export const derivedName = (nodeId: Id): string => `derived_${jsIdent(nodeId)}`;

/** Function kinds that can run in the browser, with why the others cannot. */
const CLIENT_KINDS: Record<string, string | undefined> = {
  compute: undefined,
  math: undefined,
  compare: 'Compare works on the fields of a request body, so it belongs inside an API route.',
  logic: 'Logic works on the fields of a request body, so it belongs inside an API route.',
  validate: 'Validate runs on the server, where it cannot be bypassed. Put it inside an API route.',
  gate: 'A Gate stops a request, so it belongs inside an API route.',
  code: 'A Code node runs on the server. Put it inside an API route.',
};

/** Dividing by zero yields Infinity, which is a plausible wrong number; NaN is visibly wrong. */
export const DIVIDE_HELPER = 'safeDivide';

export const DIVIDE_HELPER_SOURCE = `
function ${DIVIDE_HELPER}(left: number, right: number): number {
  return right === 0 ? Number.NaN : left / right;
}
`;

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

/** Fold the operands left to right, so `a + b + c` is one node rather than a chain of two. */
function mathExpr(node: Node, operands: string[]): { expr: string; usesDivide: boolean } {
  const operator = String(((node.config ?? {}) as { operator?: string }).operator ?? 'add');
  const numbers = operands.map((operand) => `Number(${operand})`);

  switch (operator) {
    case 'add':
      return { expr: `(${numbers.join(' + ')})`, usesDivide: false };
    case 'subtract':
      return { expr: `(${numbers.join(' - ')})`, usesDivide: false };
    case 'multiply':
      return { expr: `(${numbers.join(' * ')})`, usesDivide: false };
    case 'divide':
      return {
        expr: numbers.reduce((left, right) => `${DIVIDE_HELPER}(${left}, ${right})`),
        usesDivide: true,
      };
    case 'remainder':
      return { expr: `(${numbers.join(' % ')})`, usesDivide: false };
    case 'min':
      return { expr: `Math.min(${numbers.join(', ')})`, usesDivide: false };
    case 'max':
      return { expr: `Math.max(${numbers.join(', ')})`, usesDivide: false };
    default:
      throw new CompileError(
        `Math has unknown operation "${operator}". Known: ${Object.keys(MATH_OPERATORS).join(', ')}.`,
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

/** The data ports a derivation reads, in the order the operator folds them. */
function inputPortsOf(node: Node): string[] {
  if (node.kind !== 'math') return ['pt_input'];
  const count = mathInputCount((node.config ?? {}) as Record<string, unknown>);
  return Array.from({ length: count }, (_, index) => mathInputPortId(index));
}

/**
 * Plan the derived values one artboard needs.
 *
 * **Demand-driven**, like every other local the compiler emits: a derivation nobody binds is not
 * emitted at all, because the generated app builds with `noUnusedLocals` and a dead `const` would
 * fail its own `tsc`. So this starts from the properties that actually read something and walks
 * *backwards* along the wires.
 *
 * `plans` is read to resolve a derivation fed by an API route's result, and its `binds.result` is
 * set when that happens — the route's state has to exist for the derivation to read it.
 */
export function planDerived(
  snapshot: Snapshot,
  artboard: Artboard,
  plans: PipelinePlan[],
  states: ScreenStatePlan[] = [],
): DerivedPlan[] {
  const inside = nodesInsideRoutes(snapshot);
  const owned = componentsOf(snapshot, artboard);

  // Deliberately a plain predicate rather than a type guard: the negative branch has to keep
  // narrowing the node to what it is (a mirror, a route), not to `never`.
  const isDerivable = (node: Node | undefined): boolean =>
    Boolean(node && node.category === 'fn' && !inside.has(node.id));

  // 1. What does this screen actually read? Two kinds of demand: a property bound straight to a
  //    derivation, and a screen bucket this derivation writes into (the four-buttons-one-answer
  //    shape — `emit/state.ts`). The second is why a derivation nothing binds still gets emitted.
  const wanted: Id[] = [];
  const boundDirectly = new Set<Id>();
  for (const component of Object.values(snapshot.components)) {
    if (!owned.has(component.id)) continue;
    for (const value of Object.values(component.props)) {
      if (value.kind !== 'bound') continue;
      const target = snapshot.nodes[value.source.nodeId];
      if (target && isDerivable(target)) {
        wanted.push(target.id);
        boundDirectly.add(target.id);
      }
    }
  }
  for (const state of states) {
    for (const writer of state.writers) {
      if (writer.kind === 'derived' && isDerivable(writer.node)) wanted.push(writer.node.id);
    }
  }
  if (wanted.length === 0) return [];

  const wireInto = (nodeId: Id, portId: Id): PortRef | undefined =>
    Object.values(snapshot.wires).find(
      (wire) => wire.to.nodeId === nodeId && wire.to.portId === portId,
    )?.from;

  // 2. Walk backwards, deepest first, so a chain of derivations comes out in dependency order.
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
    for (const portId of inputPortsOf(node)) {
      const from = wireInto(nodeId, portId);
      if (from && isDerivable(snapshot.nodes[from.nodeId])) visit(from.nodeId);
    }
    state.set(nodeId, 'done');
    ordered.push(node);
  };

  for (const id of wanted) visit(id);

  /** What feeds one input port, as a JS expression. */
  const operandExpr = (node: Node, portId: Id, index: number, total: number): string => {
    const from = wireInto(node.id, portId);
    if (!from) {
      const which = total > 1 ? `input ${index + 1} of ` : '';
      throw new CompileError(
        `${which}"${node.name ?? node.id}" has nothing wired into it, so there is no value to derive.`,
        node.id,
      );
    }

    const source = snapshot.nodes[from.nodeId];
    if (!source) {
      throw new CompileError(`Wire into "${node.id}" comes from an unknown node.`, node.id);
    }

    if (isDerivable(source)) return derivedName(source.id);

    if (source.category === 'ui' && source.mirrorOf && owned.has(source.mirrorOf)) {
      // A field's mirror stands for the component's local state — the value the person typed.
      return stateNameForComponent(source.mirrorOf);
    }

    if (source.category === 'api') {
      const plan = plans.find((candidate) => candidate.node.id === source.id);
      if (!plan || from.portId !== 'pt_result') {
        throw new CompileError(
          `"${node.name ?? node.id}" reads a route output this screen does not produce.`,
          node.id,
        );
      }
      // The route's result has to exist as state for this derivation to read it.
      plan.binds.result = true;
      return `(${plan.names.state} ?? "")`;
    }

    if (source.category === 'state') {
      // Reading a variable back is what makes a running total sayable: `total = total + amount`,
      // one Math node reading the same variable it writes. It stays predictable because a write is
      // always triggered — the read happens inside the handler the button already calls, so there
      // is one answer at one moment, never a render loop.
      const bucket = states.find((entry) => entry.node.id === source.id);
      if (!bucket) {
        throw new CompileError(
          `"${node.name ?? node.id}" reads the variable "${source.name ?? source.id}", which ` +
            `this screen does not hold. Read a variable on the screen that displays it.`,
          node.id,
        );
      }
      if (from.portId !== 'pt_value') {
        throw new CompileError(
          `"${node.name ?? node.id}" reads port "${from.portId}", which is not an output of a variable.`,
          node.id,
        );
      }
      return `(${bucket.name} ?? ${stateFallback(bucket.type)})`;
    }

    throw new CompileError(
      `"${node.name ?? node.id}" reads "${source.name ?? source.id}", which produces no value in the browser.`,
      node.id,
    );
  };

  // 3. Turn each into an expression. A derivation feeding another derivation is read by name, so
  //    that counts as demand for a local of its own just as a bound property does.
  const readByName = new Set<Id>(boundDirectly);
  const expressions = ordered.map((node) => {
    const ports = inputPortsOf(node);
    const operands = ports.map((portId, index) => {
      const from = wireInto(node.id, portId);
      if (from && isDerivable(snapshot.nodes[from.nodeId])) readByName.add(from.nodeId);
      return operandExpr(node, portId, index, ports.length);
    });
    return node.kind === 'math' ? mathExpr(node, operands).expr : computeExpr(node, operands[0]!);
  });

  // 4. Decide whether each is held or recomputed, and which buckets its run sets.
  return ordered.map((node, index) => {
    const name = derivedName(node.id);
    // A trigger wired into `run` turns the derivation from a recomputation into a held value.
    const triggered = Boolean(wireInto(node.id, 'pt_run'));

    return {
      node,
      name,
      expr: expressions[index]!,
      type: node.ports.find((port) => port.id === 'pt_result')?.type ?? { kind: 'any' },
      runName: triggered ? `run_${name}` : undefined,
      bound: readByName.has(node.id),
      writes: statesWrittenBy(states, node.id).map((state) => state.setter),
    };
  });
}

/** The starting value of a triggered derivation, before its trigger has ever fired. */
function initialValue(type: TypeRef): string {
  switch (type.kind) {
    case 'number':
      return '0';
    case 'boolean':
      return 'false';
    case 'list':
      return '[]';
    default:
      return '""';
  }
}

/** True when any derivation needs the divide helper emitted alongside it. */
export function usesDivideHelper(derived: DerivedPlan[]): boolean {
  return derived.some((entry) => entry.expr.includes(`${DIVIDE_HELPER}(`));
}

/**
 * The declarations, in dependency order.
 *
 * A reactive derivation is a `const` recomputed on render — the value simply *is* the function of
 * its inputs. A triggered one is state plus the function that sets it, so the last answer stays
 * on screen until the trigger fires again.
 */
export function emitDerived(derived: DerivedPlan[]): string[] {
  const lines: string[] = [];

  for (const entry of derived) {
    if (!entry.runName) {
      lines.push(`  const ${entry.name} = ${entry.expr};`);
      continue;
    }

    if (entry.bound) {
      lines.push(
        `  const [${entry.name}, set_${entry.name}] = useState<${tsTypeOf(entry.type)}>(${initialValue(entry.type)});`,
      );
    }

    // The plain case stays a one-liner; only a run with more than one destination needs a block,
    // and then the expression is computed once into `next` rather than repeated per setter.
    const setters = [...(entry.bound ? [`set_${entry.name}`] : []), ...entry.writes];

    if (setters.length === 1) {
      lines.push(`  const ${entry.runName} = () => ${setters[0]}(${entry.expr});`);
      continue;
    }

    lines.push(`  const ${entry.runName} = () => {`);
    lines.push(`    const next = ${entry.expr};`);
    for (const setter of setters) lines.push(`    ${setter}(next);`);
    lines.push('  };');
  }

  return lines;
}
