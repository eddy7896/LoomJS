import { useEffect, useState } from 'react';
import type { Artboard, Id } from '@loom/ir';
import { setArtboardGuides } from '../state/store';

/**
 * Rulers, a grid and guides (`docs/12-canvas.md`).
 *
 * These exist because free placement is only as good as what you can line things up against. The
 * grid and the rulers are **editor state** — they are how someone works, not part of the app, and
 * they follow the person rather than the project. Guides are the opposite: a guide is a decision
 * about *this screen's* composition, so it lives in the document beside the screen it belongs to,
 * and is still there tomorrow and for whoever opens it next.
 *
 * None of it emits a single line of CSS.
 */

const STORAGE_KEY = 'loom.canvas.chrome';

export interface ChromeState {
  rulers: boolean;
  grid: boolean;
  /** The grid's step, in the document's own pixels. */
  step: number;
  snap: boolean;
}

const DEFAULTS: ChromeState = { rulers: true, grid: false, step: 8, snap: true };

export function loadChrome(): ChromeState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<ChromeState>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function saveChrome(state: ChromeState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* not worth interrupting anyone over */
  }
}

/** The nearest thing worth landing on: a guide first, then the grid. */
export function snapValue(
  value: number,
  guides: readonly number[],
  chrome: ChromeState,
  scale: number,
): number {
  if (!chrome.snap) return value;

  // Within six screen pixels, so the pull feels the same at any zoom.
  const reach = 6 / scale;
  let best: number | undefined;
  for (const guide of guides) {
    if (Math.abs(guide - value) <= reach) {
      if (best === undefined || Math.abs(guide - value) < Math.abs(best - value)) best = guide;
    }
  }
  if (best !== undefined) return best;

  if (!chrome.grid) return value;
  return Math.round(value / chrome.step) * chrome.step;
}

/**
 * The ruler along one edge, in the document's own pixels.
 *
 * A guide is **dragged out of it** — press on the ruler, pull onto the canvas, let go. That is
 * the gesture every design tool shares, and it is what makes a ruler worth drawing rather than a
 * decoration with numbers on it: you can see where the guide will land before you commit to it.
 */
export function Ruler({
  axis,
  length,
  offset,
  scale,
  artboards,
  onGuide,
  onDrafting,
}: {
  axis: 'x' | 'y';
  length: number;
  /** Where the canvas origin sits on screen, so the numbers match what is under them. */
  offset: number;
  scale: number;
  artboards: { id: Id; left: number; width: number }[];
  onGuide: (axis: 'x' | 'y', at: number) => void;
  /** Where the guide would land, while it is still being dragged out. */
  onDrafting: (axis: 'x' | 'y' | undefined, at: number) => void;
}) {
  // A step that stays readable: 10 document pixels at full zoom, 100 when far out.
  const step = scale > 1.5 ? 10 : scale > 0.6 ? 50 : 100;
  const first = Math.floor(-offset / scale / step) * step;
  const marks: number[] = [];
  for (let at = first; at * scale + offset < length; at += step) marks.push(at);

  return (
    <div
      className={`ruler ruler--${axis}`}
      data-testid={`ruler-${axis}`}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        const box = event.currentTarget.getBoundingClientRect();
        const place = (client: { x: number; y: number }): number =>
          axis === 'x'
            ? (client.x - box.left - offset) / scale
            : (client.y - box.top - offset) / scale;

        onDrafting(axis, Math.round(place({ x: event.clientX, y: event.clientY })));

        const onMove = (move: PointerEvent): void => {
          onDrafting(axis, Math.round(place({ x: move.clientX, y: move.clientY })));
        };
        const onUp = (up: PointerEvent): void => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          onDrafting(undefined, 0);
          // Let go still on the ruler and nothing is dropped: that is how a gesture is called off.
          const onRuler =
            axis === 'x' ? up.clientY < box.bottom : up.clientX < box.right;
          if (!onRuler) onGuide(axis, Math.round(place({ x: up.clientX, y: up.clientY })));
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      }}
    >
      {marks.map((mark) => (
        <span
          key={mark}
          className="ruler__mark"
          style={axis === 'x' ? { left: mark * scale + offset } : { top: mark * scale + offset }}
        >
          {mark}
        </span>
      ))}
      {/* Where each screen starts, so a number on the ruler means something in the screen. */}
      {axis === 'x'
        ? artboards.map((board) => (
            <span
              key={board.id}
              className="ruler__span"
              style={{ left: board.left * scale + offset, width: board.width * scale }}
            />
          ))
        : null}
    </div>
  );
}

/** The guides on one screen, drawn over it and draggable. */
export function Guides({
  artboard,
  width,
  height,
  scale,
}: {
  artboard: Artboard;
  width: number;
  height: number;
  scale: number;
}) {
  const guides = artboard.guides ?? { x: [], y: [] };
  const [dragging, setDragging] = useState<{ axis: 'x' | 'y'; index: number } | null>(null);

  useEffect(() => {
    if (!dragging) return;

    const onMove = (event: PointerEvent): void => {
      const node = document.querySelector<HTMLElement>(`[data-guides="${artboard.id}"]`);
      if (!node) return;
      const box = node.getBoundingClientRect();
      const at =
        dragging.axis === 'x'
          ? (event.clientX - box.left) / scale
          : (event.clientY - box.top) / scale;
      const next = { x: [...guides.x], y: [...guides.y] };
      next[dragging.axis][dragging.index] = Math.round(at);
      setArtboardGuides(artboard.id, next);
    };

    const onUp = (event: PointerEvent): void => {
      setDragging(null);
      // Dragged off the screen: the way to get rid of a guide everywhere else, and here too.
      const node = document.querySelector<HTMLElement>(`[data-guides="${artboard.id}"]`);
      const box = node?.getBoundingClientRect();
      if (!box) return;
      const outside =
        event.clientX < box.left - 24 ||
        event.clientX > box.right + 24 ||
        event.clientY < box.top - 24 ||
        event.clientY > box.bottom + 24;
      if (!outside) return;
      const next = { x: [...guides.x], y: [...guides.y] };
      next[dragging.axis].splice(dragging.index, 1);
      setArtboardGuides(artboard.id, next);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [artboard.id, dragging, guides.x, guides.y, scale]);

  if (guides.x.length === 0 && guides.y.length === 0) return null;

  return (
    <div className="guides" data-guides={artboard.id} data-testid={`guides-${artboard.id}`}>
      {guides.x.map((at, index) => (
        <span
          key={`x${index}`}
          className="guide guide--x"
          style={{ left: at, height }}
          onPointerDown={(event) => {
            event.stopPropagation();
            setDragging({ axis: 'x', index });
          }}
        />
      ))}
      {guides.y.map((at, index) => (
        <span
          key={`y${index}`}
          className="guide guide--y"
          style={{ top: at, width }}
          onPointerDown={(event) => {
            event.stopPropagation();
            setDragging({ axis: 'y', index });
          }}
        />
      ))}
    </div>
  );
}

/**
 * The guides a point should be pulled towards, given the frame it is being placed in.
 *
 * A guide is drawn in the **screen's** pixels, so it only lines up with a child of that screen.
 * Inside a nested frame the grid still applies and the guides do not — a guide that pulled to the
 * wrong place would be worse than one that stays out of the way.
 */
export function guidesFor(
  snapshot: { artboards: Record<string, Artboard>; components: Record<string, unknown> },
  parentId: Id,
): { x: number[]; y: number[] } {
  const artboard = Object.values(snapshot.artboards).find((board) => board.root === parentId);
  return { x: [...(artboard?.guides?.x ?? [])], y: [...(artboard?.guides?.y ?? [])] };
}
