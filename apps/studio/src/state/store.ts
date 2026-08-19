import {
  applyOp,
  createEmptyProject,
  newArtboardId,
  newComponentId,
  type Component,
  type Id,
  type Layout,
  type Op,
  type PropertyValue,
  type Snapshot,
} from '@loom/ir';
import { createComponent, defFor } from '@loom/components';

/**
 * The editor's document state. Every mutation is an **atomic op** applied to an immutable
 * snapshot (docs/02, guardrail 10) — that is what buys undo/redo for free here and keeps a
 * semantic merge possible later. The store never mutates a snapshot in place.
 */

export interface EditorState {
  snapshot: Snapshot;
  selectedId: Id | undefined;
  past: Snapshot[];
  future: Snapshot[];
}

type Listener = () => void;

const HISTORY_LIMIT = 100;

function initialSnapshot(): Snapshot {
  const rootId = newComponentId();
  const artboardId = newArtboardId();
  const root = createComponent('Frame', rootId);
  root.name = 'Root';

  const empty = createEmptyProject('Untitled');
  const withArtboard = applyOp(empty, {
    type: 'addArtboard',
    artboard: { id: artboardId, name: 'Home', root: rootId },
    root,
  });

  const heading = createComponent('Text', newComponentId());
  heading.name = 'Heading';
  heading.props.content = { kind: 'static', value: 'Hello loomJS' };

  return applyOp(withArtboard, { type: 'addComponent', component: heading, parentId: rootId });
}

let state: EditorState = {
  snapshot: initialSnapshot(),
  selectedId: undefined,
  past: [],
  future: [],
};

const listeners = new Set<Listener>();

function set(next: EditorState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getState(): EditorState {
  return state;
}

/** Apply an op, pushing the previous snapshot onto the undo stack. */
export function dispatch(op: Op): void {
  const snapshot = applyOp(state.snapshot, op);
  set({
    ...state,
    snapshot,
    past: [...state.past, state.snapshot].slice(-HISTORY_LIMIT),
    future: [],
  });
}

export function select(id: Id | undefined): void {
  set({ ...state, selectedId: id });
}

export function undo(): void {
  const previous = state.past.at(-1);
  if (!previous) return;
  set({
    ...state,
    snapshot: previous,
    past: state.past.slice(0, -1),
    future: [state.snapshot, ...state.future],
    selectedId: previous.components[state.selectedId ?? ''] ? state.selectedId : undefined,
  });
}

export function redo(): void {
  const next = state.future[0];
  if (!next) return;
  set({
    ...state,
    snapshot: next,
    past: [...state.past, state.snapshot],
    future: state.future.slice(1),
  });
}

// ---------------------------------------------------------------------------
// Document helpers (each one is a thin wrapper over an op)
// ---------------------------------------------------------------------------

export function entryArtboardId(snapshot: Snapshot): Id {
  return snapshot.entryArtboard ?? Object.keys(snapshot.artboards)[0]!;
}

export function rootComponentId(snapshot: Snapshot): Id {
  return snapshot.artboards[entryArtboardId(snapshot)]!.root;
}

export function parentOf(snapshot: Snapshot, id: Id): Component | undefined {
  return Object.values(snapshot.components).find((c) => c.children?.includes(id));
}

/** Where a new component should land: inside the selection if it is a container, else beside it. */
function insertionParent(snapshot: Snapshot, selectedId: Id | undefined): Id {
  const root = rootComponentId(snapshot);
  if (!selectedId) return root;
  const selected = snapshot.components[selectedId];
  if (!selected) return root;
  if (defFor(selected.type)?.isContainer) return selectedId;
  return parentOf(snapshot, selectedId)?.id ?? root;
}

export function addComponent(type: string): void {
  const component = createComponent(type, newComponentId());
  const parentId = insertionParent(state.snapshot, state.selectedId);
  dispatch({ type: 'addComponent', component, parentId });
  select(component.id);
}

export function setProp(componentId: Id, key: string, value: PropertyValue): void {
  dispatch({ type: 'setProp', componentId, key, value });
}

export function setStaticProp(componentId: Id, key: string, value: unknown): void {
  setProp(componentId, key, { kind: 'static', value });
}

export function setLayout(componentId: Id, layout: Partial<Layout>): void {
  dispatch({ type: 'setLayout', componentId, layout });
}

export function rename(componentId: Id, name: string): void {
  dispatch({ type: 'setName', componentId, name });
}

export function removeComponent(componentId: Id): void {
  // The artboard's root is structural — deleting it would leave an artboard with no tree.
  if (componentId === rootComponentId(state.snapshot)) return;
  dispatch({ type: 'removeComponent', componentId });
  if (state.selectedId === componentId) select(undefined);
}

/** Reorder within the current parent by `delta` positions. */
export function nudgeOrder(componentId: Id, delta: number): void {
  const parent = parentOf(state.snapshot, componentId);
  if (!parent?.children) return;
  const index = parent.children.indexOf(componentId);
  const target = Math.max(0, Math.min(parent.children.length - 1, index + delta));
  if (target === index) return;
  dispatch({ type: 'moveComponent', componentId, parentId: parent.id, index: target });
}

/** Reparent (used by the layers panel). */
export function moveComponent(componentId: Id, parentId: Id, index?: number): void {
  dispatch({ type: 'moveComponent', componentId, parentId, index });
}

/** Test seam: reset the module-level store. */
export function __resetStore(snapshot: Snapshot = initialSnapshot()): void {
  set({ snapshot, selectedId: undefined, past: [], future: [] });
}
