import type { Id, Snapshot } from '@loom/ir';
import { defFor } from '@loom/components';

/**
 * Reading a point on the canvas as a place in the tree (`docs/12-canvas.md`).
 *
 * This is the reconciliation, in one function: free placement is an **input method**, so a
 * pointer position becomes a parent and an index along that frame's axis, and never an x and a y.
 * Dragging an existing component and drawing a new one are the same question asked twice, which
 * is why they share this rather than each having their own idea of where a drop lands.
 */

export interface DropTarget {
  parentId: Id;
  index: number;
  /** Where to draw the insertion line, in viewport px. */
  marker: { left: number; top: number; length: number; vertical: boolean };
}

const findParent = (snapshot: Snapshot, id: Id): Id | undefined =>
  Object.values(snapshot.components).find((c) => c.children?.includes(id))?.id;

const isContainer = (snapshot: Snapshot, id: Id): boolean => {
  const component = snapshot.components[id];
  return Boolean(component && defFor(component.type)?.isContainer);
};

/** True when `ancestorId` is at or above `id` — dropping into your own subtree is illegal. */
export function contains(snapshot: Snapshot, ancestorId: Id, id: Id): boolean {
  if (ancestorId === id) return true;
  return (snapshot.components[ancestorId]?.children ?? []).some((child) =>
    contains(snapshot, child, id),
  );
}

/**
 * The slot under a point. `moving` is the component being dragged, excluded from both the hit
 * test and the sibling list; drawing a new element passes nothing, because nothing is in flight.
 */
export function resolveDropTarget(
  snapshot: Snapshot,
  x: number,
  y: number,
  moving?: Id,
): DropTarget | undefined {
  const stack = document.elementsFromPoint(x, y);
  const element = stack.find((node): node is HTMLElement => {
    const id = (node as HTMLElement).dataset?.loomId;
    return Boolean(id && (!moving || !contains(snapshot, moving, id)));
  });
  if (!element) return undefined;

  const hovered = element.dataset.loomId!;
  const parentId = isContainer(snapshot, hovered) ? hovered : findParent(snapshot, hovered);
  if (!parentId || (moving && contains(snapshot, moving, parentId))) return undefined;

  const parent = snapshot.components[parentId];
  if (!parent) return undefined;

  const vertical = parent.layout?.direction !== 'row';
  const siblings = (parent.children ?? []).filter((id) => id !== moving);
  const rects = siblings
    .map((id) => ({ id, node: document.querySelector<HTMLElement>(`[data-loom-id="${id}"]`) }))
    .filter((entry): entry is { id: Id; node: HTMLElement } => Boolean(entry.node))
    .map((entry) => ({ id: entry.id, rect: entry.node.getBoundingClientRect() }));

  let index = rects.length;
  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i]!.rect;
    const middle = vertical ? rect.top + rect.height / 2 : rect.left + rect.width / 2;
    if ((vertical ? y : x) < middle) {
      index = i;
      break;
    }
  }

  const parentRect =
    element.closest<HTMLElement>(`[data-loom-id="${parentId}"]`)?.getBoundingClientRect() ??
    element.getBoundingClientRect();
  const anchor = rects[Math.min(index, rects.length - 1)]?.rect;
  const before = index < rects.length;

  const marker = anchor
    ? vertical
      ? {
          left: parentRect.left,
          top: before ? anchor.top : anchor.bottom,
          length: parentRect.width,
          vertical: false,
        }
      : {
          left: before ? anchor.left : anchor.right,
          top: parentRect.top,
          length: parentRect.height,
          vertical: true,
        }
    : {
        left: parentRect.left,
        top: parentRect.top,
        length: vertical ? parentRect.width : parentRect.height,
        vertical: !vertical,
      };

  return { parentId, index, marker };
}
