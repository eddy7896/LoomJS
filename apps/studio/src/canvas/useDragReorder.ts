import { useCallback, useRef, useState } from 'react';
import type { Id, Snapshot } from '@loom/ir';
import { defFor } from '@loom/components';
import { moveComponent } from '../state/store';

/**
 * Canvas drag = a **tree** operation, not a coordinate one. Layout is flex-first
 * (`docs/specs/layout-model.md`), so dropping a component computes a new parent + index rather
 * than an x/y — dragging is reordering wearing a spatial costume.
 */

export interface DropTarget {
  parentId: Id;
  index: number;
  /** Where to draw the insertion line, in viewport px. */
  marker: { left: number; top: number; length: number; vertical: boolean };
}

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

  const isContainer = useCallback(
    (id: Id): boolean => {
      const component = snapshot.components[id];
      return Boolean(component && defFor(component.type)?.isContainer);
    },
    [snapshot],
  );

  /** True when `ancestorId` is at or above `id` — dropping into your own subtree is illegal. */
  const contains = useCallback(
    (ancestorId: Id, id: Id): boolean => {
      if (ancestorId === id) return true;
      const children = snapshot.components[ancestorId]?.children ?? [];
      return children.some((child) => contains(child, id));
    },
    [snapshot],
  );

  const resolveTarget = useCallback(
    (x: number, y: number, moving: Id): DropTarget | undefined => {
      const stack = document.elementsFromPoint(x, y);
      const element = stack.find((node): node is HTMLElement => {
        const id = (node as HTMLElement).dataset?.loomId;
        return Boolean(id && !contains(moving, id));
      });
      if (!element) return undefined;

      const hovered = element.dataset.loomId!;
      const parentId = isContainer(hovered) ? hovered : findParent(snapshot, hovered);
      if (!parentId || contains(moving, parentId)) return undefined;

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

      const parentRect = element.closest<HTMLElement>(`[data-loom-id="${parentId}"]`)
        ?.getBoundingClientRect() ?? element.getBoundingClientRect();
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
    },
    [contains, isContainer, snapshot],
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

function findParent(snapshot: Snapshot, id: Id): Id | undefined {
  return Object.values(snapshot.components).find((c) => c.children?.includes(id))?.id;
}
