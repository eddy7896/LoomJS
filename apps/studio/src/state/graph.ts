import {
  newId,
  newNodeId,
  newPortId,
  newWireId,
  type Id,
  type Action,
  type Node,
  type NodeCategory,
  type Op,
  type PortRef,
  type Snapshot,
} from '@loom/ir';
import { acceptsManyWires, createNode, defForNode, mirrorPortsFor } from '@loom/components';
import { canConnect } from '@loom/typesys';
import { artboardOf, dispatch, dispatchAll, getState, select } from './store';
import { actionsFor } from './actions';

/**
 * Nodes-mode document operations. Wiring is validated here with the same rules the compiler
 * uses (`@loom/typesys`) so an illegal wire is refused at the gesture — the **Problems** tier —
 * instead of failing later in the Build tier (`docs/specs/type-registry.md`).
 */

export function nodeById(snapshot: Snapshot, id: Id): Node | undefined {
  return snapshot.nodes[id];
}

/** The mirror node standing for a component, if one has been materialised. */
export function mirrorNodeFor(snapshot: Snapshot, componentId: Id): Node | undefined {
  return Object.values(snapshot.nodes).find(
    (node) => node.category === 'ui' && node.mirrorOf === componentId,
  );
}

/**
 * Mirrors are materialised lazily, on the first wire that touches one. Creating one per component
 * up front would fill the document with nodes nobody wired and add undo noise for a view change.
 */
export function ensureMirror(componentId: Id, position: { x: number; y: number }): Id | undefined {
  const snapshot = getState().snapshot;
  const existing = mirrorNodeFor(snapshot, componentId);
  if (existing) return existing.id;

  const component = snapshot.components[componentId];
  if (!component) return undefined;

  const ports = mirrorPortsFor(component.type);
  if (ports.length === 0) return undefined;

  const id = newNodeId();
  dispatch({
    type: 'addNode',
    node: {
      id,
      category: 'ui',
      kind: 'mirror',
      name: component.name ?? component.type,
      mirrorOf: componentId,
      ports,
      position,
    },
  });
  return id;
}

/**
 * Where a new node lands. Everything at one fixed point means the second node you add hides the
 * first, so free nodes step down and to the right of what is already on the canvas.
 */
function freePosition(snapshot: Snapshot): { x: number; y: number } {
  const placed = Object.values(snapshot.nodes).filter((node) => !node.mirrorOf);
  if (placed.length === 0) return { x: 360, y: 80 };
  const lowest = Math.max(...placed.map((node) => node.position.y));
  return { x: 360 + (placed.length % 3) * 40, y: lowest + 170 };
}

export function addGraphNode(
  category: NodeCategory,
  kind: string,
  position = freePosition(getState().snapshot),
): Id {
  const node = createNode(category, kind, newNodeId(), position);
  dispatch({ type: 'addNode', node });
  select({ kind: 'node', id: node.id });
  return node.id;
}

/**
 * A variable scoped to the whole app rather than one screen.
 *
 * It is the same node as the screen variable — one kind, one set of rules — configured wider, so
 * the value survives navigation and any screen naming it reads the same value
 * (`packages/compiler/src/emit/state.ts`).
 */
export function addGlobalNode(): Id {
  const id = addGraphNode('state', 'write');
  setNodeConfig(id, { scope: 'global' });
  return id;
}

/**
 * Add a function node into an API route's body. The body is what runs on the server — the
 * container boundary is the network boundary (`docs/specs/binding-trigger-runtime.md`).
 */
export function addBodyStep(apiNodeId: Id, kind: string): Id | undefined {
  const snapshot = getState().snapshot;
  const api = snapshot.nodes[apiNodeId];
  if (!api || api.category !== 'api') return undefined;

  const existing = ((api.config ?? {}) as { body?: Id[] }).body ?? [];
  const step = createNode('fn', kind, newNodeId(), {
    x: api.position.x,
    y: api.position.y + 160 + existing.length * 40,
  });
  dispatch({ type: 'addNode', node: step });

  dispatch({
    type: 'setNodeConfig',
    nodeId: apiNodeId,
    config: { ...((api.config ?? {}) as object), body: [...existing, step.id] },
  });
  select({ kind: 'node', id: step.id });
  return step.id;
}

export function setNodeConfig(nodeId: Id, patch: Record<string, unknown>): void {
  const snapshot = getState().snapshot;
  const node = snapshot.nodes[nodeId];
  if (!node) return;

  const config = { ...((node.config ?? {}) as Record<string, unknown>), ...patch };
  const def = defForNode(node);
  // Config drives port types, so retyped ports travel with the config change.
  const ports = def ? def.ports(config) : undefined;
  dispatch({ type: 'setNodeConfig', nodeId, config, ports });
}

export function moveNode(nodeId: Id, position: { x: number; y: number }): void {
  dispatch({ type: 'setNodePosition', nodeId, position });
}

export function removeNode(nodeId: Id): void {
  const snapshot = getState().snapshot;
  // A trigger handler pointing into this node would dangle; drop it with the node.
  for (const component of Object.values(snapshot.components)) {
    for (const [key, value] of Object.entries(component.props)) {
      if (value.kind === 'event') {
        // Only the steps that fired this node; the rest of the sequence is untouched.
        dropActions(
          component.id,
          (action) => action.kind === 'trigger' && action.target.nodeId === nodeId,
        );
      }
      if (value.kind === 'bound' && value.source.nodeId === nodeId) {
        dispatch({ type: 'removeProp', componentId: component.id, key });
      }
    }

    // Conditions point at nodes too, and a condition reading a node that is gone can never hold —
    // the component would silently never appear again. Same rule as a binding: the editor does not
    // leave the document referencing something it just deleted.
    if (component.visibleWhen?.source.nodeId === nodeId) {
      dispatch({ type: 'setVisibleWhen', componentId: component.id, condition: undefined });
    }
    const conditionals = component.conditionalStyles ?? [];
    if (conditionals.some((entry) => entry.when.source.nodeId === nodeId)) {
      dispatch({
        type: 'setConditionalStyles',
        componentId: component.id,
        styles: conditionals.filter((entry) => entry.when.source.nodeId !== nodeId),
      });
    }
  }
  dispatch({ type: 'removeNode', nodeId });
  const selection = getState().selection;
  if (selection?.kind === 'node' && selection.id === nodeId) select(undefined);
}

export function removeWire(wireId: Id): void {
  const snapshot = getState().snapshot;
  const wire = snapshot.wires[wireId];
  // Unwiring a trigger removes that *step* — one gesture, one meaning. The rest of the sequence
  // is a separate set of decisions and survives.
  if (wire && wire.to.portId === 'pt_run') {
    const source = snapshot.nodes[wire.from.nodeId];
    if (source?.mirrorOf) {
      dropActions(
        source.mirrorOf,
        (action) => action.kind === 'trigger' && action.target.nodeId === wire.to.nodeId,
      );
    }
  }
  dispatch({ type: 'removeWire', wireId });
}

/** Drop every step matching `doomed`, leaving the rest of the sequence in order. */
export function dropActions(componentId: Id, doomed: (action: Action) => boolean): void {
  const snapshot = getState().snapshot;
  const existing = actionsFor(snapshot, componentId);
  const kept = existing.filter((action) => !doomed(action));
  if (kept.length === existing.length) return;

  if (kept.length === 0) {
    dispatch({ type: 'removeProp', componentId, key: 'onClick' });
    return;
  }
  dispatch({
    type: 'setProp',
    componentId,
    key: 'onClick',
    value: { kind: 'event', handler: { kind: 'actions', actions: kept } },
  });
}

export interface ConnectResult {
  ok: boolean;
  reason?: string;
}

/** Wire two ports, refusing anything the type system rejects. */
export function connect(from: PortRef, to: PortRef): ConnectResult {
  const snapshot = getState().snapshot;
  const fromNode = snapshot.nodes[from.nodeId];
  const toNode = snapshot.nodes[to.nodeId];
  if (!fromNode || !toNode) return { ok: false, reason: 'Unknown node.' };

  const fromPort = fromNode.ports.find((port) => port.id === from.portId);
  const toPort = toNode.ports.find((port) => port.id === to.portId);
  if (!fromPort || !toPort) return { ok: false, reason: 'Unknown port.' };

  const check = canConnect(fromPort, toPort);
  if (!check.ok) return check;

  const duplicate = Object.values(snapshot.wires).some(
    (wire) =>
      wire.from.nodeId === from.nodeId &&
      wire.from.portId === from.portId &&
      wire.to.nodeId === to.nodeId &&
      wire.to.portId === to.portId,
  );
  if (duplicate) return { ok: false, reason: 'These ports are already wired.' };

  // One gesture, one undo. Drawing a wire can also replace an old one and set a property on the
  // mirrored component; those are the same act, and stepping back through them one dispatch at a
  // time would leave the document in states the designer never drew.
  const ops: Op[] = [];

  // An input port takes one value; rewiring replaces rather than stacks. A screen bucket's `set`
  // port is the one exception — it exists precisely so several results can answer into one place,
  // and replacing on each wire would silently unwire the operation drawn before this one.
  if (!acceptsManyWires(toNode, to.portId)) {
    for (const wire of Object.values(snapshot.wires)) {
      if (wire.to.nodeId === to.nodeId && wire.to.portId === to.portId) {
        ops.push({ type: 'removeWire', wireId: wire.id });
      }
    }
  }

  ops.push({ type: 'addWire', wire: { id: newWireId(), from, to } });

  // A trigger wire and its `trigger` action are one fact in two views (spec 7), so drawing the
  // wire *appends* a step rather than replacing whatever sequence is already there.
  if (toPort.portKind === 'trigger' && fromNode.mirrorOf) {
    const existing = actionsFor(snapshot, fromNode.mirrorOf);
    const already = existing.some(
      (action) => action.kind === 'trigger' && action.target.nodeId === to.nodeId,
    );
    if (!already) {
      ops.push({
        type: 'setProp',
        componentId: fromNode.mirrorOf,
        key: 'onClick',
        value: {
          kind: 'event',
          handler: { kind: 'actions', actions: [...existing, { kind: 'trigger', target: to }] },
        },
      });
    }
  }

  // A data wire into a Text mirror is a binding on the real component.
  if (toNode.mirrorOf && toPort.portKind === 'data' && toPort.direction === 'in') {
    ops.push({
      type: 'setProp',
      componentId: toNode.mirrorOf,
      key: toPort.name === 'content' ? 'content' : toPort.name,
      value: { kind: 'bound', source: from },
    });
  }

  dispatchAll(ops);
  return { ok: true };
}

/** Components on the active artboard that can appear in Nodes mode. */
export function mirrorableComponents(snapshot: Snapshot, artboardId: Id): Id[] {
  const root = snapshot.artboards[artboardId]?.root;
  if (!root) return [];

  const out: Id[] = [];
  const walk = (id: Id): void => {
    const component = snapshot.components[id];
    if (!component) return;
    if (mirrorPortsFor(component.type).length > 0) out.push(id);
    for (const child of component.children ?? []) walk(child);
  };
  walk(root);
  return out;
}

/** Nodes belonging to the active artboard's graph (mirrors of its components, plus the rest). */
export function graphNodesFor(snapshot: Snapshot, artboardId: Id): Node[] {
  return Object.values(snapshot.nodes).filter((node) => {
    if (node.category !== 'ui' || !node.mirrorOf) return true;
    return artboardOf(snapshot, node.mirrorOf) === artboardId;
  });
}

/** A fresh port id, for definitions that need one at runtime. */
export const freshPortId = (): string => newPortId();

/**
 * Draw a box around some nodes (G2, `docs/16-grouping.md`).
 *
 * Editor metadata, kept in the document because it is a fact about the project a colleague should
 * see when they open it — not a preference like which panels are collapsed. Nothing about it
 * reaches the emitted app.
 */
export function groupNodes(nodeIds: readonly Id[], title = 'Group'): Id | undefined {
  const snapshot = getState().snapshot;
  const members = nodeIds.filter((id) => snapshot.nodes[id]);
  if (members.length < 2) return undefined;

  const id = newId('ng');
  dispatch({ type: 'addNodeGroup', group: { id, title, nodeIds: [...members] } });
  return id;
}

export function renameNodeGroup(groupId: Id, title: string): void {
  dispatch({ type: 'setNodeGroup', groupId, title });
}

/** Take the box away and leave the nodes exactly where they are. */
export function removeNodeGroup(groupId: Id): void {
  dispatch({ type: 'removeNodeGroup', groupId });
}
