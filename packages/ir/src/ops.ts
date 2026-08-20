import type {
  Artboard,
  Component,
  Flow,
  FlowPayload,
  Layout,
  Param,
  Node,
  PropertyValue,
  Snapshot,
  Wire,
} from './schema';

/**
 * Atomic operations. Live editing applies clean atoms in memory (undo/redo,
 * responsiveness); a save produces a new snapshot. Ops must stay fine-grained
 * ("added node X", "wired A->B", "set prop P") — coarse "replaced whole graph"
 * ops would make a future semantic merge impossible (docs/02-system-architecture.md).
 *
 * `applyOp` is pure: it returns a new snapshot and never mutates its input.
 */

export type Op =
  | { type: 'addArtboard'; artboard: Artboard; root: Component }
  | { type: 'addComponent'; component: Component; parentId: string; index?: number }
  | { type: 'setProp'; componentId: string; key: string; value: PropertyValue }
  | { type: 'removeProp'; componentId: string; key: string }
  | { type: 'setLayout'; componentId: string; layout: Partial<Layout> }
  | { type: 'setName'; componentId: string; name: string }
  | { type: 'moveComponent'; componentId: string; parentId: string; index?: number }
  | { type: 'removeComponent'; componentId: string }
  | { type: 'addNode'; node: Node }
  | { type: 'setNodeConfig'; nodeId: string; config: unknown; ports?: Node['ports'] }
  | { type: 'setNodePosition'; nodeId: string; position: { x: number; y: number } }
  | { type: 'removeNode'; nodeId: string }
  | { type: 'removeWire'; wireId: string }
  | { type: 'addWire'; wire: Wire }
  | { type: 'addFlow'; flow: Flow }
  | { type: 'setFlowPayload'; flowId: string; payload: FlowPayload[] }
  | { type: 'removeFlow'; flowId: string }
  | { type: 'renameArtboard'; artboardId: string; name: string }
  | { type: 'setArtboardParams'; artboardId: string; params: Param[] }
  | { type: 'setEntryArtboard'; artboardId: string }
  | { type: 'removeArtboard'; artboardId: string };

export function applyOp(snapshot: Snapshot, op: Op): Snapshot {
  const next = structuredClone(snapshot);

  switch (op.type) {
    case 'addArtboard': {
      next.components[op.root.id] = op.root;
      next.artboards[op.artboard.id] = { ...op.artboard, root: op.root.id };
      if (!next.entryArtboard) next.entryArtboard = op.artboard.id;
      return next;
    }

    case 'addComponent': {
      const parent = next.components[op.parentId];
      if (!parent) throw new Error(`addComponent: unknown parent ${op.parentId}`);
      next.components[op.component.id] = op.component;
      const children = parent.children ?? (parent.children = []);
      const at = op.index ?? children.length;
      children.splice(at, 0, op.component.id);
      return next;
    }

    case 'setProp': {
      const component = next.components[op.componentId];
      if (!component) throw new Error(`setProp: unknown component ${op.componentId}`);
      component.props[op.key] = op.value;
      return next;
    }

    case 'removeProp': {
      const component = next.components[op.componentId];
      if (!component) throw new Error(`removeProp: unknown component ${op.componentId}`);
      delete component.props[op.key];
      return next;
    }

    case 'setLayout': {
      const component = next.components[op.componentId];
      if (!component) throw new Error(`setLayout: unknown component ${op.componentId}`);
      if (!component.layout) {
        throw new Error(`setLayout: component ${op.componentId} is not a container`);
      }
      component.layout = { ...component.layout, ...op.layout };
      return next;
    }

    case 'setName': {
      const component = next.components[op.componentId];
      if (!component) throw new Error(`setName: unknown component ${op.componentId}`);
      component.name = op.name;
      return next;
    }

    case 'moveComponent': {
      const moved = next.components[op.componentId];
      if (!moved) throw new Error(`moveComponent: unknown component ${op.componentId}`);
      const parent = next.components[op.parentId];
      if (!parent) throw new Error(`moveComponent: unknown parent ${op.parentId}`);
      if (isAncestor(next, op.componentId, op.parentId)) {
        throw new Error(`moveComponent: ${op.parentId} is inside ${op.componentId}`);
      }
      for (const candidate of Object.values(next.components)) {
        if (candidate.children) {
          candidate.children = candidate.children.filter((id) => id !== op.componentId);
        }
      }
      const children = parent.children ?? (parent.children = []);
      const at = op.index ?? children.length;
      children.splice(Math.min(at, children.length), 0, op.componentId);
      return next;
    }

    case 'removeComponent': {
      if (!next.components[op.componentId]) return next;
      // A removed container takes its subtree with it (ids are never reused).
      for (const id of descendants(next, op.componentId)) {
        delete next.components[id];
        for (const [nodeId, node] of Object.entries(next.nodes)) {
          if (node.mirrorOf === id) delete next.nodes[nodeId];
        }
      }
      delete next.components[op.componentId];
      // Detach from any parent's children list.
      for (const parent of Object.values(next.components)) {
        if (parent.children) {
          parent.children = parent.children.filter((id) => id !== op.componentId);
        }
      }
      // Deleting a component deletes its mirror node(s) (ownership discipline, docs/02).
      for (const [nodeId, node] of Object.entries(next.nodes)) {
        if (node.mirrorOf === op.componentId) delete next.nodes[nodeId];
      }
      return next;
    }

    case 'addNode': {
      next.nodes[op.node.id] = op.node;
      return next;
    }

    case 'setNodeConfig': {
      const node = next.nodes[op.nodeId];
      if (!node) throw new Error(`setNodeConfig: unknown node ${op.nodeId}`);
      node.config = op.config;
      // Config drives port types (inference over annotation), so retyped ports come with it.
      if (op.ports) {
        node.ports = op.ports;
        const valid = new Set(op.ports.map((port) => port.id));
        for (const [wireId, wire] of Object.entries(next.wires)) {
          const touches =
            (wire.from.nodeId === op.nodeId && !valid.has(wire.from.portId)) ||
            (wire.to.nodeId === op.nodeId && !valid.has(wire.to.portId));
          if (touches) delete next.wires[wireId];
        }
      }
      return next;
    }

    case 'setNodePosition': {
      const node = next.nodes[op.nodeId];
      if (!node) throw new Error(`setNodePosition: unknown node ${op.nodeId}`);
      node.position = op.position;
      return next;
    }

    case 'removeNode': {
      delete next.nodes[op.nodeId];
      // A node's wires cannot outlive it, and neither can its slot in a container's body.
      for (const [wireId, wire] of Object.entries(next.wires)) {
        if (wire.from.nodeId === op.nodeId || wire.to.nodeId === op.nodeId) delete next.wires[wireId];
      }
      for (const node of Object.values(next.nodes)) {
        const config = node.config as { body?: string[] } | undefined;
        if (Array.isArray(config?.body)) {
          config.body = config.body.filter((id) => id !== op.nodeId);
        }
      }
      return next;
    }

    case 'removeWire': {
      delete next.wires[op.wireId];
      return next;
    }

    case 'addWire': {
      next.wires[op.wire.id] = op.wire;
      return next;
    }

    case 'addFlow': {
      if (!next.artboards[op.flow.from] || !next.artboards[op.flow.to]) {
        throw new Error(`addFlow: flow ${op.flow.id} references an unknown artboard`);
      }
      next.flows[op.flow.id] = op.flow;
      return next;
    }

    case 'setFlowPayload': {
      const flow = next.flows[op.flowId];
      if (!flow) throw new Error(`setFlowPayload: unknown flow ${op.flowId}`);
      flow.payload = op.payload;
      return next;
    }

    case 'removeFlow': {
      delete next.flows[op.flowId];
      return next;
    }

    case 'renameArtboard': {
      const artboard = next.artboards[op.artboardId];
      if (!artboard) throw new Error(`renameArtboard: unknown artboard ${op.artboardId}`);
      artboard.name = op.name;
      return next;
    }

    case 'setArtboardParams': {
      const artboard = next.artboards[op.artboardId];
      if (!artboard) throw new Error(`setArtboardParams: unknown artboard ${op.artboardId}`);
      artboard.params = op.params;
      return next;
    }

    case 'setEntryArtboard': {
      if (!next.artboards[op.artboardId]) {
        throw new Error(`setEntryArtboard: unknown artboard ${op.artboardId}`);
      }
      next.entryArtboard = op.artboardId;
      return next;
    }

    case 'removeArtboard': {
      const artboard = next.artboards[op.artboardId];
      if (!artboard) return next;
      // The artboard's whole component tree and every flow touching it go with it.
      for (const id of [artboard.root, ...descendants(next, artboard.root)]) {
        delete next.components[id];
        for (const [nodeId, node] of Object.entries(next.nodes)) {
          if (node.mirrorOf === id) delete next.nodes[nodeId];
        }
      }
      for (const [flowId, flow] of Object.entries(next.flows)) {
        if (flow.from === op.artboardId || flow.to === op.artboardId) delete next.flows[flowId];
      }
      delete next.artboards[op.artboardId];
      if (next.entryArtboard === op.artboardId) {
        next.entryArtboard = Object.keys(next.artboards)[0];
      }
      return next;
    }
  }
}

export function applyOps(snapshot: Snapshot, ops: Op[]): Snapshot {
  return ops.reduce(applyOp, snapshot);
}

/** Every component id below `rootId`, excluding the root itself. */
export function descendants(snapshot: Snapshot, rootId: string): string[] {
  const out: string[] = [];
  const walk = (id: string): void => {
    for (const childId of snapshot.components[id]?.children ?? []) {
      out.push(childId);
      walk(childId);
    }
  };
  walk(rootId);
  return out;
}

/** True when `ancestorId` is at or above `id` in the tree (guards reparent cycles). */
export function isAncestor(snapshot: Snapshot, ancestorId: string, id: string): boolean {
  return ancestorId === id || descendants(snapshot, ancestorId).includes(id);
}
