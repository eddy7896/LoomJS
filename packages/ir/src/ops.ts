import { DEFAULT_LAYOUT } from './schema';
import type {
  Artboard,
  ArtboardKind,
  Component,
  ComponentDefinition,
  ConnectorInstance,
  Flow,
  FlowPayload,
  Guard,
  Guides,
  Condition,
  ConditionalStyle,
  Layout,
  Migration,
  Meta,
  NodeGroup,
  Page,
  Param,
  ScreenSize,
  Style,
  Tenancy,
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
  | { type: 'setPosition'; componentId: string; position: { x: number; y: number } | undefined }
  | { type: 'setStyle'; componentId: string; style: Partial<Style> }
  | { type: 'setVisibleWhen'; componentId: string; condition: Condition | undefined }
  | { type: 'setConditionalStyles'; componentId: string; styles: ConditionalStyle[] }
  | { type: 'setThemeToken'; token: string; value: string | undefined }
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
  | { type: 'setArtboardSize'; artboardId: string; size: ScreenSize }
  | { type: 'setArtboardGuard'; artboardId: string; guard: Guard | undefined }
  /**
   * Screen or document, and the paper if it is one (L2). They travel together because they are one
   * decision: a document without a page has no size, and a page on a screen means nothing.
   */
  | { type: 'setArtboardKind'; artboardId: string; kind: ArtboardKind; page?: Page }
  /** Crawlable without a session, and what a crawler is told about it (L4). */
  | { type: 'setArtboardMeta'; artboardId: string; isPublic: boolean; meta?: Meta }
  /**
   * Promote a frame to a reusable component (R1).
   *
   * The frame **stops being on the artboard** and becomes the definition's root; an instance takes
   * its place. Copying it would leave two trees that look alike until somebody edits one, which is
   * the thing this feature exists to prevent.
   */
  | {
      type: 'promoteToDefinition';
      definition: ComponentDefinition;
      /** The instance that replaces the promoted frame where it stood. */
      instance: Component;
    }
  | { type: 'addInstance'; parentId: string; instance: Component }
  | { type: 'renameDefinition'; definitionId: string; name: string }
  /**
   * Create a component from scratch, tree and all — which is how a shell is made (R1, R2).
   *
   * The whole subtree arrives in **one op**, because a shell is not usable until it has a screen
   * slot: an intermediate state with a root and no `Outlet` is one the compiler refuses, and undo
   * should not be able to stop there.
   */
  | { type: 'addDefinition'; definition: ComponentDefinition; components: Component[] }
  | { type: 'removeDefinition'; definitionId: string }
  /** Put a screen inside a shell, or take it back out. */
  | { type: 'setArtboardShell'; artboardId: string; shellId: string | undefined }
  /** Which tables hold the organisations, and whose rows belong to one (O1). */
  | { type: 'setTenancy'; tenancy: Tenancy | undefined }
  /**
   * The role names this project knows (O2).
   *
   * Retypes the `role` port of every `Current org` node in the same op: the port's type *is* the
   * set of roles, so leaving them behind would mean a graph where a comparison type-checks against
   * a role that no longer exists.
   */
  | { type: 'setRoles'; roles: string[] }
  /**
   * What a node calls itself (N1).
   *
   * A node's name belongs to the person: four Math nodes all reading "Math" is a graph that says
   * nothing about which button does what. Empty puts it back to the default label, which is not
   * the same as a node called "".
   */
  | { type: 'setNodeName'; nodeId: string; name: string }
  | { type: 'setDefinitionParams'; definitionId: string; params: Param[] }
  | { type: 'setArtboardGuides'; artboardId: string; guides: Guides }
  | { type: 'setEntryArtboard'; artboardId: string }
  | { type: 'removeArtboard'; artboardId: string }
  | { type: 'addConnector'; connector: ConnectorInstance }
  | { type: 'setConnectorConfig'; connectorId: string; config: unknown }
  | { type: 'recordMigration'; migration: Migration }
  | { type: 'addNodeGroup'; group: NodeGroup }
  | { type: 'setNodeGroup'; groupId: string; title?: string; nodeIds?: string[] }
  | { type: 'removeNodeGroup'; groupId: string }
  | { type: 'removeConnector'; connectorId: string }
  | { type: 'acceptAuto'; group: string }
  | { type: 'detachAuto'; group: string }
  | { type: 'removeAuto'; group: string };

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

    case 'setPosition': {
      const component = next.components[op.componentId];
      if (!component) throw new Error(`setPosition: unknown component ${op.componentId}`);
      // Undefined is "wherever the layout puts it", which is the absence of the key rather than
      // a position of zero.
      if (op.position) component.position = op.position;
      else delete component.position;
      return next;
    }

    case 'setLayout': {
      const component = next.components[op.componentId];
      if (!component) throw new Error(`setLayout: unknown component ${op.componentId}`);
      /**
       * A component with no layout gets the default one first.
       *
       * This used to refuse, on the grounds that layout belongs to containers — but that stopped
       * being true when elements gained sizes: a Shape or a Table is not a container and carries
       * a layout to hold its size. The refusal was reachable from the canvas, where dragging the
       * resize handle of a Text threw rather than resizing it.
       */
      component.layout = { ...(component.layout ?? DEFAULT_LAYOUT), ...op.layout };
      return next;
    }

    /** Style is merged, and an explicitly cleared property is removed rather than left empty. */
    case 'setStyle': {
      const component = next.components[op.componentId];
      if (!component) throw new Error(`setStyle: unknown component ${op.componentId}`);
      const style = { ...(component.style ?? {}), ...op.style } as Record<string, unknown>;
      for (const [key, value] of Object.entries(op.style)) {
        if (value === undefined) delete style[key];
      }
      component.style = style as Style;
      return next;
    }

    /** Clearing the condition makes the component unconditional again, not permanently hidden. */
    case 'setVisibleWhen': {
      const component = next.components[op.componentId];
      if (!component) throw new Error(`setVisibleWhen: unknown component ${op.componentId}`);
      if (op.condition) component.visibleWhen = op.condition;
      else delete component.visibleWhen;
      return next;
    }

    case 'setConditionalStyles': {
      const component = next.components[op.componentId];
      if (!component) throw new Error(`setConditionalStyles: unknown component ${op.componentId}`);
      if (op.styles.length > 0) component.conditionalStyles = op.styles;
      else delete component.conditionalStyles;
      return next;
    }

    /** One token override. Clearing it returns that token to loom's default. */
    case 'setThemeToken': {
      const theme = { ...(next.theme ?? {}) };
      if (op.value === undefined || op.value.trim() === '') delete theme[op.token];
      else theme[op.token] = op.value.trim();
      next.theme = Object.keys(theme).length > 0 ? theme : undefined;
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
        if (wire.from.nodeId === op.nodeId || wire.to.nodeId === op.nodeId)
          delete next.wires[wireId];
      }
      for (const node of Object.values(next.nodes)) {
        const config = node.config as { body?: string[] } | undefined;
        if (Array.isArray(config?.body)) {
          config.body = config.body.filter((id) => id !== op.nodeId);
        }
      }
      // A group is a box around nodes; one whose last node is gone is a box around nothing.
      if (next.nodeGroups) {
        const groups: typeof next.nodeGroups = {};
        for (const [groupId, group] of Object.entries(next.nodeGroups)) {
          const nodeIds = group.nodeIds.filter((id) => id !== op.nodeId);
          if (nodeIds.length > 0) groups[groupId] = { ...group, nodeIds };
        }
        next.nodeGroups = groups;
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
        throw new Error(`addFlow: flow ${op.flow.id} references an unknown screen`);
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
      if (!artboard) throw new Error(`renameArtboard: unknown screen ${op.artboardId}`);
      artboard.name = op.name;
      return next;
    }

    case 'setArtboardParams': {
      const artboard = next.artboards[op.artboardId];
      if (!artboard) throw new Error(`setArtboardParams: unknown screen ${op.artboardId}`);
      artboard.params = op.params;
      return next;
    }

    case 'setArtboardGuides': {
      const artboard = next.artboards[op.artboardId];
      if (!artboard) throw new Error(`setArtboardGuides: unknown screen ${op.artboardId}`);
      const empty = op.guides.x.length === 0 && op.guides.y.length === 0;
      if (empty) delete artboard.guides;
      else artboard.guides = op.guides;
      return next;
    }

    case 'setArtboardGuard': {
      const artboard = next.artboards[op.artboardId];
      if (!artboard) throw new Error(`setArtboardGuard: unknown screen ${op.artboardId}`);
      // Undefined is "anyone may open it", which is the absence of the key rather than an empty
      // object — a guard nobody can satisfy is not the same fact as no guard.
      if (op.guard) artboard.guard = op.guard;
      else delete artboard.guard;
      return next;
    }

    case 'setArtboardKind': {
      const artboard = next.artboards[op.artboardId];
      if (!artboard) throw new Error(`setArtboardKind: unknown screen ${op.artboardId}`);

      // Absent means `screen`, so turning one back drops the key rather than writing the default
      // into every document that was never a document.
      if (op.kind === 'screen') {
        delete artboard.kind;
        delete artboard.page;
      } else {
        artboard.kind = op.kind;
        if (op.page) artboard.page = op.page;
      }
      return next;
    }

    case 'promoteToDefinition': {
      const { definition, instance } = op;
      const root = next.components[definition.root];
      if (!root) throw new Error(`promoteToDefinition: unknown component ${definition.root}`);

      // Whoever held the frame now holds the instance, in the same slot — promoting something
      // should not move it.
      for (const candidate of Object.values(next.components)) {
        const children = candidate.children;
        if (!children) continue;
        const at = children.indexOf(definition.root);
        if (at !== -1) children[at] = instance.id;
      }

      next.definitions = { ...(next.definitions ?? {}), [definition.id]: definition };
      next.components[instance.id] = instance;
      return next;
    }

    case 'addInstance': {
      const parent = next.components[op.parentId];
      if (!parent) throw new Error(`addInstance: unknown parent ${op.parentId}`);
      next.components[op.instance.id] = op.instance;
      parent.children = [...(parent.children ?? []), op.instance.id];
      return next;
    }

    case 'addDefinition': {
      for (const component of op.components) next.components[component.id] = component;
      next.definitions = { ...(next.definitions ?? {}), [op.definition.id]: op.definition };
      return next;
    }

    case 'removeDefinition': {
      if (!next.definitions?.[op.definitionId]) return next;

      // Every screen wearing it goes back to being a whole page. A dangling `shellId` would be a
      // screen that renders into a shell nobody can find.
      for (const artboard of Object.values(next.artboards)) {
        if (artboard.shellId === op.definitionId) delete artboard.shellId;
      }
      delete next.definitions[op.definitionId];
      return next;
    }

    case 'setNodeName': {
      const node = next.nodes[op.nodeId];
      if (!node) throw new Error(`setNodeName: unknown node ${op.nodeId}`);
      const name = op.name.trim();
      if (name) node.name = name;
      else delete node.name;
      return next;
    }

    case 'setRoles': {
      const roles = op.roles.map((role) => role.trim()).filter(Boolean);
      if (roles.length > 0) next.roles = roles;
      else delete next.roles;

      const type =
        roles.length > 0 ? ({ kind: 'enum', values: roles } as const) : ({ kind: 'text' } as const);

      for (const node of Object.values(next.nodes)) {
        if (node.category !== 'state' || node.kind !== 'currentOrg') continue;
        node.ports = node.ports.map((port) => (port.id === 'pt_role' ? { ...port, type } : port));
      }
      return next;
    }

    case 'setTenancy': {
      if (op.tenancy) next.tenancy = op.tenancy;
      else delete next.tenancy;
      return next;
    }

    case 'setArtboardShell': {
      const artboard = next.artboards[op.artboardId];
      if (!artboard) throw new Error(`setArtboardShell: unknown screen ${op.artboardId}`);
      if (op.shellId) artboard.shellId = op.shellId;
      else delete artboard.shellId;
      return next;
    }

    case 'renameDefinition': {
      const definition = next.definitions?.[op.definitionId];
      if (!definition) throw new Error(`renameDefinition: unknown definition ${op.definitionId}`);
      definition.name = op.name;
      return next;
    }

    case 'setDefinitionParams': {
      const definition = next.definitions?.[op.definitionId];
      if (!definition) {
        throw new Error(`setDefinitionParams: unknown definition ${op.definitionId}`);
      }
      definition.params = op.params;
      return next;
    }

    case 'setArtboardMeta': {
      const artboard = next.artboards[op.artboardId];
      if (!artboard) throw new Error(`setArtboardMeta: unknown screen ${op.artboardId}`);

      // Absent means private, so turning it back off drops the key rather than writing `false`
      // into every screen that was never public.
      if (op.isPublic) artboard.public = true;
      else delete artboard.public;

      if (op.meta && Object.values(op.meta).some(Boolean)) artboard.meta = op.meta;
      else delete artboard.meta;
      return next;
    }

    case 'setArtboardSize': {
      const artboard = next.artboards[op.artboardId];
      if (!artboard) throw new Error(`setArtboardSize: unknown screen ${op.artboardId}`);
      artboard.size = op.size;
      return next;
    }

    case 'setEntryArtboard': {
      if (!next.artboards[op.artboardId]) {
        throw new Error(`setEntryArtboard: unknown screen ${op.artboardId}`);
      }
      next.entryArtboard = op.artboardId;
      return next;
    }

    case 'addNodeGroup': {
      next.nodeGroups = { ...(next.nodeGroups ?? {}), [op.group.id]: op.group };
      return next;
    }

    case 'setNodeGroup': {
      const group = next.nodeGroups?.[op.groupId];
      if (!group) throw new Error(`setNodeGroup: unknown group ${op.groupId}`);
      next.nodeGroups = {
        ...next.nodeGroups,
        [op.groupId]: {
          ...group,
          ...(op.title === undefined ? {} : { title: op.title }),
          ...(op.nodeIds === undefined ? {} : { nodeIds: op.nodeIds }),
        },
      };
      return next;
    }

    case 'removeNodeGroup': {
      if (!next.nodeGroups) return next;
      const rest = { ...next.nodeGroups };
      delete rest[op.groupId];
      next.nodeGroups = rest;
      return next;
    }

    case 'recordMigration': {
      // Appended, never rewritten: a migration is a record of what ran.
      next.migrations = [...(next.migrations ?? []), op.migration];
      return next;
    }

    case 'addConnector': {
      next.connectors[op.connector.id] = op.connector;
      return next;
    }

    case 'setConnectorConfig': {
      const connector = next.connectors[op.connectorId];
      if (!connector) throw new Error(`setConnectorConfig: unknown connector ${op.connectorId}`);
      connector.config = op.config;
      return next;
    }

    case 'removeConnector': {
      delete next.connectors[op.connectorId];
      // Database nodes without a connection cannot compile; drop them with it.
      for (const [nodeId, node] of Object.entries(next.nodes)) {
        const config = (node.config ?? {}) as { connectorId?: string };
        if (node.category === 'db' && config.connectorId === op.connectorId) {
          delete next.nodes[nodeId];
          for (const [wireId, wire] of Object.entries(next.wires)) {
            if (wire.from.nodeId === nodeId || wire.to.nodeId === nodeId) delete next.wires[wireId];
          }
        }
      }
      return next;
    }

    /**
     * Accept: keep the pipeline as loom generated it. It stays AUTO, so it keeps up with the
     * form (`docs/06-glossary.md`) — the badge just stops asking.
     */
    case 'acceptAuto': {
      for (const node of Object.values(next.nodes)) {
        if (node.auto?.group === op.group) node.auto = { ...node.auto, state: 'accepted' };
      }
      for (const wire of Object.values(next.wires)) {
        if (wire.auto?.group === op.group) wire.auto = { ...wire.auto, state: 'accepted' };
      }
      return next;
    }

    /**
     * Detach: the designer takes ownership. Losing the mark is the whole operation — from here
     * the nodes are ordinary nodes and inference will never touch them again. The unit is the
     * group: a pipeline half-owned by loom and half by the designer is unreadable.
     */
    case 'detachAuto': {
      for (const node of Object.values(next.nodes)) {
        if (node.auto?.group === op.group) delete node.auto;
      }
      for (const wire of Object.values(next.wires)) {
        if (wire.auto?.group === op.group) delete wire.auto;
      }
      return next;
    }

    /** Withdraw a generated pipeline — used to reject one, and to clear the old one before a
     * regeneration. Detached members are *not* touched: they are no longer loom's to remove. */
    case 'removeAuto': {
      for (const [nodeId, node] of Object.entries(next.nodes)) {
        if (node.auto?.group !== op.group) continue;
        delete next.nodes[nodeId];
        for (const [wireId, wire] of Object.entries(next.wires)) {
          if (wire.from.nodeId === nodeId || wire.to.nodeId === nodeId) delete next.wires[wireId];
        }
        // A trigger handler pointing into a withdrawn node would dangle.
        for (const component of Object.values(next.components)) {
          for (const [key, value] of Object.entries(component.props)) {
            const dangles =
              (value.kind === 'event' &&
                value.handler.kind === 'trigger' &&
                value.handler.target.nodeId === nodeId) ||
              (value.kind === 'bound' && value.source.nodeId === nodeId);
            if (dangles) delete component.props[key];
          }
        }
      }
      for (const [wireId, wire] of Object.entries(next.wires)) {
        if (wire.auto?.group === op.group) delete next.wires[wireId];
      }
      // The withdrawn nodes may have been inside an API route's body.
      for (const node of Object.values(next.nodes)) {
        const config = node.config as { body?: string[] } | undefined;
        if (Array.isArray(config?.body)) {
          config.body = config.body.filter((id) => Boolean(next.nodes[id]));
        }
      }
      return next;
    }

    case 'removeArtboard': {
      const artboard = next.artboards[op.artboardId];
      if (!artboard) return next;
      // The artboard's whole component tree and every flow touching it go with it.
      // A guard sending people to a screen that no longer exists would bounce them nowhere.
      for (const other of Object.values(next.artboards)) {
        if (other.guard?.redirectTo === op.artboardId) delete other.guard;
      }
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
