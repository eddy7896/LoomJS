import { useCallback, useRef, useState } from 'react';
import type { Id, Snapshot } from '@loom/ir';
import { isFree, moveComponent, moveTo, parentOf } from '../state/store';
import { guidesFor, snapValue, type ChromeState } from './CanvasChrome';
import { resolveDropTarget, type DropTarget } from './dropTarget';

/**
 * Canvas drag = a **tree** operation, not a coordinate one. Layout is flex-first
 * (`docs/specs/layout-model.md`), so dropping a component computes a new parent + index rather
 * than an x/y — dragging is reordering wearing a spatial costume.
 */

export type { DropTarget };

const DRAG_THRESHOLD_PX = 4;

interface DragState {
  componentId: Id;
  startX: number;
  startY: number;
  active: boolean;
  /** Where it sat when the drag began, for a component its parent does not arrange. */
  from: { x: number; y: number } | undefined;
}

export function useDragReorder(
  snapshot: Snapshot,
  rootIds: Set<Id>,
  scale = 1,
  chrome?: ChromeState,
) {
  const drag = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState<Id | undefined>();
  const [target, setTarget] = useState<DropTarget | undefined>();

  const resolveTarget = useCallback(
    (x: number, y: number, moving: Id): DropTarget | undefined =>
      resolveDropTarget(snapshot, x, y, moving),
    [snapshot],
  );

  const onPointerDown = useCallback(
    (componentId: Id, event: React.PointerEvent): void => {
      if (event.button !== 0 || rootIds.has(componentId)) return;
      const parent = parentOf(snapshot, componentId);
      drag.current = {
        componentId,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
        // In a free frame the drag *is* the position, so where it started matters.
        from:
          parent && isFree(snapshot, parent.id)
            ? { ...(snapshot.components[componentId]?.position ?? { x: 0, y: 0 }) }
            : undefined,
      };
    },
    [rootIds],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent): void => {
      const current = drag.current;
      if (!current) return;

      if (!current.active) {
        const distance = Math.hypot(event.clientX - current.startX, event.clientY - current.startY);
        if (distance < DRAG_THRESHOLD_PX) return;
        current.active = true;
        setDragging(current.componentId);
      }

      // A free child follows the pointer as it goes, rather than showing an insertion line for a
      // slot that does not exist.
      if (current.from) {
        const next = {
          x: current.from.x + (event.clientX - current.startX) / scale,
          y: current.from.y + (event.clientY - current.startY) / scale,
        };
        const parent = parentOf(snapshot, current.componentId);
        const guides = parent ? guidesFor(snapshot, parent.id) : { x: [], y: [] };
        moveTo(
          current.componentId,
          chrome
            ? {
                x: snapValue(next.x, guides.x, chrome, scale),
                y: snapValue(next.y, guides.y, chrome, scale),
              }
            : next,
        );
        return;
      }

      setTarget(resolveTarget(event.clientX, event.clientY, current.componentId));
    },
    [chrome, resolveTarget, scale, snapshot],
  );

  const onPointerUp = useCallback((): boolean => {
    const current = drag.current;
    drag.current = null;
    const wasDragging = Boolean(current?.active);

    if (current?.from) {
      setDragging(undefined);
      setTarget(undefined);
      return wasDragging;
    }

    if (current?.active && target) {
      moveComponent(current.componentId, target.parentId, target.index);
    }
    setDragging(undefined);
    setTarget(undefined);
    return wasDragging;
  }, [target]);

  return { dragging, target, onPointerDown, onPointerMove, onPointerUp };
}
