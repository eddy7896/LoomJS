import { useCallback, useRef, useState } from 'react';
import type { Id, Snapshot } from '@loom/ir';
import { moveComponent } from '../state/store';
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
}

export function useDragReorder(snapshot: Snapshot, rootIds: Set<Id>) {
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
      drag.current = {
        componentId,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
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

      setTarget(resolveTarget(event.clientX, event.clientY, current.componentId));
    },
    [resolveTarget],
  );

  const onPointerUp = useCallback((): boolean => {
    const current = drag.current;
    drag.current = null;
    const wasDragging = Boolean(current?.active);

    if (current?.active && target) {
      moveComponent(current.componentId, target.parentId, target.index);
    }
    setDragging(undefined);
    setTarget(undefined);
    return wasDragging;
  }, [target]);

  return { dragging, target, onPointerDown, onPointerMove, onPointerUp };
}
