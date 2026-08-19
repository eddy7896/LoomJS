import type {
  Artboard,
  Component,
  Flow,
  Layout,
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
  | { type: 'setLayout'; componentId: string; layout: Partial<Layout> }
  | { type: 'setName'; componentId: string; name: string }
  | { type: 'moveComponent'; componentId: string; parentId: string; index?: number }
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
