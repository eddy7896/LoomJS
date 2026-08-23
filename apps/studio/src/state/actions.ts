import {
  actionsOf,
  newFlowId,
  newWireId,
  type Action,
  type ActionKind,
  type Id,
  type Snapshot,
  type ValueSource,
} from '@loom/ir';
import { hasFieldState, isVariable, nodeTitle } from '@loom/components';
import { ensureMirror, mirrorNodeFor } from './graph';
import { artboardOf, dispatch, getState, rootComponentId } from './store';
import { SSO_PROVIDERS } from '@loom/connectors';

/**
 * Action sequences in the editor (P3, `docs/specs/actions.md`).
 *
 * The editor's job is to offer only what works. A picker listing every node in the project and
 * refusing half of them on compile is worse than a short list that always compiles — the same rule
 * the condition picker follows.
 */

export const ACTION_LABELS: Record<ActionKind, string> = {
  trigger: 'Run',
  navigate: 'Go to screen',
  setVariable: 'Set a variable',
  setField: 'Set a field',
  clearField: 'Clear a field',
  message: 'Show a message',
  openUrl: 'Open a link',
  copy: 'Copy to clipboard',
  signIn: 'Sign in',
  signInWith: 'Sign in with…',
  signUp: 'Sign up',
  signOut: 'Sign out',
};

/** The order they appear in the "add" menu: the ones a form needs, first. */
export const ACTION_ORDER: ActionKind[] = [
  'trigger',
  'setVariable',
  'setField',
  'clearField',
  'message',
  'navigate',
  'openUrl',
  'copy',
  'signIn',
  'signInWith',
  'signUp',
  'signOut',
];

export interface Choice {
  value: string;
  label: string;
}

// ---------------------------------------------------------------------------
// Values an action carries: something typed in, or a field on this screen
// ---------------------------------------------------------------------------

const blankValue = (): ValueSource => ({ kind: 'static', value: '' });

/**
 * A field as a value, materialising its mirror if it has none.
 *
 * Picking "the Email field" has to work on the first click. Needing a trip to Nodes mode to wire
 * the field to nothing first would be a rule nobody could guess — the same reason the condition
 * picker materialises a checkbox's mirror.
 */
export function fieldValue(componentId: Id): ValueSource {
  const nodeId = ensureMirror(componentId, { x: 24, y: 24 });
  return nodeId ? { kind: 'bound', source: { nodeId, portId: 'pt_value' } } : blankValue();
}

/** The `<select>` key for a value: the component behind it, or `static` for something typed. */
export function valueKey(snapshot: Snapshot, value: ValueSource): string {
  if (value.kind !== 'bound') return 'static';
  const node = snapshot.nodes[value.source.nodeId];
  return node?.mirrorOf ?? 'static';
}

export function valueFromKey(key: string): ValueSource {
  return key === 'static' ? blankValue() : fieldValue(key);
}

/** True when the field this value reads has been removed under it. */
export function valueIsDangling(snapshot: Snapshot, value: ValueSource): boolean {
  if (value.kind !== 'bound') return false;
  const node = snapshot.nodes[value.source.nodeId];
  return !node || !node.mirrorOf || !snapshot.components[node.mirrorOf];
}

/** Kept for the mirror lookup the value pickers need. */
export const mirrorFor = mirrorNodeFor;

export function actionsFor(snapshot: Snapshot, componentId: Id): Action[] {
  const prop = snapshot.components[componentId]?.props.onClick;
  return prop?.kind === 'event' ? actionsOf(prop.handler) : [];
}

/** Write a whole sequence back. An empty one removes the property rather than leaving `[]`. */
export function setActions(componentId: Id, actions: Action[]): void {
  if (actions.length === 0) {
    dispatch({ type: 'removeProp', componentId, key: 'onClick' });
    return;
  }
  dispatch({
    type: 'setProp',
    componentId,
    key: 'onClick',
    value: { kind: 'event', handler: { kind: 'actions', actions } },
  });
}

export function updateAction(componentId: Id, index: number, next: Action): void {
  setActions(
    componentId,
    actionsFor(getState().snapshot, componentId).map((action, i) => (i === index ? next : action)),
  );
}

export function removeAction(componentId: Id, index: number): void {
  const actions = actionsFor(getState().snapshot, componentId);
  const removed = actions[index];
  setActions(
    componentId,
    actions.filter((_, i) => i !== index),
  );
  // The wire and the action are one fact in two views (spec 7): deleting the step deletes the wire.
  if (removed?.kind === 'trigger') removeTriggerWire(componentId, removed.target.nodeId);
}

/** Order is the meaning of a sequence, so moving a step is a first-class edit, not a drag hint. */
export function moveAction(componentId: Id, index: number, delta: number): void {
  const actions = [...actionsFor(getState().snapshot, componentId)];
  const target = index + delta;
  if (target < 0 || target >= actions.length) return;
  const [moved] = actions.splice(index, 1);
  if (!moved) return;
  actions.splice(target, 0, moved);
  setActions(componentId, actions);
}

// ---------------------------------------------------------------------------
// What each action can point at, on this screen
// ---------------------------------------------------------------------------

/** Nodes a `trigger` can fire: a pipeline, or a derivation something already fires. */
export function triggerChoices(snapshot: Snapshot): Choice[] {
  const insideRoutes = new Set<Id>();
  for (const node of Object.values(snapshot.nodes)) {
    if (node.category !== 'api') continue;
    for (const id of ((node.config ?? {}) as { body?: Id[] }).body ?? []) insideRoutes.add(id);
  }

  return Object.values(snapshot.nodes)
    .filter((node) => !insideRoutes.has(node.id))
    .filter((node) => node.ports.some((port) => port.id === 'pt_run'))
    .map((node) => ({ value: node.id, label: nodeTitle(node) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function variableChoices(snapshot: Snapshot): Choice[] {
  return Object.values(snapshot.nodes)
    // The current user is app state too, and it is nobody's to set: signing in is what writes it.
    .filter(isVariable)
    .map((node) => ({ value: node.id, label: nodeTitle(node) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Inputs on the same screen. A field on another screen has no state here to set. */
export function fieldChoices(snapshot: Snapshot, componentId: Id): Choice[] {
  const artboardId = artboardOf(snapshot, componentId);
  if (!artboardId) return [];

  const found: Choice[] = [];
  const walk = (id: Id): void => {
    const component = snapshot.components[id];
    if (!component) return;
    if (hasFieldState(component.type)) {
      found.push({ value: id, label: component.name ?? component.type });
    }
    for (const child of component.children ?? []) walk(child);
  };
  walk(rootComponentId(snapshot, artboardId));
  return found;
}

export function screenChoices(snapshot: Snapshot, componentId: Id): Choice[] {
  const own = artboardOf(snapshot, componentId);
  return Object.values(snapshot.artboards)
    .filter((artboard) => artboard.id !== own)
    .map((artboard) => ({ value: artboard.id, label: artboard.name }));
}

/** Whether an action kind has anything to point at yet; the menu hides the ones that do not. */
export function canAdd(snapshot: Snapshot, componentId: Id, kind: ActionKind): boolean {
  switch (kind) {
    case 'trigger':
      return triggerChoices(snapshot).length > 0;
    case 'setVariable':
      return variableChoices(snapshot).length > 0;
    case 'setField':
    case 'clearField':
      return fieldChoices(snapshot, componentId).length > 0;
    case 'navigate':
      return screenChoices(snapshot, componentId).length > 0;
    default:
      return true;
  }
}

/**
 * Append an action already pointing at something real, so the new row means something the moment
 * it appears. A row that says "choose a thing" is a row that compiles to an error.
 */
export function addAction(componentId: Id, kind: ActionKind): void {
  const snapshot = getState().snapshot;
  const existing = actionsFor(snapshot, componentId);

  const action = defaultAction(snapshot, componentId, kind);
  if (!action) return;

  setActions(componentId, [...existing, action]);
  if (action.kind === 'trigger') addTriggerWire(componentId, action.target.nodeId);
}

function defaultAction(snapshot: Snapshot, componentId: Id, kind: ActionKind): Action | undefined {
  switch (kind) {
    case 'trigger': {
      const first = triggerChoices(snapshot)[0];
      return first ? { kind, target: { nodeId: first.value, portId: 'pt_run' } } : undefined;
    }
    case 'navigate': {
      const first = screenChoices(snapshot, componentId)[0];
      if (!first) return undefined;
      const flowId = createFlow(componentId, first.value);
      return flowId ? { kind, flowId } : undefined;
    }
    case 'setVariable': {
      const first = variableChoices(snapshot)[0];
      return first ? { kind, nodeId: first.value, value: { kind: 'static', value: '' } } : undefined;
    }
    case 'setField': {
      const first = fieldChoices(snapshot, componentId)[0];
      return first
        ? { kind, componentId: first.value, value: { kind: 'static', value: '' } }
        : undefined;
    }
    case 'clearField': {
      const first = fieldChoices(snapshot, componentId)[0];
      return first ? { kind, componentId: first.value } : undefined;
    }
    case 'message':
      return { kind, text: 'Saved', tone: 'ok' };
    case 'signIn':
    case 'signUp': {
      // A sign-in form is two fields and a button, so the two fields are the guess. Wrong is
      // better than blank here: a wrong pick is one click to change, a blank one is a puzzle.
      const fields = fieldChoices(snapshot, componentId);
      const email = fields[0] ? fieldValue(fields[0].value) : blankValue();
      const password = fields[1] ? fieldValue(fields[1].value) : blankValue();
      return { kind, email, password };
    }
    case 'signInWith':
      // Google first because it is the one most people have, not because it is favoured.
      return { kind, provider: SSO_PROVIDERS[0]!.id };
    case 'signOut':
      return { kind };
    case 'openUrl':
      return { kind, url: 'https://' };
    case 'copy':
      return { kind, value: { kind: 'static', value: '' } };
  }
}

// ---------------------------------------------------------------------------
// Flows, which are navigation
// ---------------------------------------------------------------------------

/** The flow arrow *is* the navigation, so picking a destination creates or retargets one. */
export function createFlow(componentId: Id, targetArtboardId: Id): Id | undefined {
  const snapshot = getState().snapshot;
  const from = artboardOf(snapshot, componentId);
  if (!from || !snapshot.artboards[targetArtboardId]) return undefined;

  const flowId = newFlowId();
  const params = snapshot.artboards[targetArtboardId]?.params ?? [];
  dispatch({
    type: 'addFlow',
    flow: {
      id: flowId,
      from,
      to: targetArtboardId,
      // Dynamic destinations need a value per param; seed them so the project still compiles.
      payload: params.map((p) => ({ kind: 'static' as const, param: p.name, value: '' })),
    },
  });
  return flowId;
}

/** Retarget a `navigate` step: a new arrow, and the old one goes with it. */
export function retargetNavigate(componentId: Id, index: number, artboardId: Id): void {
  const current = actionsFor(getState().snapshot, componentId)[index];
  if (current?.kind !== 'navigate') return;

  const flowId = createFlow(componentId, artboardId);
  if (!flowId) return;
  updateAction(componentId, index, { ...current, flowId });
  dispatch({ type: 'removeFlow', flowId: current.flowId });
}

// ---------------------------------------------------------------------------
// The wire and the action are one fact in two views
// ---------------------------------------------------------------------------

function mirrorOf(snapshot: Snapshot, componentId: Id): Id | undefined {
  return Object.values(snapshot.nodes).find((node) => node.mirrorOf === componentId)?.id;
}

function addTriggerWire(componentId: Id, nodeId: Id): void {
  const snapshot = getState().snapshot;
  const mirror = mirrorOf(snapshot, componentId);
  if (!mirror) return;

  const already = Object.values(snapshot.wires).some(
    (wire) =>
      wire.from.nodeId === mirror && wire.to.nodeId === nodeId && wire.to.portId === 'pt_run',
  );
  if (already) return;

  dispatch({
    type: 'addWire',
    wire: {
      id: newWireId(),
      from: { nodeId: mirror, portId: 'pt_click' },
      to: { nodeId, portId: 'pt_run' },
    },
  });
}

function removeTriggerWire(componentId: Id, nodeId: Id): void {
  const snapshot = getState().snapshot;
  const mirror = mirrorOf(snapshot, componentId);
  if (!mirror) return;

  for (const wire of Object.values(snapshot.wires)) {
    if (wire.from.nodeId !== mirror) continue;
    if (wire.to.nodeId !== nodeId || wire.to.portId !== 'pt_run') continue;
    dispatch({ type: 'removeWire', wireId: wire.id });
  }
}
