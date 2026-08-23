import type { Snapshot } from '@loom/ir';
import { placeComponent } from '../state/store';
import { resolveDropTarget, type DropTarget } from './dropTarget';

/**
 * Dragging something out of the palette and onto the artboard (`docs/19-sign-in-elements.md`).
 *
 * Clicking an element in the palette drops it wherever the selection happens to be, which is fine
 * for the first element on a screen and wrong for the fourth. Dragging says *where*, and it is the
 * gesture a designer already has in their hands from every other tool.
 *
 * The drop lands through the same `resolveDropTarget` a drawn element and a reordered layer use.
 * There is one idea of where a point is in the tree, and this is not a second one.
 */

/** The payload a palette drag carries. Loom-specific, so a file dragged in is not mistaken for one. */
export const PALETTE_MIME = 'application/x-loom-element';

export interface PaletteDrag {
  type: string;
  /** A Shape's shape, or a Frame's screen size. */
  variant?: string;
  /** The provider a sign-in button asks for, which is what makes it a sign-in button. */
  signInWith?: string;
}

export function startPaletteDrag(event: React.DragEvent, payload: PaletteDrag): void {
  event.dataTransfer.effectAllowed = 'copy';
  event.dataTransfer.setData(PALETTE_MIME, JSON.stringify(payload));
  // Some browsers refuse a drag with no plain-text payload; the label is also what a drag into a
  // text editor would sensibly leave behind.
  event.dataTransfer.setData('text/plain', payload.type);
}

export function readPaletteDrag(event: React.DragEvent): PaletteDrag | undefined {
  const raw = event.dataTransfer.getData(PALETTE_MIME);
  if (!raw) return undefined;
  try {
    const payload = JSON.parse(raw) as PaletteDrag;
    return typeof payload.type === 'string' ? payload : undefined;
  } catch {
    return undefined;
  }
}

/** True when this drag is one of ours — a file or a selection dragged in is not. */
export function isPaletteDrag(event: React.DragEvent): boolean {
  return event.dataTransfer.types.includes(PALETTE_MIME);
}

/** Where a palette drag would land, for the insertion marker to draw. */
export function paletteDropTarget(
  snapshot: Snapshot,
  event: React.DragEvent,
): DropTarget | undefined {
  return resolveDropTarget(snapshot, event.clientX, event.clientY);
}

/**
 * A viewport point as a place inside a parent, in the document's own pixels.
 *
 * The same arithmetic drawing uses: divide by the zoom, or something dropped at 50% lands twice as
 * far in as it looked.
 */
export function pointInside(
  parentId: string,
  point: { x: number; y: number },
  scale: number,
): { x: number; y: number } | undefined {
  const node = document.querySelector<HTMLElement>(`[data-loom-id="${parentId}"]`);
  if (!node) return undefined;
  const box = node.getBoundingClientRect();
  return { x: (point.x - box.left) / scale, y: (point.y - box.top) / scale };
}

/** Drop what the palette was carrying. Returns the new component, or nothing when it missed. */
export function dropFromPalette(
  snapshot: Snapshot,
  event: React.DragEvent,
  scale: number,
  isFree: (parentId: string) => boolean,
): string | undefined {
  const payload = readPaletteDrag(event);
  const target = paletteDropTarget(snapshot, event);
  if (!payload || !target) return undefined;

  // Inside a free frame the drop point becomes the child's own place; a stacked frame owns the
  // arrangement, so the point only decides which slot it lands in.
  const position = isFree(target.parentId)
    ? pointInside(target.parentId, { x: event.clientX, y: event.clientY }, scale)
    : undefined;

  return placeComponent(payload.type, target.parentId, target.index, {
    ...(payload.variant ? { variant: payload.variant } : {}),
    ...(payload.signInWith ? { signInWith: payload.signInWith } : {}),
    ...(position ? { position } : {}),
  });
}
