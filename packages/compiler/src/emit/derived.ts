import {
  actionsOf,
  type Artboard,
  type Id,
  type Node,
  type PortRef,
  type Snapshot,
  type TypeRef,
} from '@loom/ir';
import {
  COMPUTE_OPS,
  isVariable,
  mathInputCount,
  mathInputPortId,
  MATH_OPERATORS,
} from '@loom/components';
import { tsTypeOf } from '@loom/typesys';
import { authVar } from './auth';
import { isCurrentOrg } from './tenancy';
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
  /** True when this derivation reads the session — the module has to hold `useAuth()` (O2). */
  readsSession?: boolean;
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
  /**
   * Compare and Logic read **fields of a request body** by name, and there is no body in the
   * browser — so outside a route they are refused, unless their input is wired.
   *
   * A wired input is a different thing entirely: the value comes down the wire rather than out of
   * a request, and the comparison is ordinary arithmetic on something already on the screen.
   * "Only for admins" is exactly that — the current org's role against a name — and refusing it
   * would mean the one comparison every multi-tenant app needs was the one it could not make
   * (O2).
   */
  compare:
    'Compare reads a field of a request body, so it belongs inside an API route — unless something is wired into it.',
  logic:
    'Logic reads a field of a request body, so it belongs inside an API route — unless something is wired into it.',
  validate: 'Validate runs on the server, where it cannot be bypassed. Put it inside an API route.',
  gate: 'A Gate stops a request, so it belongs inside an API route.',
  code: 'A Code node runs on the server. Put it inside an API route.',
};

/**
 * Kinds whose refusal is lifted by having something wired in.
 *
 * Not the whole list: a Validate or a Gate runs on the server because that is where it *cannot be
 * bypassed*, and a wire does not change that. These two are refused only because a request body
 * does not exist in a browser, which a wire genuinely answers.
 */
const WIRED_IS_ENOUGH = new Set(['compare', 'logic']);

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
/**
 * The session values a derivation may read (O2).
 *
 * Deliberately the same expressions the *binding* path emits, so a role compared in a Compare node
 * and a role shown in a Text are reading one thing. A second way to spell it would eventually
 * disagree with the first.
 */
function sessionOperand(source: Node, portId: string): string | undefined {
  const auth = authVar();

  if (isCurrentOrg(source)) {
    if (portId === 'pt_role') return `(${auth}.org?.role ?? "")`;
    if (portId === 'pt_id') return `(${auth}.org?.id ?? "")`;
    if (portId === 'pt_name') return `(${auth}.org?.name ?? "")`;
    return undefined;
  }

  if (portId === 'pt_email') return `(${auth}.user?.email ?? "")`;
  if (portId === 'pt_id') return `(${auth}.user?.id ?? "")`;
  if (portId === 'pt_signedIn') return `(${auth}.user !== null)`;
  return undefined;
}

export function planDerived(
  snapshot: Snapshot,
  artboard: Artboard,
  plans: PipelinePlan[],
  states: ScreenStatePlan[] = [],
): DerivedPlan[] {
  /** Set when anything derived reads the session, so the module knows to ask for it. */
  let readsSession = false;
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
  /**
   * A **condition** is demand too, and it was not counted.
   *
   * `visibleWhen` and a conditional style read a boolean the same way a bound property reads a
   * value — the only difference is where the reference is written down. Without this, a
   * derivation used by nothing but a condition is never planned, and the screen fails to compile
   * with "reads a node this screen does not produce a value from" while pointing at a node that
   * is right there. Found while wiring roles (O2), where "visible to admins" is a Compare that
   * exactly nothing else reads.
   */
  const wantCondition = (condition: { source: PortRef } | undefined): void => {
    if (!condition) return;
    const target = snapshot.nodes[condition.source.nodeId];
    if (target && isDerivable(target)) {
      wanted.push(target.id);
      boundDirectly.add(target.id);
    }
  };
  for (const component of Object.values(snapshot.components)) {
    if (!owned.has(component.id)) continue;
    wantCondition(component.visibleWhen);
    for (const entry of component.conditionalStyles ?? []) wantCondition(entry.when);
    for (const value of Object.values(component.props)) {
      if (value.kind !== 'event') continue;
      for (const action of actionsOf(value.handler)) wantCondition(action.when);
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
    // Wired means it reads a value, not a request body — see CLIENT_KINDS.
    const wired = WIRED_IS_ENOUGH.has(node.kind) && Boolean(wireInto(nodeId, 'pt_input'));
    if (reason !== undefined && !wired) throw new CompileError(reason, nodeId);

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

    if (source.category === 'state' && !isVariable(source)) {
      /**
       * Folding the session into an expression (O2).
       *
       * This used to be refused, with a comment saying nothing needed it yet — roles are that
       * demand. "Only for admins" is a comparison against `Current org`'s role, and a comparison
       * is what a Compare node is. The alternative was a second way to say a condition living in
       * the inspector, which is the inline expression language loom refuses.
       *
       * Read-only, and it stays read-only: these are values the server decided.
       */
      const session = sessionOperand(source, from.portId);
      if (session) {
        readsSession = true;
        return session;
      }

      throw new CompileError(
        `"${node.name ?? node.id}" reads a part of the session that cannot be compared. The id, ` +
          `the email and the role can be.`,
        node.id,
      );
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
    if (node.kind === 'math') return mathExpr(node, operands).expr;
    // A wired Compare in the browser: the value came down the wire, the other side is the literal
    // the node was configured with (O2).
    if (node.kind === 'compare') return compareExpr(node, operands[0]!);
    return computeExpr(node, operands[0]!);
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
      readsSession,
      bound: readByName.has(node.id),
      writes: statesWrittenBy(states, node.id).map((state) => state.setter),
    };
  });
}

/** Does anything on this screen fold the session into a value? Then the module needs `useAuth()`. */
export function derivedReadsSession(derived: readonly DerivedPlan[]): boolean {
  return derived.some((entry) => entry.readsSession === true);
}

/**
 * A comparison, in the browser.
 *
 * Only the wired shape: the left side is what came down the wire, the right side is what the node
 * was configured with. Comparing two *body fields* is still a server thing and still refused,
 * because there is no body here to read them from.
 */
const COMPARE_JS: Record<string, string> = {
  equals: '===',
  notEquals: '!==',
  greaterThan: '>',
  lessThan: '<',
  atLeast: '>=',
  atMost: '<=',
};

function compareExpr(node: Node, left: string): string {
  const config = (node.config ?? {}) as { operator?: string; rightKind?: string; right?: unknown };
  const operator = COMPARE_JS[config.operator ?? 'equals'];
  if (!operator) {
    throw new CompileError(
      `Compare node has an unknown comparison "${String(config.operator)}".`,
      node.id,
    );
  }

  if (config.rightKind && config.rightKind !== 'value') {
    throw new CompileError(
      `"${node.name ?? node.id}" compares against a field of a request body, which does not ` +
        `exist in the browser. Compare against a value, or put it inside an API route.`,
      node.id,
    );
  }

  const right = String(config.right ?? '');
  // Numeric comparisons on text would be string ordering, which is a wrong answer that looks
  // right for single digits and then does not.
  const literal =
    operator === '===' || operator === '!=='
      ? JSON.stringify(right)
      : Number.isFinite(Number(right))
        ? String(Number(right))
        : JSON.stringify(right);

  return `(${left} ${operator} ${literal})`;
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
