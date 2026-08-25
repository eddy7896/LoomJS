import type { Condition, ConditionalStyle, Id, Node, Snapshot } from '@loom/ir';
import { artboardOf, dispatch, getState, rootComponentId } from './store';
import { addGraphNode, connect, ensureMirror, mirrorNodeFor, setNodeConfig } from './graph';

/**
 * Conditions in the editor (P1, `docs/specs/conditions.md`).
 *
 * A condition is a reference to a boolean somewhere on this screen. The editor's whole job is to
 * offer the *right* set of sources — a picker that lists everything and refuses half of it on
 * compile is worse than one that only ever offers what works.
 */

export interface ConditionSource {
  /** Stable value for a `<select>`: `nodeId:portId`. */
  key: string;
  label: string;
  nodeId: Id;
  portId: Id;
}

/** Ports that read as a condition. `pending` is a boolean; a Compare or Logic result is one too. */
function booleanPortsOf(node: Node): { portId: Id; name: string }[] {
  return node.ports
    .filter((port) => port.direction === 'out' && port.portKind === 'data')
    .filter((port) => port.type.kind === 'boolean' || port.type.kind === 'any')
    .map((port) => ({ portId: port.id, name: port.name }));
}

/**
 * Every boolean this screen can offer a condition.
 *
 * Deliberately excludes nodes inside an API route's body: those run on the server, and their
 * values do not exist in the browser to test against.
 */
export function conditionSources(snapshot: Snapshot, artboardId: Id): ConditionSource[] {
  const insideRoutes = new Set<Id>();
  for (const node of Object.values(snapshot.nodes)) {
    if (node.category !== 'api') continue;
    for (const id of ((node.config ?? {}) as { body?: Id[] }).body ?? []) insideRoutes.add(id);
  }

  const sources: ConditionSource[] = [];

  // Checkboxes on this screen, whether or not they have been wired into anything yet. A designer
  // should not have to visit Nodes mode and wire a box to nothing before they can condition on
  // it — the mirror is materialised when the condition is picked.
  const walk = (id: Id): void => {
    const component = snapshot.components[id];
    if (!component) return;
    if (component.type === 'Checkbox' && !mirrorNodeFor(snapshot, id)) {
      sources.push({
        key: `component:${id}`,
        label: `${component.name ?? 'Checkbox'} is checked`,
        nodeId: '',
        portId: 'pt_value',
      });
    }
    for (const child of component.children ?? []) walk(child);
  };
  walk(rootComponentId(snapshot, artboardId));

  for (const node of Object.values(snapshot.nodes)) {
    if (insideRoutes.has(node.id)) continue;

    // A checkbox's mirror: "show this when the box is ticked".
    if (node.category === 'ui' && node.mirrorOf) {
      const component = snapshot.components[node.mirrorOf];
      if (!component || component.type !== 'Checkbox') continue;
      if (artboardOf(snapshot, node.mirrorOf) !== artboardId) continue;
      sources.push({
        key: `${node.id}:pt_value`,
        label: `${component.name ?? 'Checkbox'} is checked`,
        nodeId: node.id,
        portId: 'pt_value',
      });
      continue;
    }

    // A derivation's result, or a route's pending flag.
    if (node.category !== 'fn' && node.category !== 'api' && node.category !== 'state') continue;
    for (const port of booleanPortsOf(node)) {
      sources.push({
        key: `${node.id}:${port.portId}`,
        label: `${node.name ?? node.kind} — ${port.name}`,
        nodeId: node.id,
        portId: port.portId,
      });
    }
  }

  /**
   * The roles this project knows (O2).
   *
   * Offered as "Role is admin" and **materialised into real nodes** when picked — a `Current org`
   * and a Compare, wired. The alternative was a role check that lived only in the inspector, which
   * is the second way of saying a condition that `docs/10` refuses: a condition reads a boolean,
   * and the thing that makes booleans in loom is a node.
   *
   * Making it two clicks and a trip to Nodes mode would be the same feature nobody uses. This is
   * the pattern the sign-in buttons already follow (`docs/19`).
   */
  for (const role of snapshot.roles ?? []) {
    sources.push({
      key: `role:${role}`,
      label: `Role is ${role}`,
      nodeId: '',
      portId: 'pt_result',
    });
  }

  return sources.sort((a, b) => a.label.localeCompare(b.label));
}

export const conditionKey = (condition: Condition | undefined): string =>
  condition ? `${condition.source.nodeId}:${condition.source.portId}` : '';

/**
 * Turn a picker choice into a condition, **materialising a mirror if that is what was chosen**.
 * Picking "Agree is checked" has to work on the first click; needing a trip to Nodes mode first
 * would be a rule nobody could guess.
 */
export function conditionFromKey(key: string, test: Condition['test']): Condition | undefined {
  if (!key) return undefined;

  if (key.startsWith('component:')) {
    const componentId = key.slice('component:'.length);
    const nodeId = ensureMirror(componentId, { x: 24, y: 24 });
    if (!nodeId) return undefined;
    return { source: { nodeId, portId: 'pt_value' }, ...(test === 'not' ? { test } : {}) };
  }

  if (key.startsWith('role:')) {
    const nodeId = ensureRoleCheck(key.slice('role:'.length));
    if (!nodeId) return undefined;
    return { source: { nodeId, portId: 'pt_result' }, ...(test === 'not' ? { test } : {}) };
  }

  const [nodeId, portId] = key.split(':');
  if (!nodeId || !portId) return undefined;
  return { source: { nodeId, portId }, ...(test === 'not' ? { test } : {}) };
}

/**
 * The nodes behind "Role is admin", made once and reused.
 *
 * Two screens both asking about admins get the same Compare rather than one each: the graph is
 * something a person reads, and four identical nodes saying the same thing is noise they have to
 * see past.
 */
function ensureRoleCheck(role: string): Id | undefined {
  const snapshot = getState().snapshot;

  const existing = Object.values(snapshot.nodes).find(
    (node) =>
      node.category === 'fn' &&
      node.kind === 'compare' &&
      (node.config as { right?: unknown } | undefined)?.right === role,
  );
  if (existing) return existing.id;

  const org =
    Object.values(snapshot.nodes).find(
      (node) => node.category === 'state' && node.kind === 'currentOrg',
    )?.id ?? addGraphNode('state', 'currentOrg', { x: 24, y: 360 });

  const compare = addGraphNode('fn', 'compare', { x: 300, y: 360 });
  setNodeConfig(compare, { operator: 'equals', rightKind: 'value', right: role });

  const wired = connect(
    { nodeId: org, portId: 'pt_role' },
    { nodeId: compare, portId: 'pt_input' },
  );
  if (!wired.ok) return undefined;

  return compare;
}

export function setVisibleWhen(componentId: Id, condition: Condition | undefined): void {
  dispatch({ type: 'setVisibleWhen', componentId, condition });
}

export function setConditionalStyles(componentId: Id, styles: ConditionalStyle[]): void {
  dispatch({ type: 'setConditionalStyles', componentId, styles });
}

/** Add an override with the first source available, so the row appears already meaning something. */
export function addConditionalStyle(componentId: Id): void {
  const state = getState();
  const sources = conditionSources(state.snapshot, state.activeArtboardId);
  const first = sources[0];
  if (!first) return;

  const existing = state.snapshot.components[componentId]?.conditionalStyles ?? [];
  setConditionalStyles(componentId, [
    ...existing,
    { when: { source: { nodeId: first.nodeId, portId: first.portId } }, style: {} },
  ]);
}
