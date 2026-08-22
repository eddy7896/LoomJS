import { useCallback, useRef, useState } from 'react';
import type { Snapshot } from '@loom/ir';
import { screenPreset } from '@loom/components';
import { placeComponent, placeScreen, setTool, toolPlaces, type Tool } from '../state/store';
import { resolveDropTarget, type DropTarget } from './dropTarget';

/**
 * Draw to place (`docs/12-canvas.md` C2): press, drag, release, and the element exists at the
 * size it was drawn, in the slot the drop point implies.
 *
 * The rubber band is the only place in the editor that thinks in pixels, and it dies on release:
 * what survives is a parent, an index and a size.
 */

/** Below this, the gesture was a click, and a click means "the natural size". */
const DRAW_THRESHOLD_PX = 8;

export interface DrawState {
  /** The rubber band, in viewport px. */
  rect: { left: number; top: number; width: number; height: number };
  target: DropTarget | undefined;
}

export function useDrawPlace(snapshot: Snapshot, tool: Tool, scale: number) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const [draw, setDraw] = useState<DrawState | undefined>();

  const onPointerDown = useCallback(
    (event: React.PointerEvent): boolean => {
      const places = toolPlaces(tool);
      if (event.button !== 0 || !places) return false;

      // Inside a screen, a gesture places an element. Outside one, only a Frame means anything —
      // and it means a new screen, because a screen is a frame with a route.
      const inside = (event.target as HTMLElement).closest('[data-loom-id]');
      if (!inside && places.type !== 'Frame') return false;

      start.current = { x: event.clientX, y: event.clientY };
      setDraw({
        rect: { left: event.clientX, top: event.clientY, width: 0, height: 0 },
        target: resolveDropTarget(snapshot, event.clientX, event.clientY),
      });
      return true;
    },
    [snapshot, tool],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent): void => {
      const from = start.current;
      if (!from) return;
      setDraw({
        rect: {
          left: Math.min(from.x, event.clientX),
          top: Math.min(from.y, event.clientY),
          width: Math.abs(event.clientX - from.x),
          height: Math.abs(event.clientY - from.y),
        },
        // The slot comes from where the gesture **started**, so a rectangle dragged out to the
        // right does not land somewhere else halfway through drawing it.
        target: resolveDropTarget(snapshot, from.x, from.y),
      });
    },
    [snapshot],
  );

  const onPointerUp = useCallback((): boolean => {
    const from = start.current;
    start.current = null;
    if (!from || !draw) return false;

    setDraw(undefined);
    const places = toolPlaces(tool);
    // The pointer comes back on its own, the way every design tool behaves.
    setTool('move');
    if (!places) return false;

    const drawn =
      draw.rect.width >= DRAW_THRESHOLD_PX && draw.rect.height >= DRAW_THRESHOLD_PX
        ? // Divide by the zoom, or a shape drawn at 50% comes out twice the size it looked.
          { width: draw.rect.width / scale, height: draw.rect.height / scale }
        : undefined;

    // Nothing under the gesture: a frame drawn on the open canvas is a new screen.
    if (!draw.target) {
      if (places.type !== 'Frame') return false;
      const preset = screenPreset(places.variant);
      placeScreen(
        preset
          ? { width: preset.width, height: preset.height, preset: preset.id }
          : drawn ?? undefined,
      );
      return true;
    }

    placeComponent(places.type, draw.target.parentId, draw.target.index, {
      variant: places.variant,
      ...(drawn ? { size: drawn } : {}),
    });
    return true;
  }, [draw, scale, tool]);

  return { draw, onPointerDown, onPointerMove, onPointerUp };
}
