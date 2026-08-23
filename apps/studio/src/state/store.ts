import {
  actionsOf,
  applyOp,
  createEmptyProject,
  newArtboardId,
  newComponentId,
  newFlowId,
  type Component,
  type FlowPayload,
  type Guard,
  type Guides,
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
import {
  createComponent,
  defFor,
  DEFAULT_LAYOUT,
  screenPreset,
} from '@loom/components';
import { __resetBuildResult } from './build';
import { ssoLabel } from '@loom/connectors';

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
 * What the pointer does on the canvas (`docs/12-canvas.md`).
 *
 * `move` is the arrow: select, drag, reorder. Anything else is a **placement tool** — the next
 * press on the canvas draws that element, and the tool returns to `move` afterwards, which is the
 * muscle memory every design tool shares.
 *
 * A tool is written as a component type, with a variant after a colon for the types that have
 * one: `Shape:ellipse`. One string, so a toolbar button, a keyboard shortcut and a test all name
 * the same thing.
 */
export type Tool = 'move' | string;

export const toolPlaces = (tool: Tool): { type: string; variant?: string } | undefined => {
  if (tool === 'move') return undefined;
  const [type, variant] = tool.split(':');
  return type ? { type, ...(variant ? { variant } : {}) } : undefined;
};

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
  tool: Tool;
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
  /**
   * The rest of a multiple selection (G1).
   *
   * `selection` stays the one thing the inspector edits and the overlay follows; this is what
   * *else* is picked, and it only ever holds components. Making the whole selection a list would
   * have meant asking "which one do I edit?" at every panel, and the honest answer — the one you
   * clicked last — is exactly what `selection` already means.
   */
  also: Id[];
  /** The artboard the canvas is working in — where new components land. */
  activeArtboardId: Id;
  past: Snapshot[];
  future: Snapshot[];
}

type Listener = () => void;

const HISTORY_LIMIT = 100;

/**
 * A new project is **empty** — not one empty screen, but nothing at all
 * (`docs/12-canvas.md` C0).
 *
 * A seeded screen is a decision made on someone's behalf before they have said anything: its
 * size, its name, that there is one of it. Drawing the first frame is already how every screen
 * after it gets made, so the first one is no different, and an empty canvas with a toolbar under
 * it says "draw" more clearly than a rectangle nobody asked for.
 */
function initialSnapshot(): { snapshot: Snapshot; artboardId: Id } {
  return { snapshot: createEmptyProject('Untitled'), artboardId: '' };
}

function freshState(): EditorState {
  const { snapshot, artboardId } = initialSnapshot();
  return {
    snapshot,
    mode: 'design',
    rail: 'design',
    tool: 'move',
    hiddenInEditor: new Set<Id>(),
    collapsedLayers: new Set<Id>(),
    selection: undefined,
    also: [],
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
/**
 * The gesture a live edit belongs to, if one is in flight.
 *
 * A drag or a resize is *one* thing a person did, and it arrives as sixty ops. Without this,
 * moving a box across the screen would take sixty presses of undo to take back — so the first op
 * of a gesture pushes history and the rest replace the snapshot in place.
 */
let gesture: string | undefined;

export function dispatchDuring(id: string, op: Op): void {
  const snapshot = applyOp(state.snapshot, op);
  set({
    ...state,
    snapshot,
    past: gesture === id ? state.past : [...state.past, state.snapshot].slice(-HISTORY_LIMIT),
    future: [],
  });
  gesture = id;
}

/** The gesture is over; the next edit is its own undo step again. */
export function endGesture(): void {
  gesture = undefined;
}

export function dispatch(op: Op): void {
  gesture = undefined;
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
  set({ ...state, selection, also: [] });
}

/**
 * Add or remove one component from the selection (G1).
 *
 * Shift-click, in the tree or on the canvas. Clicking the one that is already primary with more
 * behind it promotes the next in line rather than clearing everything: a shift-click that emptied
 * the selection would undo work rather than adjust it.
 */
export function extendSelection(id: Id): void {
  if (state.selection?.kind !== 'component') {
    selectComponent(id);
    return;
  }

  const primary = state.selection.id;
  if (id === primary) {
    const [next, ...rest] = state.also;
    if (!next) return;
    set({ ...state, selection: { kind: 'component', id: next }, also: rest });
    return;
  }

  if (state.also.includes(id)) {
    set({ ...state, also: state.also.filter((entry) => entry !== id) });
    return;
  }

  set({ ...state, also: [...state.also, id] });
}

/** Everything picked, primary first — the order Group uses to decide what wraps what. */
export function selectedComponents(): Id[] {
  if (state.selection?.kind !== 'component') return [];
  return [state.selection.id, ...state.also];
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
  set({ ...state, collapsedLayers: opened, selection: { kind: 'component', id }, also: [] });
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
  set({ ...state, activeArtboardId: id, selection: { kind: 'artboard', id }, also: [] });
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
  // Leaving Design puts the pointer back: a half-drawn rectangle has nowhere to land in the node
  // graph, and coming back to a canvas still armed with a tool is a surprise.
  if (mode !== 'design' && state.tool !== 'move') state = { ...state, tool: 'move' };
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

/** Pick a tool. Switching to Nodes puts the pointer back, since there is nothing to draw there. */
export function setTool(tool: Tool): void {
  set({ ...state, tool });
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
    also: state.also.filter((id) => previous.components[id]),
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
    also: state.also.filter((id) => next.components[id]),
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
/** The root of the screen being worked on. Empty when the project has no screens yet. */
export function rootComponentId(snapshot: Snapshot, artboardId = state.activeArtboardId): Id {
  return snapshot.artboards[artboardId]?.root ?? snapshot.artboards[entryArtboardId(snapshot)]?.root ?? '';
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

export function addComponent(
  type: string,
  /** What the element arrives already saying, when it is one that says something. */
  options: { signInWith?: string } = {},
): void {
  const parentId = insertionParent(state.snapshot, state.selection);
  // Nowhere to put it: a project with no screens has nothing to place into, and the canvas says
  // so rather than the studio throwing.
  if (!parentId) return;

  const component = createComponent(type, newComponentId());
  if (type === 'Frame') {
    component.layout = { ...(component.layout ?? DEFAULT_LAYOUT), mode: 'free' };
  }
  // Placed from the palette rather than drawn, so there is no gesture to take a place from.
  if (isFree(state.snapshot, parentId)) component.position = nextSpot(parentId);

  if (options.signInWith) {
    component.name = ssoLabel(options.signInWith);
    component.props.label = { kind: 'static', value: ssoLabel(options.signInWith) };
    component.props.onClick = {
      kind: 'event',
      handler: {
        kind: 'actions',
        actions: [{ kind: 'signInWith', provider: options.signInWith }],
      },
    };
  }

  dispatch({ type: 'addComponent', component, parentId });
  selectComponent(component.id);
}

/**
 * Where the next thing goes when nobody said.
 *
 * A free frame gives every child a coordinate, and "no coordinate" would mean the origin — so
 * everything added from the palette would pile up in one corner, each one covering the last. This
 * lays them out the way a column would, leaving a designer something to drag rather than a stack
 * of invisible things.
 */
function nextSpot(parentId: Id): { x: number; y: number } {
  const parent = state.snapshot.components[parentId];
  const padding = parent?.layout?.padding ?? 16;
  const taken = (parent?.children ?? []).length;
  return { x: padding, y: padding + taken * 56 };
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

/**
 * Place an element where it was drawn (`docs/12-canvas.md` C2).
 *
 * The gesture ends as a **tree edit plus a layout decision** — a parent, an index along that
 * frame's axis, and a size — never as an x and a y. That is the whole reconciliation between a
 * canvas that feels free and an app that emits flex.
 */
export function placeComponent(
  type: string,
  parentId: Id,
  index: number,
  options: {
    variant?: string;
    size?: { width: number; height: number };
    /** Where it was drawn, inside a free parent. Ignored by a parent that stacks its children. */
    position?: { x: number; y: number };
    /**
     * The provider this button signs in with (`docs/19-sign-in-elements.md`).
     *
     * It arrives already saying what it does — a label and the action — because "a button that
     * signs in with Google" is the thing a designer wanted, and placing a blank Button and then
     * wiring it is the same thing done in four steps.
     */
    signInWith?: string;
  } = {},
): Id | undefined {
  const def = defFor(type);
  if (!def) return undefined;

  const component = createComponent(type, newComponentId());
  // A frame's variant is a screen size rather than a field: "a frame the shape of a phone" is a
  // thing a designer asks for, and a screen is only a frame with a route (`docs/12-canvas.md`).
  const preset = screenPreset(options.variant);
  const size = preset ? { width: preset.width, height: preset.height } : options.size;

  if (options.variant && !preset) {
    // The variant is the type's first field — the thing that makes a Shape a rectangle.
    const key = def.fields[0]?.key;
    if (key) component.props[key] = { kind: 'static', value: options.variant };
    component.name = `${options.variant[0]?.toUpperCase() ?? ''}${options.variant.slice(1)}`;
  }
  if (preset) component.name = preset.label;

  if (size) {
    // Drawn at a size means fixed at that size. Nothing else in the vocabulary starts fixed, and
    // a designer can hand either axis back to the layout from the inspector.
    component.layout = {
      ...(component.layout ?? DEFAULT_LAYOUT),
      size: {
        width: { mode: 'fixed', px: Math.round(size.width) },
        height: { mode: 'fixed', px: Math.round(size.height) },
      },
    };
  }

  // A sign-in button carries the provider's name and the action that uses it. Nothing about it
  // is a special kind of component: it is a Button, editable like any other.
  if (options.signInWith) {
    component.name = ssoLabel(options.signInWith);
    component.props.label = { kind: 'static', value: ssoLabel(options.signInWith) };
    component.props.onClick = {
      kind: 'event',
      handler: {
        kind: 'actions',
        actions: [{ kind: 'signInWith', provider: options.signInWith }],
      },
    };
  }

  // A frame drawn inside another is a drawing board too, unless someone says otherwise.
  if (type === 'Frame') {
    component.layout = { ...(component.layout ?? DEFAULT_LAYOUT), mode: 'free' };
  }
  if (isFree(state.snapshot, parentId)) {
    component.position = options.position
      ? { x: Math.round(options.position.x), y: Math.round(options.position.y) }
      : nextSpot(parentId);
  }

  dispatch({ type: 'addComponent', component, parentId, index });
  selectComponent(component.id);
  return component.id;
}

/** Does this frame hold its children where they were put? */
export function isFree(snapshot: Snapshot, componentId: Id): boolean {
  return snapshot.components[componentId]?.layout?.mode === 'free';
}

/** Move something inside a free parent. A whole drag is one undo (`dispatchDuring`). */
export function moveTo(componentId: Id, position: { x: number; y: number }): void {
  dispatchDuring(`move:${componentId}`, {
    type: 'setPosition',
    componentId,
    position: { x: Math.round(position.x), y: Math.round(position.y) },
  });
}

/**
 * Resize by dragging a handle: a fixed size, and a new place when the edge that moved was the top
 * or the left. Live, and one undo for the whole gesture.
 */
export function resizeTo(
  componentId: Id,
  size: { width: number; height: number },
  position?: { x: number; y: number },
): void {
  const component = state.snapshot.components[componentId];
  if (!component) return;

  const id = `resize:${componentId}`;
  dispatchDuring(id, {
    type: 'setLayout',
    componentId,
    layout: {
      size: {
        width: { mode: 'fixed', px: Math.max(1, Math.round(size.width)) },
        height: { mode: 'fixed', px: Math.max(1, Math.round(size.height)) },
      },
    },
  });

  const parent = parentOf(state.snapshot, componentId);
  if (!position || !parent || !isFree(state.snapshot, parent.id)) return;
  dispatchDuring(id, {
    type: 'setPosition',
    componentId,
    position: { x: Math.round(position.x), y: Math.round(position.y) },
  });
}

/**
 * Switch a frame between holding its children where they were put and arranging them itself.
 *
 * Going to auto layout drops the positions: two layouts described at once is how a document
 * starts lying about itself. Going to free keeps whatever they had, which is nothing the first
 * time — so the children land where the flex layout had already put them, and stay there.
 */
export function setLayoutMode(componentId: Id, mode: 'stack' | 'free'): void {
  const component = state.snapshot.components[componentId];
  if (!component) return;

  const ops: Op[] = [{ type: 'setLayout', componentId, layout: { mode } }];
  if (mode === 'stack') {
    for (const child of component.children ?? []) {
      if (state.snapshot.components[child]?.position) {
        ops.push({ type: 'setPosition', componentId: child, position: undefined });
      }
    }
  }
  dispatchAll(ops);
}

/**
 * A frame drawn on the open canvas is a **screen** (`docs/12-canvas.md`).
 *
 * That is the whole answer to "why are screens and frames different things": they are not. A
 * frame inside a screen is a group; the same gesture with nothing under it makes a screen, and
 * the only difference between the two is that one has a route.
 *
 * Where it was drawn is not kept: the canvas lays screens out in a row, because a screen's
 * position is not something the emitted app has any use for.
 */
export function placeScreen(size?: { width: number; height: number; preset?: string }): Id {
  const count = Object.keys(state.snapshot.artboards).length;
  // The first screen of a project is the one the app opens on, and "Home" is what that is called.
  const id = addArtboard(count === 0 ? 'Home' : `Screen ${count + 1}`);
  if (size) {
    setArtboardSize(id, {
      width: Math.round(size.width),
      height: Math.round(size.height),
      ...(size.preset ? { preset: size.preset } : {}),
    });
  }
  return id;
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
  // A new screen is a **drawing board**: what you put somewhere stays there
  // (`docs/12-canvas.md`). Auto layout is a click away on any frame, and that is where the
  // reflowing behaviour comes back — but it is chosen, not imposed on the first gesture.
  root.layout = { ...(root.layout ?? DEFAULT_LAYOUT), mode: 'free' };
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

/**
 * "Only for signed-in people, and send everyone else there" (spec 10). Undefined is the absence
 * of a guard, which is not the same as a guard nobody can satisfy.
 */
export function setArtboardGuard(artboardId: Id, guard: Guard | undefined): void {
  dispatch({ type: 'setArtboardGuard', artboardId, guard });
}

/** The lines this screen is composed against. Editor-facing, and emitted nowhere. */
export function setArtboardGuides(artboardId: Id, guides: Guides): void {
  dispatch({ type: 'setArtboardGuides', artboardId, guides });
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
    tool: 'move',
    hiddenInEditor: new Set<Id>(),
    collapsedLayers: new Set<Id>(),
    selection: undefined,
    also: [],
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
