import {
  actionsOf,
  applyOp,
  createEmptyProject,
  newArtboardId,
  newComponentId,
  newFlowId,
  type Component,
  type FlowPayload,
  type Id,
  type Layout,
  type Op,
  type Param,
  type PropertyValue,
  type ScreenSize,
  type SizeMode,
  type Snapshot,
  type Style,
} from '@loom/ir';
import { createComponent, defFor } from '@loom/components';
import { __resetBuildResult } from './build';

/**
 * The editor's document state. Every mutation is an **atomic op** applied to an immutable
 * snapshot (docs/02, guardrail 10) — that is what buys undo/redo for free here and keeps a
 * semantic merge possible later. The store never mutates a snapshot in place.
 */

export type Selection =
  | { kind: 'component'; id: Id }
  | { kind: 'artboard'; id: Id }
  | { kind: 'flow'; id: Id }
  | { kind: 'node'; id: Id }
  | { kind: 'wire'; id: Id }
  | undefined;

/** Which canvas is on screen. A view concern, so it lives beside the document, not inside it. */
export type Mode = 'design' | 'nodes';

/**
 * Which section of the icon rail is open, and therefore what the left column shows
 * (`docs/11-editor-shell.md`). Design and Nodes also swap the canvas; Data does not — connecting a
 * database should not throw away the canvas you were looking at.
 */
export type Rail = 'design' | 'nodes' | 'data';

export interface EditorState {
  snapshot: Snapshot;
  mode: Mode;
  rail: Rail;
  /**
   * Components hidden **in the editor only** (S2, `docs/11-editor-shell.md`).
   *
   * Deliberately not in the snapshot, and deliberately not `visibleWhen`: hiding something to get
   * it out of your way while you work must never change the app you are building. It is a view
   * concern, so it lives beside the document — and it is gone on reload, because a project that
   * remembered which parts you had hidden would be a project that lies about what it contains.
   */
  hiddenInEditor: ReadonlySet<Id>;
  /**
   * Branches of the elements tree that are folded shut. In the store rather than the panel so
   * that **selecting** something can open the rows above it: a selection buried in a shut branch
   * reads as the click having done nothing, and that has to hold whether or not the selection
   * actually changed.
   */
  collapsedLayers: ReadonlySet<Id>;
  selection: Selection;
  /** The artboard the canvas is working in — where new components land. */
  activeArtboardId: Id;
  past: Snapshot[];
  future: Snapshot[];
}

type Listener = () => void;

const HISTORY_LIMIT = 100;

function initialSnapshot(): { snapshot: Snapshot; artboardId: Id } {
  const rootId = newComponentId();
  const artboardId = newArtboardId();
  const root = createComponent('Frame', rootId);
  root.name = 'Root';

  const withArtboard = applyOp(createEmptyProject('Untitled'), {
    type: 'addArtboard',
    artboard: { id: artboardId, name: 'Home', root: rootId },
    root,
  });

  const heading = createComponent('Text', newComponentId());
  heading.name = 'Heading';
  heading.props.content = { kind: 'static', value: 'Hello loomJS' };

  return {
    snapshot: applyOp(withArtboard, {
      type: 'addComponent',
      component: heading,
      parentId: rootId,
    }),
    artboardId,
  };
}

function freshState(): EditorState {
  const { snapshot, artboardId } = initialSnapshot();
  return {
    snapshot,
    mode: 'design',
    rail: 'design',
    hiddenInEditor: new Set<Id>(),
    collapsedLayers: new Set<Id>(),
    selection: undefined,
    activeArtboardId: artboardId,
    past: [],
    future: [],
  };
}

let state: EditorState = freshState();
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

/**
 * Apply several ops as **one** undoable step. Inference materialises a whole pipeline (M5); a
 * designer who regrets it presses undo once, not eleven times. The ops are still atomic in the
 * document — this batches only the history entry.
 */
export function dispatchAll(ops: Op[]): void {
  if (ops.length === 0) return;
  const snapshot = ops.reduce(applyOp, state.snapshot);
  set({
    ...state,
    snapshot,
    past: [...state.past, state.snapshot].slice(-HISTORY_LIMIT),
    future: [],
  });
}

export function select(selection: Selection): void {
  set({ ...state, selection });
}

export function selectComponent(id: Id | undefined): void {
  if (!id) {
    select(undefined);
    return;
  }
  // Reveal it: every ancestor opens, so the row is on screen wherever the selection came from.
  const opened = new Set(state.collapsedLayers);
  for (let cursor = parentOf(state.snapshot, id); cursor; cursor = parentOf(state.snapshot, cursor.id)) {
    opened.delete(cursor.id);
  }
  set({ ...state, collapsedLayers: opened, selection: { kind: 'component', id } });
}

/** Fold one branch shut, or open it. */
export function toggleLayer(componentId: Id): void {
  const next = new Set(state.collapsedLayers);
  if (!next.delete(componentId)) next.add(componentId);
  set({ ...state, collapsedLayers: next });
}

/** Fold everything, or open everything — whichever the current state is not. */
export function toggleAllLayers(): void {
  if (state.collapsedLayers.size > 0) {
    set({ ...state, collapsedLayers: new Set<Id>() });
    return;
  }
  const parents = Object.values(state.snapshot.components)
    .filter((component) => (component.children ?? []).length > 0)
    .map((component) => component.id);
  set({ ...state, collapsedLayers: new Set(parents) });
}

export function selectedComponentId(s: EditorState = state): Id | undefined {
  return s.selection?.kind === 'component' ? s.selection.id : undefined;
}

export function setActiveArtboard(id: Id): void {
  set({ ...state, activeArtboardId: id, selection: { kind: 'artboard', id } });
}

const SELECTION_TABLES = {
  component: 'components',
  artboard: 'artboards',
  flow: 'flows',
  node: 'nodes',
  wire: 'wires',
} as const;

function stillExists(snapshot: Snapshot, selection: Selection): Selection {
  if (!selection) return undefined;
  const table = snapshot[SELECTION_TABLES[selection.kind]] as Record<string, unknown>;
  return table[selection.id] ? selection : undefined;
}

export function setMode(mode: Mode): void {
  // The rail follows: revealing a node in Nodes mode while the column still showed the Data panel
  // would leave the two halves of the editor disagreeing about what you are looking at.
  set({ ...state, mode, rail: mode });
}

/** Hide or show a component on the canvas. Editor-only — the emitted app never knows. */
export function toggleEditorVisibility(componentId: Id): void {
  const next = new Set(state.hiddenInEditor);
  if (!next.delete(componentId)) next.add(componentId);
  set({ ...state, hiddenInEditor: next });
}

export function isHiddenInEditor(snapshot: Snapshot, hidden: ReadonlySet<Id>, id: Id): boolean {
  // A hidden container takes its subtree with it, the same way the canvas would.
  for (let cursor: Id | undefined = id; cursor; cursor = parentOf(snapshot, cursor)?.id) {
    if (hidden.has(cursor)) return true;
  }
  return false;
}

export function setRail(rail: Rail): void {
  set({ ...state, rail, mode: rail === 'data' ? state.mode : rail });
}

export function undo(): void {
  const previous = state.past.at(-1);
  if (!previous) return;
  set({
    ...state,
    snapshot: previous,
    past: state.past.slice(0, -1),
    future: [state.snapshot, ...state.future],
    selection: stillExists(previous, state.selection),
    activeArtboardId: previous.artboards[state.activeArtboardId]
      ? state.activeArtboardId
      : Object.keys(previous.artboards)[0]!,
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
    selection: stillExists(next, state.selection),
    activeArtboardId: next.artboards[state.activeArtboardId]
      ? state.activeArtboardId
      : Object.keys(next.artboards)[0]!,
  });
}

// ---------------------------------------------------------------------------
// Document helpers (each one is a thin wrapper over an op)
// ---------------------------------------------------------------------------

export function entryArtboardId(snapshot: Snapshot): Id {
  return snapshot.entryArtboard ?? Object.keys(snapshot.artboards)[0]!;
}

/** Root component of the artboard currently being edited. */
export function rootComponentId(snapshot: Snapshot, artboardId = state.activeArtboardId): Id {
  return (
    snapshot.artboards[artboardId]?.root ?? snapshot.artboards[entryArtboardId(snapshot)]!.root
  );
}

export function parentOf(snapshot: Snapshot, id: Id): Component | undefined {
  return Object.values(snapshot.components).find((c) => c.children?.includes(id));
}

/** Which artboard a component belongs to (walks up to a root). */
export function artboardOf(snapshot: Snapshot, componentId: Id): Id | undefined {
  let current: Id | undefined = componentId;
  const seen = new Set<Id>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const owner = Object.entries(snapshot.artboards).find(([, a]) => a.root === current);
    if (owner) return owner[0];
    current = parentOf(snapshot, current)?.id;
  }
  return undefined;
}

/** Where a new component should land: inside the selection if it is a container, else beside it. */
function insertionParent(snapshot: Snapshot, selection: Selection): Id {
  const root = rootComponentId(snapshot);
  if (selection?.kind !== 'component') return root;
  const selected = snapshot.components[selection.id];
  if (!selected) return root;
  if (defFor(selected.type)?.isContainer) return selection.id;
  return parentOf(snapshot, selection.id)?.id ?? root;
}

export function addComponent(type: string): void {
  const component = createComponent(type, newComponentId());
  const parentId = insertionParent(state.snapshot, state.selection);
  dispatch({ type: 'addComponent', component, parentId });
  selectComponent(component.id);
}

export function setProp(componentId: Id, key: string, value: PropertyValue): void {
  dispatch({ type: 'setProp', componentId, key, value });
}

export function setStaticProp(componentId: Id, key: string, value: unknown): void {
  setProp(componentId, key, { kind: 'static', value });
}

/** Style one property. Passing `undefined` clears it back to the browser's own default. */
export function setStyle(componentId: Id, style: Partial<Style>): void {
  dispatch({ type: 'setStyle', componentId, style });
}

/** Override one design token for the whole project, or clear the override. */
export function setThemeToken(token: string, value: string | undefined): void {
  dispatch({ type: 'setThemeToken', token, value });
}

export function setLayout(componentId: Id, layout: Partial<Layout>): void {
  dispatch({ type: 'setLayout', componentId, layout });
}

/** Size is nested inside layout, so a partial update has to carry the other axis along. */
export function setSize(componentId: Id, axis: 'width' | 'height', size: SizeMode): void {
  const current = state.snapshot.components[componentId]?.layout?.size;
  const next = {
    width: axis === 'width' ? size : (current?.width ?? { mode: 'hug' as const }),
    height: axis === 'height' ? size : (current?.height ?? { mode: 'hug' as const }),
  };
  setLayout(componentId, { size: next });
}

export function rename(componentId: Id, name: string): void {
  dispatch({ type: 'setName', componentId, name });
}

export function removeComponent(componentId: Id): void {
  // The artboard's root is structural — deleting it would leave an artboard with no tree.
  if (componentId === rootComponentId(state.snapshot, artboardOf(state.snapshot, componentId))) {
    return;
  }
  dispatch({ type: 'removeComponent', componentId });
  if (selectedComponentId() === componentId) select(undefined);
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

/** Reparent / reorder (canvas drag and the layers panel both land here). */
export function moveComponent(componentId: Id, parentId: Id, index?: number): void {
  dispatch({ type: 'moveComponent', componentId, parentId, index });
}

// ---------------------------------------------------------------------------
// Artboards and flows (M2)
// ---------------------------------------------------------------------------

export function addArtboard(name = 'Screen'): Id {
  const artboardId = newArtboardId();
  const root = createComponent('Frame', newComponentId());
  root.name = 'Root';
  dispatch({ type: 'addArtboard', artboard: { id: artboardId, name, root: root.id }, root });
  setActiveArtboard(artboardId);
  return artboardId;
}

export function renameArtboard(artboardId: Id, name: string): void {
  dispatch({ type: 'renameArtboard', artboardId, name });
}

export function setArtboardParams(artboardId: Id, params: Param[]): void {
  dispatch({ type: 'setArtboardParams', artboardId, params });
}

/**
 * Resize a screen. This is the frame the designer works in and the width the Preview runs at —
 * not a breakpoint. V1 emits one adaptive layout (`docs/07-v1-scope.md`).
 */
export function setArtboardSize(artboardId: Id, size: ScreenSize): void {
  dispatch({ type: 'setArtboardSize', artboardId, size });
}

export function setEntryArtboard(artboardId: Id): void {
  dispatch({ type: 'setEntryArtboard', artboardId });
}

export function removeArtboard(artboardId: Id): void {
  if (Object.keys(state.snapshot.artboards).length <= 1) return;
  dispatch({ type: 'removeArtboard', artboardId });
  const remaining = Object.keys(state.snapshot.artboards)[0]!;
  set({
    ...state,
    activeArtboardId: state.snapshot.artboards[state.activeArtboardId]
      ? state.activeArtboardId
      : remaining,
    selection: stillExists(state.snapshot, state.selection),
  });
}

/** The first screen a component's click goes to, if any. Used to draw the arrow on the canvas. */
export function flowFor(snapshot: Snapshot, componentId: Id): Id | undefined {
  const onClick = snapshot.components[componentId]?.props.onClick;
  if (onClick?.kind !== 'event') return undefined;
  const navigate = actionsOf(onClick.handler).find((action) => action.kind === 'navigate');
  return navigate?.kind === 'navigate' ? navigate.flowId : undefined;
}

/**
 * Point a component's click at an artboard: the flow arrow *is* the navigation, so setting the
 * target creates (or retargets) the flow and wires the handler in one gesture.
 */
export function setClickFlow(componentId: Id, targetArtboardId: Id | undefined): void {
  const existing = flowFor(state.snapshot, componentId);

  if (!targetArtboardId) {
    if (existing) dispatch({ type: 'removeFlow', flowId: existing });
    dispatch({ type: 'removeProp', componentId, key: 'onClick' });
    return;
  }

  const from = artboardOf(state.snapshot, componentId);
  if (!from) return;

  if (existing && state.snapshot.flows[existing]) {
    dispatch({ type: 'removeFlow', flowId: existing });
  }

  const flowId = newFlowId();
  const params = state.snapshot.artboards[targetArtboardId]?.params ?? [];
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
  dispatch({
    type: 'setProp',
    componentId,
    key: 'onClick',
    value: { kind: 'event', handler: { kind: 'navigate', flowId } },
  });
}

export function setFlowPayload(flowId: Id, payload: FlowPayload[]): void {
  dispatch({ type: 'setFlowPayload', flowId, payload });
}

export function removeFlow(flowId: Id): void {
  // Detach any step pointing at the flow, or the project would reference a dead arrow. Only that
  // step: the rest of the sequence is a separate set of decisions (spec 7).
  for (const component of Object.values(state.snapshot.components)) {
    const onClick = component.props.onClick;
    if (onClick?.kind !== 'event') continue;
    const kept = actionsOf(onClick.handler).filter(
      (action) => !(action.kind === 'navigate' && action.flowId === flowId),
    );
    if (kept.length === actionsOf(onClick.handler).length) continue;
    if (kept.length === 0) {
      dispatch({ type: 'removeProp', componentId: component.id, key: 'onClick' });
    } else {
      dispatch({
        type: 'setProp',
        componentId: component.id,
        key: 'onClick',
        value: { kind: 'event', handler: { kind: 'actions', actions: kept } },
      });
    }
  }
  dispatch({ type: 'removeFlow', flowId });
  if (state.selection?.kind === 'flow' && state.selection.id === flowId) select(undefined);
}

/**
 * Open a document — a restored save, or a project the platform handed over later. History starts
 * empty: undo should not walk back into a session the designer was not part of.
 */
export function loadSnapshot(snapshot: Snapshot): void {
  const artboardId = snapshot.entryArtboard ?? Object.keys(snapshot.artboards)[0];
  if (!artboardId) return;
  set({
    snapshot,
    mode: 'design',
    rail: 'design',
    hiddenInEditor: new Set<Id>(),
    collapsedLayers: new Set<Id>(),
    selection: undefined,
    activeArtboardId: artboardId,
    past: [],
    future: [],
  });
}

/** Throw the document away and start over. Destructive, so the caller confirms first. */
export function resetProject(): void {
  // The compiler's last verdict belongs to the document that produced it; carried across a New it
  // would name entities that no longer exist.
  __resetBuildResult();
  set(freshState());
}

/** Test seam: reset the module-level store. */
export function __resetStore(): void {
  __resetBuildResult();
  set(freshState());
}
