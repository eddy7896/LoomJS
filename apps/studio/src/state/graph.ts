import {
  newNodeId,
  newPortId,
  newWireId,
  type Id,
  type Node,
  type NodeCategory,
  type PortRef,
  type Snapshot,
} from '@loom/ir';
import { createNode, defForNode, mirrorPortsFor } from '@loom/components';
import { canConnect } from '@loom/typesys';
import { artboardOf, dispatch, getState, select } from './store';

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

export function addGraphNode(
  category: NodeCategory,
  kind: string,
  position = { x: 320, y: 80 },
): Id {
  const node = createNode(category, kind, newNodeId(), position);
  dispatch({ type: 'addNode', node });
  select({ kind: 'node', id: node.id });
  return node.id;
}

/**
 * Add a function node into an API route's body. The body is what runs on the server — the
 * container boundary is the network boundary (`docs/specs/binding-trigger-runtime.md`).
 */
export function addBodyStep(apiNodeId: Id, kind: string): Id | undefined {
  const snapshot = getState().snapshot;
  const api = snapshot.nodes[apiNodeId];
  if (!api || api.category !== 'api') return undefined;

  const step = createNode('fn', kind, newNodeId(), { x: api.position.x, y: api.position.y + 160 });
  dispatch({ type: 'addNode', node: step });

  const config = (api.config ?? {}) as { body?: Id[] };
  dispatch({
    type: 'setNodeConfig',
    nodeId: apiNodeId,
    config: { ...config, body: [...(config.body ?? []), step.id] },
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
      if (
        value.kind === 'event' &&
        value.handler.kind === 'trigger' &&
        value.handler.target.nodeId === nodeId
      ) {
        dispatch({ type: 'removeProp', componentId: component.id, key });
      }
      if (value.kind === 'bound' && value.source.nodeId === nodeId) {
        dispatch({ type: 'removeProp', componentId: component.id, key });
      }
    }
  }
  dispatch({ type: 'removeNode', nodeId });
  const selection = getState().selection;
  if (selection?.kind === 'node' && selection.id === nodeId) select(undefined);
}

export function removeWire(wireId: Id): void {
  const snapshot = getState().snapshot;
  const wire = snapshot.wires[wireId];
  // Unwiring a trigger also unwires the component's handler — one gesture, one meaning.
  if (wire && wire.to.portId === 'pt_run') {
    const source = snapshot.nodes[wire.from.nodeId];
    if (source?.mirrorOf) {
      dispatch({ type: 'removeProp', componentId: source.mirrorOf, key: 'onClick' });
    }
  }
  dispatch({ type: 'removeWire', wireId });
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

  // An input port takes one value; rewiring replaces rather than stacks.
  for (const wire of Object.values(snapshot.wires)) {
    if (wire.to.nodeId === to.nodeId && wire.to.portId === to.portId) {
      dispatch({ type: 'removeWire', wireId: wire.id });
    }
  }

  dispatch({ type: 'addWire', wire: { id: newWireId(), from, to } });

  // A trigger wire is the same fact as the component's onClick handler; keep them in step.
  if (toPort.portKind === 'trigger' && fromNode.mirrorOf) {
    dispatch({
      type: 'setProp',
      componentId: fromNode.mirrorOf,
      key: 'onClick',
      value: { kind: 'event', handler: { kind: 'trigger', target: to } },
    });
  }

  // A data wire into a Text mirror is a binding on the real component.
  if (toNode.mirrorOf && toPort.portKind === 'data' && toPort.direction === 'in') {
    dispatch({
      type: 'setProp',
      componentId: toNode.mirrorOf,
      key: toPort.name === 'content' ? 'content' : toPort.name,
      value: { kind: 'bound', source: from },
    });
  }

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
