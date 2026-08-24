import { useLayoutEffect, useState } from 'react';
import type { Id, Snapshot } from '@loom/ir';
import { endGesture, isFree, parentOf, resizeTo } from '../state/store';
import { guidesFor, snapValue, type ChromeState } from './CanvasChrome';

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Props {
  target: HTMLElement | null | undefined;
  container: HTMLElement | null;
  /** Any value whose change should re-measure (zoom, pan, document version). */
  deps: unknown;
  label: string;
  variant: 'selected' | 'hovered';
  /** Canvas zoom: rects are measured in screen px and divided back into layer px. */
  scale: number;
  id: Id;
  /** Present on the selected component, which is the only one you can resize by dragging. */
  resize?: { snapshot: Snapshot; chrome: ChromeState };
}

/** The eight places a box can be taken hold of, and what each one moves. */
const HANDLES = [
  { at: 'nw', x: 0, y: 0, dx: -1, dy: -1, cursor: 'nwse-resize' },
  { at: 'n', x: 0.5, y: 0, dx: 0, dy: -1, cursor: 'ns-resize' },
  { at: 'ne', x: 1, y: 0, dx: 1, dy: -1, cursor: 'nesw-resize' },
  { at: 'e', x: 1, y: 0.5, dx: 1, dy: 0, cursor: 'ew-resize' },
  { at: 'se', x: 1, y: 1, dx: 1, dy: 1, cursor: 'nwse-resize' },
  { at: 's', x: 0.5, y: 1, dx: 0, dy: 1, cursor: 'ns-resize' },
  { at: 'sw', x: 0, y: 1, dx: -1, dy: 1, cursor: 'nesw-resize' },
  { at: 'w', x: 0, y: 0.5, dx: -1, dy: 0, cursor: 'ew-resize' },
] as const;

/**
 * The selection chrome floats above the artboard rather than styling the component itself —
 * a border on the real node would change its layout and lie about what the app looks like.
 */
export function SelectionOverlay({
  target,
  container,
  deps,
  label,
  variant,
  scale,
  id,
  resize,
}: Props) {
  const [rect, setRect] = useState<Rect | undefined>();

  useLayoutEffect(() => {
    if (!target || !container) {
      setRect(undefined);
      return;
    }
    const measure = (): void => {
      const box = target.getBoundingClientRect();
      const base = container.getBoundingClientRect();
      setRect({
        left: (box.left - base.left) / scale,
        top: (box.top - base.top) / scale,
        width: box.width / scale,
        height: box.height / scale,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    observer.observe(container);
    return () => observer.disconnect();
  }, [target, container, deps, scale]);

  if (!rect) return null;

  const selected = variant === 'selected';

  /**
   * Dragging a handle.
   *
   * The gesture reads in screen pixels and writes in the document's, and it writes a **fixed
   * size** — which is what "I made it this big" means. A handle on the top or left edge also
   * moves the box, because those edges cannot move without the origin moving with them; in a
   * frame that arranges its own children there is no origin to move, so only the size changes.
   */
  const grab = (event: React.PointerEvent, handle: (typeof HANDLES)[number]): void => {
    if (!resize || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const start = { x: event.clientX, y: event.clientY };
    const from = { ...rect };
    const parent = parentOf(resize.snapshot, id);
    const free = parent ? isFree(resize.snapshot, parent.id) : false;
    const guides = parent ? guidesFor(resize.snapshot, parent.id) : { x: [], y: [] };

    const onMove = (move: PointerEvent): void => {
      const dx = (move.clientX - start.x) / scale;
      const dy = (move.clientY - start.y) / scale;

      // Each edge that moved lands on a guide or the grid, so a resize lines up like a move does.
      let { left, top, width, height } = from;
      if (handle.dx > 0) width = snapValue(from.left + from.width + dx, guides.x, resize.chrome, scale) - from.left;
      if (handle.dx < 0) {
        const edge = snapValue(from.left + dx, guides.x, resize.chrome, scale);
        width = from.left + from.width - edge;
        left = edge;
      }
      if (handle.dy > 0) height = snapValue(from.top + from.height + dy, guides.y, resize.chrome, scale) - from.top;
      if (handle.dy < 0) {
        const edge = snapValue(from.top + dy, guides.y, resize.chrome, scale);
        height = from.top + from.height - edge;
        top = edge;
      }

      const moved = free && (handle.dx < 0 || handle.dy < 0);
      const origin = resize.snapshot.components[id]?.position ?? { x: 0, y: 0 };
      resizeTo(
        id,
        { width, height },
        moved
          ? { x: origin.x + (left - from.left), y: origin.y + (top - from.top) }
          : undefined,
      );
    };

    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      endGesture();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div
      className={`overlay overlay--${variant}`}
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
    >
      {selected ? <span className="overlay__label">{label}</span> : null}
      {selected && resize
        ? HANDLES.map((handle) => (
            <span
              key={handle.at}
              className={`overlay__handle overlay__handle--${handle.at}`}
              data-testid={`resize-${handle.at}`}
              style={{
                left: `${handle.x * 100}%`,
                top: `${handle.y * 100}%`,
                cursor: handle.cursor,
                // Handles keep their size on screen however far out the canvas is zoomed.
                transform: `translate(-50%, -50%) scale(${1 / scale})`,
              }}
              onPointerDown={(event) => grab(event, handle)}
            />
          ))
        : null}
    </div>
  );
}
