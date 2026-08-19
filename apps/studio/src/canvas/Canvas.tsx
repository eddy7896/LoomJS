import { useCallback, useRef, useState, type WheelEvent } from 'react';
import type { Id } from '@loom/ir';
import { useEditor } from '../state/useEditor';
import { entryArtboardId, select } from '../state/store';
import { ComponentView } from './ComponentView';
import { SelectionOverlay } from './SelectionOverlay';

const MIN_SCALE = 0.25;
const MAX_SCALE = 2.5;
const ARTBOARD_WIDTH = 1024;
const ARTBOARD_MIN_HEIGHT = 640;

/**
 * The Design canvas: artboards are DOM behind a pan/zoom transform (docs/09 risk register —
 * this is DOM + overlay, deliberately not konva, because the artboard renders real React).
 */
export function Canvas() {
  const snapshot = useEditor((s) => s.snapshot);
  const selectedId = useEditor((s) => s.selectedId);

  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panning = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);

  const layerRef = useRef<HTMLDivElement | null>(null);
  const nodes = useRef(new Map<Id, HTMLElement>());

  const registerNode = useCallback((id: Id, node: HTMLElement | null): void => {
    if (node) nodes.current.set(id, node);
    else nodes.current.delete(id);
  }, []);

  const artboardId = entryArtboardId(snapshot);
  const artboard = snapshot.artboards[artboardId];

  const onWheel = (event: WheelEvent<HTMLDivElement>): void => {
    if (event.ctrlKey || event.metaKey) {
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * (1 - event.deltaY / 500)));
      setScale(next);
      return;
    }
    setPan((p) => ({ x: p.x - event.deltaX, y: p.y - event.deltaY }));
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    // Middle-drag or space-less empty-space drag pans; a click on empty space clears selection.
    if (event.button !== 1 && !(event.button === 0 && event.target === event.currentTarget)) return;
    panning.current = { x: pan.x, y: pan.y, startX: event.clientX, startY: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = panning.current;
    if (!drag) return;
    setPan({ x: drag.x + (event.clientX - drag.startX), y: drag.y + (event.clientY - drag.startY) });
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = panning.current;
    panning.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const moved = drag && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 3;
    if (!moved && event.target === event.currentTarget) select(undefined);
  };

  if (!artboard) return <div className="canvas canvas--empty">No artboard</div>;

  const selected = selectedId ? snapshot.components[selectedId] : undefined;

  return (
    <div
      className="canvas"
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div
        className="canvas__layer"
        ref={layerRef}
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}
      >
        <div className="artboard__label">{artboard.name}</div>
        <div
          className="artboard"
          style={{ width: ARTBOARD_WIDTH, minHeight: ARTBOARD_MIN_HEIGHT }}
          onClick={() => select(undefined)}
        >
          <ComponentView
            snapshot={snapshot}
            id={artboard.root}
            selectedId={selectedId}
            onSelect={(id) => select(id)}
            registerNode={registerNode}
          />
        </div>

        {selected ? (
          <SelectionOverlay
            id={selected.id}
            target={nodes.current.get(selected.id)}
            container={layerRef.current}
            deps={snapshot}
            scale={scale}
            label={selected.name ?? selected.type}
            variant="selected"
          />
        ) : null}
      </div>

      <div className="canvas__zoom">
        <button onClick={() => setScale((s) => Math.max(MIN_SCALE, s - 0.1))}>−</button>
        <span>{Math.round(scale * 100)}%</span>
        <button onClick={() => setScale((s) => Math.min(MAX_SCALE, s + 0.1))}>+</button>
        <button
          onClick={() => {
            setScale(1);
            setPan({ x: 0, y: 0 });
          }}
        >
          Reset
        </button>
      </div>
    </div>
  );
}
