import type { Artboard, Component, Flow, Node, PropertyValue, Snapshot, Wire } from './schema';

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
  | { type: 'removeComponent'; componentId: string }
  | { type: 'addNode'; node: Node }
  | { type: 'addWire'; wire: Wire }
  | { type: 'addFlow'; flow: Flow };

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

    case 'removeComponent': {
      if (!next.components[op.componentId]) return next;
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

    case 'addWire': {
      next.wires[op.wire.id] = op.wire;
      return next;
    }

    case 'addFlow': {
      next.flows[op.flow.id] = op.flow;
      return next;
    }
  }
}

export function applyOps(snapshot: Snapshot, ops: Op[]): Snapshot {
  return ops.reduce(applyOp, snapshot);
}
