import { actionsOf, type Artboard, type Component, type Id, type Node, type Snapshot, type TypeRef, type ValueSource } from '@loom/ir';
import { isVariable, stateKeyOf, stateScopeOf, type StateScope } from '@loom/components';
import { inferType, tsTypeOf } from '@loom/typesys';
import { CompileError } from '../types';

/**
 * Variables — the merge point of the language.
 *
 * Every other value in an emitted screen has exactly one producer: a property binds one port, a
 * derivation folds its own inputs. That is what makes the graph readable, and it is also the one
 * thing a calculator cannot express — four operations that all answer into one display. Without a
 * merge point the only way to show four answers is four Texts, which is the bug this exists to fix.
 *
 * A variable is that merge point and nothing more: **many writers, one reader, last write wins.**
 *
 * It comes in the two scopes the glossary names (`docs/06-glossary.md` §State scope):
 *
 * - **screen** — a single `useState` in one artboard's module, read and written there.
 * - **global** — one value the whole app shares, held in a context above the router, so a total
 *   computed on one screen is the same total another screen displays. Two global nodes carrying
 *   the same *name* are the same variable; that is what makes them reachable from another screen
 *   at all, since a node's id is not something a designer types.
 *
 * **Writes are always triggered.** A reactive writer would run on every render, so two of them
 * would race on each keystroke and the variable would hold whichever one React happened to
 * evaluate last — a value nobody can predict from looking at the canvas. Refusing that at compile
 * time is what keeps "last write wins" a rule a person can actually reason about.
 */

/** Something that sets a variable: an API route's result, or a function node's result. */
export interface StateWriter {
  node: Node;
  kind: 'route' | 'derived' | 'action';
  /**
   * For an action writer, the component whose event sets the variable. An action has no wire, so
   * this is the only thing that says which screen the write happens on.
   */
  firedBy?: Id;
  /** The type that writer produces, used to widen the variable. */
  type: TypeRef;
}

/**
 * One app-wide variable, shared by every screen that names it. Planned once for the whole
 * project, because its identity (its name) and its type belong to the app, not to a screen.
 */
export interface GlobalPlan {
  /** The name as the designer typed it — what the error messages say. */
  key: string;
  /** The member of the emitted `Globals` context. */
  member: string;
  /** The local an artboard destructures it into. */
  name: string;
  setter: string;
  type: TypeRef;
  /** Every `state` node carrying this name. */
  nodeIds: Id[];
}

export interface ScreenStatePlan {
  node: Node;
  scope: StateScope;
  /** Local variable holding the value, on the screen being emitted. */
  name: string;
  /** The function that writes it — a `useState` setter, or the context's setter. */
  setter: string;
  /** What the variable holds — the writers' type when they agree, `any` when they do not. */
  type: TypeRef;
  writers: StateWriter[];
  /** Whether this screen displays the value, or only writes it (a global written here, shown there). */
  reads: boolean;
  /** Set for a global, so the artboard knows which context member to destructure. */
  global?: GlobalPlan;
}

const jsIdent = (id: string): string => id.replace(/[^a-zA-Z0-9_]/g, '_');

export const screenStateName = (nodeId: Id): string => `state_${jsIdent(nodeId)}`;

/** A global's name, as a legal identifier. Two names that differ only in spacing are one variable. */
export const globalMember = (key: string): string => {
  const ident = jsIdent(key.trim().toLowerCase());
  return /^[0-9]/.test(ident) ? `v_${ident}` : ident || 'value';
};

/**
 * What an unwritten variable reads as. One that has never been written is genuinely empty —
 * before any button is pressed there is no answer — and an empty string renders as nothing rather
 * than the word "null".
 */
export const stateFallback = (type: TypeRef): string => (type.kind === 'list' ? '[]' : '""');

const label = (node: Node): string => node.name ?? node.kind;

/** Node ids sitting inside some API route's body — those run on the server. */
function insideRoutes(snapshot: Snapshot): Set<Id> {
  const inside = new Set<Id>();
  for (const node of Object.values(snapshot.nodes)) {
    if (node.category !== 'api') continue;
    for (const id of ((node.config ?? {}) as { body?: Id[] }).body ?? []) inside.add(id);
  }
  return inside;
}

/** Components belonging to one artboard. */
function componentsOf(snapshot: Snapshot, artboard: Artboard): Component[] {
  const found: Component[] = [];
  const walk = (id: Id): void => {
    const component = snapshot.components[id];
    if (!component) return;
    found.push(component);
    for (const child of component.children ?? []) walk(child);
  };
  walk(artboard.root);
  return found;
}

/** Two writers that disagree leave the variable untyped rather than silently picking one. */
function widen(writers: StateWriter[]): TypeRef {
  const first = writers[0]?.type ?? { kind: 'any' };
  return writers.every((writer) => writer.type.kind === first.kind) ? first : { kind: 'any' };
}

/**
 * Everything wired into one variable's `set` port, with the refusals that keep it predictable.
 *
 * The rules are the same in both scopes: a writer runs in the browser, and it decides *when* it
 * writes. What differs is only how far the value reaches afterwards.
 */
function writersOf(snapshot: Snapshot, node: Node, inside: Set<Id>): StateWriter[] {
  const writers: StateWriter[] = [];

  for (const wire of Object.values(snapshot.wires)) {
    if (wire.to.nodeId !== node.id || wire.to.portId !== 'pt_set') continue;

    const source = snapshot.nodes[wire.from.nodeId];
    if (!source) {
      throw new CompileError(
        `A wire into "${label(node)}" comes from a node that no longer exists.`,
        node.id,
      );
    }

    if (inside.has(source.id)) {
      // A variable is React state in the browser; a node in a route body runs on a server that
      // has no access to it. The route's own result is how a server value comes back.
      throw new CompileError(
        `"${label(source)}" is inside an API route, so it runs on the server and cannot set ` +
          `"${label(node)}". Wire the route's result into the variable instead.`,
        source.id,
      );
    }

    const resultType = source.ports.find((port) => port.id === wire.from.portId)?.type ?? {
      kind: 'any',
    };

    if (source.category === 'api') {
      if (wire.from.portId !== 'pt_result') {
        throw new CompileError(
          `Only a route's result can be kept in "${label(node)}"; "${wire.from.portId}" cannot.`,
          source.id,
        );
      }
      writers.push({ node: source, kind: 'route', type: resultType });
      continue;
    }

    if (source.category === 'fn') {
      // Triggered, always — see the note at the top of this file.
      const triggered = Object.values(snapshot.wires).some(
        (candidate) => candidate.to.nodeId === source.id && candidate.to.portId === 'pt_run',
      );
      if (!triggered) {
        throw new CompileError(
          `"${label(source)}" recomputes on its own, so it cannot decide when to set ` +
            `"${label(node)}". Wire a button into its run port, and the variable updates when ` +
            `that button is pressed.`,
          source.id,
        );
      }
      writers.push({ node: source, kind: 'derived', type: resultType });
      continue;
    }

    throw new CompileError(
      `"${label(source)}" produces no value in the browser, so it cannot set "${label(node)}".`,
      source.id,
    );
  }

  // An action writes without a wire (spec 7). It is a writer all the same — otherwise a variable
  // set only by "show the confirmation" would read as one nothing ever fills.
  for (const component of Object.values(snapshot.components)) {
    for (const value of Object.values(component.props)) {
      if (value.kind !== 'event') continue;
      for (const action of actionsOf(value.handler)) {
        if (action.kind !== 'setVariable' || action.nodeId !== node.id) continue;
        writers.push({
          node,
          kind: 'action',
          type: valueSourceType(snapshot, action.value),
          firedBy: component.id,
        });
      }
    }
  }

  return writers;
}

/** The type an action's value carries: a literal's own, or the port's it reads. */
function valueSourceType(snapshot: Snapshot, value: ValueSource): TypeRef {
  if (value.kind === 'bound') {
    const source = snapshot.nodes[value.source.nodeId];
    return source?.ports.find((port) => port.id === value.source.portId)?.type ?? { kind: 'any' };
  }
  return inferType(value.value);
}

/** Does anything anywhere in the project read this variable — a property, a condition, a wire? */
function isReadAnywhere(snapshot: Snapshot, nodeIds: Set<Id>): boolean {
  for (const component of Object.values(snapshot.components)) {
    for (const value of Object.values(component.props)) {
      if (value.kind === 'bound' && nodeIds.has(value.source.nodeId)) return true;
    }
    if (component.visibleWhen && nodeIds.has(component.visibleWhen.source.nodeId)) return true;
    for (const entry of component.conditionalStyles ?? []) {
      if (nodeIds.has(entry.when.source.nodeId)) return true;
    }
  }
  for (const wire of Object.values(snapshot.wires)) {
    if (nodeIds.has(wire.from.nodeId) && wire.from.portId === 'pt_value') return true;
  }
  return false;
}

/**
 * The app's global variables, one per name.
 *
 * Planned for the whole project rather than per screen, because a global's whole point is that
 * the screen writing it and the screen reading it are different screens. It stays **demand-driven**
 * all the same: a global nothing reads anywhere is not emitted, since the generated app builds
 * with `noUnusedLocals`.
 */
export function planGlobals(snapshot: Snapshot): GlobalPlan[] {
  const inside = insideRoutes(snapshot);

  const groups = new Map<string, { key: string; nodes: Node[] }>();
  for (const node of Object.values(snapshot.nodes)) {
    if (node.category !== 'state' || stateScopeOf(node) !== 'global') continue;
    const member = globalMember(stateKeyOf(node));
    const group = groups.get(member) ?? { key: stateKeyOf(node), nodes: [] };
    group.nodes.push(node);
    groups.set(member, group);
  }

  const plans: GlobalPlan[] = [];

  for (const [member, group] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const nodeIds = new Set(group.nodes.map((node) => node.id));
    // A global nobody displays is dead state, and dead state fails the emitted app's own build.
    if (!isReadAnywhere(snapshot, nodeIds)) continue;

    const writers = group.nodes.flatMap((node) => writersOf(snapshot, node, inside));
    if (writers.length === 0) {
      throw new CompileError(
        `Nothing is wired into the global "${group.key}", so it never holds anything. ` +
          `Wire a result into its set port.`,
        group.nodes[0]!.id,
      );
    }

    plans.push({
      key: group.key,
      member,
      name: `global_${member}`,
      setter: `set_global_${member}`,
      type: widen(writers),
      nodeIds: [...nodeIds].sort(),
    });
  }

  return plans;
}

/** Where a mirror's component lives, if it is a mirror at all. */
function artboardOfMirror(snapshot: Snapshot, node: Node | undefined): Id | undefined {
  if (!node || node.category !== 'ui' || !node.mirrorOf) return undefined;
  for (const [artboardId, artboard] of Object.entries(snapshot.artboards)) {
    const stack = [artboard.root];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (id === node.mirrorOf) return artboardId;
      stack.push(...(snapshot.components[id]?.children ?? []));
    }
  }
  return undefined;
}

/**
 * Which screen a writer runs on.
 *
 * A write is always triggered, so the answer is simply: **the screen holding the button that
 * fires it.** That matters for a global, which several screens can read — without it, a screen
 * that only displays the total would try to emit the other screen's Math node, reading fields
 * that do not exist there.
 */
function writerRunsOn(snapshot: Snapshot, writer: StateWriter, artboardId: Id): boolean {
  // An action has no wire to reason about: it runs on the screen holding the component that
  // fires it, and nowhere else.
  if (writer.kind === 'action') {
    const artboard = snapshot.artboards[artboardId];
    if (!artboard || !writer.firedBy) return false;
    return componentsOf(snapshot, artboard).some((component) => component.id === writer.firedBy);
  }

  const triggerWires = Object.values(snapshot.wires).filter(
    (wire) => wire.to.nodeId === writer.node.id && wire.to.portId === 'pt_run',
  );

  for (const wire of triggerWires) {
    if (artboardOfMirror(snapshot, snapshot.nodes[wire.from.nodeId]) === artboardId) return true;
  }
  if (triggerWires.length > 0) return false;

  // A reactive route has no button: it belongs to the screen whose inputs it reads, or whose
  // properties bind its outputs. (A reactive *function* node can never be a writer at all.)
  if (writer.kind !== 'route') return false;

  for (const wire of Object.values(snapshot.wires)) {
    if (wire.to.nodeId !== writer.node.id) continue;
    if (artboardOfMirror(snapshot, snapshot.nodes[wire.from.nodeId]) === artboardId) return true;
  }
  const artboard = snapshot.artboards[artboardId];
  if (!artboard) return false;
  for (const component of componentsOf(snapshot, artboard)) {
    for (const value of Object.values(component.props)) {
      if (value.kind === 'bound' && value.source.nodeId === writer.node.id) return true;
    }
  }
  return false;
}

/**
 * The variables one artboard touches, each with the writers that run on this screen.
 *
 * **Demand-driven**, like every other local: a variable nothing on this screen reads is not
 * emitted, because the generated app builds with `noUnusedLocals` and a dead `useState` would
 * fail its own `tsc`. Demand is transitive — a variable read by a function node that is itself
 * demanded is demanded too, which is what makes a running total expressible.
 */
export function planScreenStates(
  snapshot: Snapshot,
  artboard: Artboard,
  globals: GlobalPlan[] = [],
): ScreenStatePlan[] {
  const inside = insideRoutes(snapshot);
  const globalOf = new Map<Id, GlobalPlan>();
  for (const plan of globals) for (const id of plan.nodeIds) globalOf.set(id, plan);

  // 1. What does this screen read? Properties and conditions seed it; then follow the wires
  //    backwards, because a function node that is displayed demands whatever feeds it, and that
  //    may be a variable, whose writers in turn demand their own inputs.
  const demanded = new Set<Id>();
  const queue: Id[] = [];
  const demand = (nodeId: Id): void => {
    if (demanded.has(nodeId)) return;
    demanded.add(nodeId);
    queue.push(nodeId);
  };

  for (const component of componentsOf(snapshot, artboard)) {
    for (const value of Object.values(component.props)) {
      if (value.kind === 'bound') demand(value.source.nodeId);
    }
    if (component.visibleWhen) demand(component.visibleWhen.source.nodeId);
    for (const entry of component.conditionalStyles ?? []) demand(entry.when.source.nodeId);
  }

  // Read here, as opposed to only written here: a screen that fills a global another screen
  // displays needs the setter and nothing else.
  const wanted = new Set<Id>();

  while (queue.length > 0) {
    const nodeId = queue.pop()!;
    const node = snapshot.nodes[nodeId];
    if (!node) continue;

    if (isVariable(node)) {
      wanted.add(nodeId);
      // Reading a variable demands whatever writes it, on this screen.
      for (const writer of writersOf(snapshot, node, inside)) {
        if (writerRunsOn(snapshot, writer, artboard.id)) demand(writer.node.id);
      }
      continue;
    }

    if (node.category !== 'fn' || inside.has(nodeId)) continue;

    // A function node reads its data inputs; any of them may be a variable.
    for (const wire of Object.values(snapshot.wires)) {
      if (wire.to.nodeId !== nodeId) continue;
      const port = node.ports.find((entry) => entry.id === wire.to.portId);
      if (port?.portKind !== 'data') continue;
      demand(wire.from.nodeId);
    }
  }

  const readHere = new Set<Id>(wanted);

  // A global this screen only *writes* is demanded too: the write is real work that happens here,
  // even though the value is displayed somewhere else entirely. That is the whole point of a
  // global, and without this the button that fills it would compile to a handler pointing at
  // nothing.
  for (const global of globals) {
    for (const id of global.nodeIds) {
      const node = snapshot.nodes[id];
      if (!node) continue;
      const writers = writersOf(snapshot, node, inside);
      if (writers.some((writer) => writerRunsOn(snapshot, writer, artboard.id))) {
        wanted.add(id);
        for (const writer of writers) {
          if (writerRunsOn(snapshot, writer, artboard.id)) demand(writer.node.id);
        }
      }
    }
  }

  // 2. Plan each demanded variable with the writers that run here.
  const plans: ScreenStatePlan[] = [];
  const plannedGlobals = new Set<string>();

  for (const stateId of [...wanted].sort()) {
    const node = snapshot.nodes[stateId]!;
    const scope = stateScopeOf(node);
    const global = globalOf.get(stateId);

    if (scope === 'global') {
      // A global's writers belong to the *name*, not to the node: the screen that computes the
      // total and the screen that displays it each drop their own node, and they are one variable.
      if (!global || plannedGlobals.has(global.member)) continue;
      plannedGlobals.add(global.member);

      const writers = global.nodeIds
        .flatMap((id) => {
          const owner = snapshot.nodes[id];
          return owner ? writersOf(snapshot, owner, inside) : [];
        })
        .filter((writer) => writerRunsOn(snapshot, writer, artboard.id));

      plans.push({
        node,
        scope,
        name: global.name,
        setter: global.setter,
        type: global.type,
        writers,
        reads: global.nodeIds.some((id) => readHere.has(id)),
        global,
      });
      continue;
    }

    const all = writersOf(snapshot, node, inside);
    if (all.length === 0) {
      throw new CompileError(
        `Nothing is wired into "${label(node)}", so it never holds anything. ` +
          `Wire a result into its set port.`,
        stateId,
      );
    }

    const writers = all.filter((writer) => writerRunsOn(snapshot, writer, artboard.id));
    if (writers.length === 0) {
      // Everything that writes it is fired from another screen, and a screen variable is that
      // screen's own `useState` — it cannot reach across. The fix is the scope, so say so.
      throw new CompileError(
        `"${label(node)}" is written from another screen, and a screen variable belongs to the ` +
          `screen that shows it. Set its scope to global to share one value across screens.`,
        stateId,
      );
    }

    plans.push({
      node,
      scope,
      name: screenStateName(stateId),
      setter: `set_${screenStateName(stateId)}`,
      type: widen(writers),
      writers,
      reads: true,
    });
  }

  return plans;
}

/** The variables a given node's result is kept in, on this screen. */
export function statesWrittenBy(states: ScreenStatePlan[], nodeId: Id): ScreenStatePlan[] {
  return states.filter((state) => state.writers.some((writer) => writer.node.id === nodeId));
}

/**
 * The declarations, screen variables first.
 *
 * A screen variable is a `useState` of its own. A global is one member of the app's context,
 * destructured under the same name every screen uses for it — several nodes may name the same
 * global, so the destructuring is deduplicated.
 */
export function emitScreenStates(states: ScreenStatePlan[]): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();

  for (const state of states) {
    if (state.scope === 'global') continue;
    lines.push(
      `  const [${state.name}, set_${state.name}] = useState<${tsTypeOf(state.type)} | null>(null);`,
    );
  }

  // A screen destructures only the halves it uses: the value when it displays it, the setter when
  // it writes it. The emitted app builds with `noUnusedLocals`, so an unused half is a failed build.
  const members = new Map<string, { plan: GlobalPlan; reads: boolean; writes: boolean }>();
  for (const state of states) {
    if (state.scope !== 'global' || !state.global) continue;
    const current = members.get(state.global.member) ?? {
      plan: state.global,
      reads: false,
      writes: false,
    };
    current.reads = current.reads || state.reads;
    current.writes = current.writes || state.writers.length > 0;
    members.set(state.global.member, current);
  }

  for (const [member, use] of members) {
    if (seen.has(member)) continue;
    seen.add(member);
    const parts = [
      ...(use.reads ? [`${member}: ${use.plan.name}`] : []),
      ...(use.writes ? [`set_${member}: ${use.plan.setter}`] : []),
    ];
    if (parts.length === 0) continue;
    lines.push(`  const { ${parts.join(', ')} } = useGlobals();`);
  }

  return lines;
}

/** True when this screen reads or writes any app-wide variable, so it needs the context hook. */
export function usesGlobals(states: ScreenStatePlan[]): boolean {
  return states.some((state) => state.scope === 'global');
}
