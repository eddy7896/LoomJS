import type { Artboard, Component, Id, Node, Port, PortRef, Snapshot, TypeRef, Wire } from '@loom/ir';
import { canConnect, tsTypeOf } from '@loom/typesys';
import { CompileError } from '../types';
import type { DerivedPlan } from './derived';
import { stateFallback, statesWrittenBy, type ScreenStatePlan } from './state';

/**
 * The binding & trigger runtime (`docs/specs/binding-trigger-runtime.md`), compiled.
 *
 * A pipeline is an API route node plus the wires around it. Everything **inside** the API node's
 * body runs on the server, in the emitted Vercel function; everything outside runs in the browser.
 * The container boundary *is* the network boundary — that is why the API node is a container and
 * not a flat sub-graph (`03` open decision 3).
 *
 * Nothing here ships a runtime library: a bound property compiles to a plain state read, and a
 * pipeline compiles to an async function a developer would recognise as hand-written.
 */

export interface PipelinePlan {
  /** The API route node. */
  node: Node;
  /** Route path, e.g. `/api/run`. */
  routePath: string;
  method: 'GET' | 'POST';
  /** Server-side function nodes, in execution order. */
  body: Node[];
  /** Component whose event fires this pipeline, if it is triggered rather than reactive. */
  trigger: { componentId: Id; event: string } | undefined;
  /** Components supplying input values, one per wired input port. */
  inputs: { componentId: Id; port: Port }[];
  /** The type the route returns, taken from its `result` port. */
  resultType: TypeRef;
  /** Which output ports something on this artboard binds. Unbound outputs emit no state. */
  binds: { result: boolean; pending: boolean; error: boolean };
  /** Screen buckets this pipeline's result is kept in. The buckets themselves are declared by
   * `emit/state.ts`; a pipeline only knows which ones its success path has to set. */
  states: ScreenStatePlan[];
  /** Tables this route reads, and tables it changes. A write invalidates a read of the same one. */
  tables: { reads: string[]; writes: string[] };
  /** Local identifiers used in the emitted module. */
  names: { state: string; pending: string; error: string; run: string };
}

/**
 * The re-read counter for one table.
 *
 * A reactive read runs on mount and when its inputs change — and a row inserted by *another*
 * pipeline is neither, so the list on screen kept showing the world as it was before the write.
 * The fix is the one a developer would write by hand: a counter per table, bumped by whatever
 * changes it, and named in the effect's dependencies of whatever reads it
 * (`docs/specs/binding-trigger-runtime.md`).
 */
export const tableVersionName = (table: string): string => `rows_${jsIdent(table)}`;

/** Tables that are both read reactively and written on this screen — the only ones that need one. */
export function invalidatedTables(plans: PipelinePlan[]): string[] {
  const written = new Set(plans.flatMap((plan) => plan.tables.writes));
  const reread = new Set(
    plans.filter((plan) => !plan.trigger).flatMap((plan) => plan.tables.reads),
  );
  return [...written].filter((table) => reread.has(table)).sort();
}

/** Output ports of an API route node that a property may bind to. */
const OUTPUT_PORTS = { pt_result: 'result', pt_pending: 'pending', pt_error: 'error' } as const;
type OutputPortId = keyof typeof OUTPUT_PORTS;

const jsIdent = (id: string): string => id.replace(/[^a-zA-Z0-9_]/g, '_');

export function stateNameForComponent(componentId: Id): string {
  return `field_${jsIdent(componentId)}`;
}

function portOf(node: Node, portId: Id): Port | undefined {
  return node.ports.find((port) => port.id === portId);
}

function resolvePort(snapshot: Snapshot, ref: PortRef, wireId: Id): { node: Node; port: Port } {
  const node = snapshot.nodes[ref.nodeId];
  if (!node) throw new CompileError(`Wire "${wireId}" references unknown node ${ref.nodeId}.`, wireId);
  const port = portOf(node, ref.portId);
  if (!port) {
    throw new CompileError(`Wire "${wireId}" references unknown port ${ref.portId}.`, wireId);
  }
  return { node, port };
}

/**
 * Every wire is checked before anything is emitted: direction, port kind, then type. An
 * incompatible wire is a Build error carrying the wire's id, never a runtime surprise
 * (`docs/specs/type-registry.md`).
 */
export function validateWires(snapshot: Snapshot): void {
  for (const wire of Object.values(snapshot.wires)) {
    const from = resolvePort(snapshot, wire.from, wire.id);
    const to = resolvePort(snapshot, wire.to, wire.id);
    const check = canConnect(from.port, to.port);
    if (!check.ok) {
      throw new CompileError(`Wire "${wire.id}" is invalid: ${check.reason}`, wire.id);
    }
  }
}

const wiresInto = (snapshot: Snapshot, nodeId: Id, portId: Id): Wire[] =>
  Object.values(snapshot.wires).filter(
    (wire) => wire.to.nodeId === nodeId && wire.to.portId === portId,
  );

/** Components belonging to one artboard, by id. */
function componentsOf(snapshot: Snapshot, artboard: Artboard): Set<Id> {
  const ids = new Set<Id>();
  const walk = (id: Id): void => {
    ids.add(id);
    for (const child of snapshot.components[id]?.children ?? []) walk(child);
  };
  walk(artboard.root);
  return ids;
}

/** The component a mirror node stands for, if it lives on this artboard. */
function mirrorComponent(
  snapshot: Snapshot,
  node: Node,
  owned: Set<Id>,
): Component | undefined {
  if (node.category !== 'ui' || !node.mirrorOf) return undefined;
  if (!owned.has(node.mirrorOf)) return undefined;
  return snapshot.components[node.mirrorOf];
}

/**
 * Plan the pipelines that touch one artboard. A pipeline is *triggered* when a trigger port is
 * wired into its run port and *reactive* otherwise — derived, never configured.
 */
export function planPipelines(
  snapshot: Snapshot,
  artboard: Artboard,
  screenStates: ScreenStatePlan[] = [],
): PipelinePlan[] {
  const owned = componentsOf(snapshot, artboard);
  const plans: PipelinePlan[] = [];

  const apiNodes = Object.values(snapshot.nodes)
    .filter((node) => node.category === 'api')
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const node of apiNodes) {
    const config = (node.config ?? {}) as { method?: string; path?: string; body?: Id[] };
    const routeName = String(config.path ?? 'run').replace(/[^a-zA-Z0-9_-]/g, '') || 'run';
    const method = config.method === 'GET' ? 'GET' : 'POST';

    const body = (config.body ?? [])
      .map((id) => snapshot.nodes[id])
      .filter((child): child is Node => Boolean(child));

    for (const child of config.body ?? []) {
      if (!snapshot.nodes[child]) {
        throw new CompileError(`API route "${node.name ?? node.id}" contains a missing node.`, node.id);
      }
    }

    // Trigger: a UI mirror's trigger port wired into this node's run port.
    let trigger: PipelinePlan['trigger'];
    for (const wire of wiresInto(snapshot, node.id, 'pt_run')) {
      const source = snapshot.nodes[wire.from.nodeId];
      const component = source ? mirrorComponent(snapshot, source, owned) : undefined;
      if (!component) continue;
      trigger = { componentId: component.id, event: 'onClick' };
    }

    // Inputs: every UI mirror data port wired into one of this node's data inputs. The route's
    // input ports come from its body (a form wires straight into the columns an insert needs).
    const inputs: PipelinePlan['inputs'] = [];
    for (const inputPort of node.ports.filter((p) => p.direction === 'in' && p.portKind === 'data')) {
      for (const wire of wiresInto(snapshot, node.id, inputPort.id)) {
        const source = snapshot.nodes[wire.from.nodeId];
        const component = source ? mirrorComponent(snapshot, source, owned) : undefined;
        if (!component || !source) continue;
        if (portOf(source, wire.from.portId)) inputs.push({ componentId: component.id, port: inputPort });
      }
    }

    const binds = { result: false, pending: false, error: false };
    for (const component of Object.values(snapshot.components)) {
      if (!owned.has(component.id)) continue;
      for (const value of Object.values(component.props)) {
        if (value.kind !== 'bound' || value.source.nodeId !== node.id) continue;
        const name = OUTPUT_PORTS[value.source.portId as OutputPortId];
        if (!name) {
          throw new CompileError(
            `Property binds port "${value.source.portId}", which is not an output of the API route.`,
            component.id,
          );
        }
        binds[name] = true;
      }
    }

    // Which tables the body touches, so a write can invalidate a read of the same one.
    const tables = { reads: [] as string[], writes: [] as string[] };
    for (const step of body) {
      if (step.category !== 'db') continue;
      const stepConfig = (step.config ?? {}) as { table?: string; operation?: string };
      const table = String(stepConfig.table ?? '');
      if (!table) continue;
      const side = stepConfig.operation === 'select' ? tables.reads : tables.writes;
      if (!side.includes(table)) side.push(table);
    }

    // Writes: the screen buckets this route's result is kept in.
    const states = statesWrittenBy(screenStates, node.id);
    const resultType = portOf(node, 'pt_result')?.type ?? { kind: 'any' };

    const bound = binds.result || binds.pending || binds.error;

    // A pipeline this artboard neither fires nor reads belongs to another screen.
    if (!trigger && inputs.length === 0 && !bound && states.length === 0) continue;

    const ident = jsIdent(node.id);
    plans.push({
      node,
      routePath: `/api/${routeName}`,
      method,
      body,
      trigger,
      inputs,
      resultType,
      binds,
      states,
      tables,
      names: {
        state: `result_${ident}`,
        pending: `pending_${ident}`,
        error: `error_${ident}`,
        run: `run_${ident}`,
      },
    });
  }

  return plans;
}

/** The state variable a bound property reads. */
export function bindingExpr(
  plans: PipelinePlan[],
  derived: DerivedPlan[],
  states: ScreenStatePlan[],
  source: PortRef,
  componentId: Id,
): string {
  // A derived value is a plain local: no request, no state, just the constant computed above.
  const derivation = derived.find((entry) => entry.node.id === source.nodeId);
  if (derivation) {
    if (source.portId !== 'pt_result') {
      throw new CompileError(
        `Bound property reads port "${source.portId}", which is not an output of that function.`,
        componentId,
      );
    }
    return derivation.name;
  }

  // A bucket is read directly: the value outlives whatever produced it, which is the whole point
  // of keeping it. Many writers, one reader — see `emit/state.ts`.
  for (const state of states) {
    if (state.node.id !== source.nodeId) continue;
    if (source.portId !== 'pt_value') {
      throw new CompileError(
        `Bound property reads port "${source.portId}", which is not an output of the state node.`,
        componentId,
      );
    }
    return `${state.name} ?? ${stateFallback(state.type)}`;
  }

  const plan = plans.find((candidate) => candidate.node.id === source.nodeId);
  if (!plan) {
    throw new CompileError(
      `Bound property reads a node this screen does not produce a value from. ` +
        'A function node only runs when it is inside an API route, or wired from something on ' +
        'this artboard.',
      componentId,
    );
  }

  switch (source.portId as OutputPortId) {
    case 'pt_result':
      // Fall back in the shape the reader expects: an empty list renders as nothing, an empty
      // string renders as nothing, and neither crashes the tree while the call is in flight.
      return `${plan.names.state} ?? ${plan.resultType.kind === 'list' ? '[]' : '""'}`;
    case 'pt_pending':
      return `${plan.names.pending} ? "true" : "false"`;
    case 'pt_error':
      return `${plan.names.error} ?? ""`;
    default:
      throw new CompileError(
        `Bound property reads port "${source.portId}", which is not an output of the API route.`,
        componentId,
      );
  }
}

/**
 * The type a bound property receives. Emitters use it to render safely — an object dropped into
 * JSX as a child crashes React, so the Text template needs to know before it emits.
 */
export function boundTypeOf(
  plans: PipelinePlan[],
  derived: DerivedPlan[],
  states: ScreenStatePlan[],
  source: PortRef,
): TypeRef | undefined {
  const derivation = derived.find((entry) => entry.node.id === source.nodeId);
  if (derivation) {
    return derivation.node.ports.find((port) => port.id === source.portId)?.type;
  }

  for (const state of states) {
    if (state.node.id === source.nodeId) return state.type;
  }

  for (const plan of plans) {
    if (plan.node.id !== source.nodeId) continue;
    if (source.portId === 'pt_result') return plan.resultType;
    if (source.portId === 'pt_pending') return { kind: 'boolean' };
    if (source.portId === 'pt_error') return { kind: 'optional', of: { kind: 'text' } };
  }
  return undefined;
}

/**
 * The `useState` / `run` prelude for every pipeline on an artboard.
 *
 * State is **demand-driven**: an output nobody binds emits no variable, because the emitted app
 * type-checks with `noUnusedLocals` and dead state would fail its own build. An unbound failure
 * still surfaces — it goes to the console instead of a state nobody reads.
 */
export function emitPipelinePrelude(plans: PipelinePlan[]): string[] {
  const lines: string[] = [];

  for (const table of invalidatedTables(plans)) {
    const name = tableVersionName(table);
    lines.push(`  const [${name}, set_${name}] = useState(0);`);
  }

  for (const plan of plans) {
    if (plan.binds.result) {
      const type = tsTypeOf(plan.resultType);
      lines.push(
        `  const [${plan.names.state}, set_${plan.names.state}] = useState<${type} | null>(null);`,
      );
    }
    if (plan.binds.pending) {
      lines.push(`  const [${plan.names.pending}, set_${plan.names.pending}] = useState(false);`);
    }
    if (plan.binds.error) {
      lines.push(
        `  const [${plan.names.error}, set_${plan.names.error}] = useState<string | null>(null);`,
      );
    }
  }

  for (const plan of plans) {
    const single = plan.inputs.length === 1 && plan.inputs[0]!.port.id === 'pt_input';
    // One unnamed input travels as itself; named inputs (an insert's columns) travel as a record
    // keyed by port name, which is exactly the row the server inserts.
    const payload = single
      ? `{ input: ${stateNameForComponent(plan.inputs[0]!.componentId)} }`
      : plan.inputs.length > 0
        ? `{ input: { ${plan.inputs
            .map((input) => `${JSON.stringify(input.port.name)}: ${stateNameForComponent(input.componentId)}`)
            .join(', ')} } }`
        : '{}';

    const call =
      plan.method === 'GET'
        ? `await fetch(${JSON.stringify(plan.routePath)} + "?input=" + encodeURIComponent(String(${
            single ? stateNameForComponent(plan.inputs[0]!.componentId) : '""'
          })))`
        : `await fetch(${JSON.stringify(plan.routePath)}, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(${payload}),
      })`;

    const start = plan.binds.pending ? `    set_${plan.names.pending}(true);\n` : '';
    const clearError = plan.binds.error ? `    set_${plan.names.error}(null);\n` : '';
    const cast = `as ${tsTypeOf(plan.resultType)} | null`;
    const writes = [
      ...(plan.binds.result
        ? [`      set_${plan.names.state}((body.result ?? null) ${cast});`]
        : []),
      // The state write happens here, in the same success path: a screen-bucket write is a
      // `setState` after the call returns, not a second round trip.
      ...plan.states.map((state) => `      ${state.setter}((body.result ?? null) ${cast});`),
    ];
    // Anything this route changed is now stale everywhere it is read on this screen.
    const invalidate = invalidatedTables(plans)
      .filter((table) => plan.tables.writes.includes(table))
      .map((table) => `      set_${tableVersionName(table)}((n) => n + 1);`);
    const store =
      writes.length > 0 || invalidate.length > 0
        ? [...writes, ...invalidate].join('\n')
        : '      void body;';
    const onError = plan.binds.error
      ? `      set_${plan.names.error}(error instanceof Error ? error.message : String(error));`
      : '      console.error(error);';
    // The run reports whether it worked, so an action sequence can stop where it failed: a
    // "save, then navigate" that navigated anyway would show someone a success they did not get
    // (`docs/specs/actions.md`). Callers that do not care simply ignore it.
    const settle = plan.binds.pending
      ? `    } finally {\n      set_${plan.names.pending}(false);\n    }`
      : '    }';

    lines.push(`
  const ${plan.names.run} = useCallback(async () => {
${start}${clearError}    try {
      const response = ${call};
      if (!response.ok) throw new Error("Request failed with " + response.status);
      const body = (await response.json()) as { result?: unknown };
${store}
      return true;
    } catch (error) {
${onError}
      return false;
${settle}
  }, [${[...new Set(plan.inputs.map((input) => stateNameForComponent(input.componentId)))].join(', ')}]);`);

    // No trigger wired in means the pipeline is reactive: run on mount, on input change, and
    // whenever something else on this screen changed a table it reads.
    if (!plan.trigger) {
      const watching = invalidatedTables(plans)
        .filter((table) => plan.tables.reads.includes(table))
        .map((table) => `, ${tableVersionName(table)}`)
        .join('');
      lines.push(`
  useEffect(() => {
    void ${plan.names.run}();
  }, [${plan.names.run}${watching}]);`);
    }
  }

  return lines;
}
