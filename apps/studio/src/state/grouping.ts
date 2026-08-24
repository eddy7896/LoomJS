import { createComponent } from '@loom/components';
import {
  newComponentId,
  type Component,
  type Id,
  type Op,
  type SizeMode,
  type Snapshot,
} from '@loom/ir';
import { dispatchAll, getState, selectComponent, selectedComponents } from './store';

/**
 * Grouping (G1, `docs/16-grouping.md`).
 *
 * A group in loom is a **Frame** — the container that already exists, already lays out, already
 * styles and already emits. Adding a second kind of container that only the editor understood
 * would mean two things a designer has to tell apart and one of them disappearing at compile
 * time. So Group wraps a selection in a Frame, and Ungroup unwraps it.
 *
 * The whole difficulty is geometry. Inside a free frame a child carries its own coordinates, so
 * wrapping has to move them into the new frame's space and unwrapping has to move them back —
 * otherwise everything jumps to the corner the moment you group it, which is the bug every
 * home-made grouping has.
 */

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A fixed dimension in px, or nothing — `hug` and `fill` have no number until something renders. */
function fixed(mode: SizeMode | undefined): number | undefined {
  return mode?.mode === 'fixed' ? mode.px : undefined;
}

/**
 * Where a component sits inside a free parent, and how big it is.
 *
 * A `hug` or `fill` component has no width the document knows — the browser decides it — so the
 * box falls back to a readable minimum rather than to zero. A group drawn around a zero-width
 * thing would be a group you cannot see or grab.
 */
const UNKNOWN_SIDE = 100;

function boxOf(component: Component): Box {
  return {
    x: component.position?.x ?? 0,
    y: component.position?.y ?? 0,
    width: fixed(component.layout?.size?.width) ?? UNKNOWN_SIDE,
    height: fixed(component.layout?.size?.height) ?? UNKNOWN_SIDE,
  };
}

/** The smallest box holding all of them. */
export function bounds(components: readonly Component[]): Box {
  const boxes = components.map(boxOf);
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function parentOf(snapshot: Snapshot, id: Id): Component | undefined {
  return Object.values(snapshot.components).find((candidate) =>
    (candidate.children ?? []).includes(id),
  );
}

/** True when this parent gives its children coordinates rather than stacking them. */
function isFree(parent: Component | undefined): boolean {
  return parent?.layout?.mode === 'free';
}

/**
 * Why a selection cannot be grouped, or nothing when it can.
 *
 * Said in words rather than by a disabled button with no explanation: "why is this greyed out" is
 * the question a disabled button always produces and never answers.
 */
export function groupingProblem(snapshot: Snapshot, ids: readonly Id[]): string | undefined {
  if (ids.length < 2) return 'Pick two or more things to group.';

  const parents = new Set(ids.map((id) => parentOf(snapshot, id)?.id));
  if (parents.size > 1) {
    return 'Everything in a group has to sit in the same frame to start with.';
  }
  if ([...parents][0] === undefined) return 'A screen cannot be grouped.';
  return undefined;
}

/**
 * Wrap the current selection in a Frame.
 *
 * The frame lands where the selection was — at its bounding box in a free parent, in the first
 * selected thing's place in a stacked one — and the children keep the arrangement they had.
 */
export function groupSelection(): Id | undefined {
  const state = getState();
  const snapshot = state.snapshot;
  const ids = selectedComponents();
  if (groupingProblem(snapshot, ids)) return undefined;

  const parent = parentOf(snapshot, ids[0]!);
  if (!parent) return undefined;

  // The order on screen, not the order they were clicked in: a group that reshuffled its contents
  // would redraw the screen the moment it was made.
  const ordered = (parent.children ?? []).filter((id) => ids.includes(id));
  const components = ordered.map((id) => snapshot.components[id]!);

  const frame = createComponent('Frame', newComponentId());
  frame.name = 'Group';

  const ops: Op[] = [];

  if (isFree(parent)) {
    const box = bounds(components);
    frame.layout = {
      ...(frame.layout ?? {}),
      mode: 'free',
      size: {
        width: { mode: 'fixed', px: box.width },
        height: { mode: 'fixed', px: box.height },
      },
    } as Component['layout'];
    frame.position = { x: box.x, y: box.y };

    ops.push({ type: 'addComponent', component: frame, parentId: parent.id });
    for (const component of components) {
      ops.push({ type: 'moveComponent', componentId: component.id, parentId: frame.id });
      // Into the frame's space: a child at 240 inside a frame that starts at 200 is at 40.
      ops.push({
        type: 'setPosition',
        componentId: component.id,
        position: {
          x: (component.position?.x ?? 0) - box.x,
          y: (component.position?.y ?? 0) - box.y,
        },
      });
    }
  } else {
    // A stacked parent gives no coordinates to preserve; the group keeps the stacking direction
    // so the contents go on reading the way they did.
    frame.layout = { ...(parent.layout ?? {}) } as Component['layout'];
    ops.push({ type: 'addComponent', component: frame, parentId: parent.id });
    for (const component of components) {
      ops.push({ type: 'moveComponent', componentId: component.id, parentId: frame.id });
    }
  }

  dispatchAll(ops);
  selectComponent(frame.id);
  return frame.id;
}

/**
 * Take a group apart, leaving what was inside it where it looked.
 *
 * Any Frame can be ungrouped, not only one loom made: a designer who built the frame by hand and
 * now wants its contents loose is asking for the same thing.
 */
export function ungroup(frameId: Id): boolean {
  const snapshot = getState().snapshot;
  const frame = snapshot.components[frameId];
  const parent = parentOf(snapshot, frameId);
  if (!frame || !parent || (frame.children ?? []).length === 0) return false;

  const ops: Op[] = [];
  const free = isFree(parent);

  for (const childId of frame.children ?? []) {
    const child = snapshot.components[childId];
    if (!child) continue;

    ops.push({ type: 'moveComponent', componentId: childId, parentId: parent.id });
    if (free) {
      // Back out of the frame's space, so nothing moves on screen.
      ops.push({
        type: 'setPosition',
        componentId: childId,
        position: {
          x: (frame.position?.x ?? 0) + (child.position?.x ?? 0),
          y: (frame.position?.y ?? 0) + (child.position?.y ?? 0),
        },
      });
    }
  }

  ops.push({ type: 'removeComponent', componentId: frameId });
  dispatchAll(ops);
  selectComponent(parent.id);
  return true;
}
