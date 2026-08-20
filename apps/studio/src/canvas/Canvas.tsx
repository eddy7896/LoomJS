import { useCallback, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import type { Id } from '@loom/ir';
import { useEditor } from '../state/useEditor';
import {
  entryArtboardId,
  select,
  selectComponent,
  setActiveArtboard,
  type Selection,
} from '../state/store';
import { ComponentView } from './ComponentView';
import { SelectionOverlay } from './SelectionOverlay';
import { FlowArrows, type ArtboardBox } from './FlowArrows';
import { useDragReorder } from './useDragReorder';

const MIN_SCALE = 0.25;
const MAX_SCALE = 2.5;
const ARTBOARD_WIDTH = 720;
const ARTBOARD_MIN_HEIGHT = 480;
const ARTBOARD_GAP = 120;

/**
 * The Design canvas: artboards are DOM behind a pan/zoom transform (docs/09 risk register —
 * this is DOM + overlay, deliberately not konva, because the artboard renders real React).
 * Artboards sit side by side and the flow arrows between them are the app's routes.
 */
export function Canvas() {
  const snapshot = useEditor((s) => s.snapshot);
  const selection = useEditor((s) => s.selection);
  const activeArtboardId = useEditor((s) => s.activeArtboardId);

  const [scale, setScale] = useState(0.8);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panning = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);

  const layerRef = useRef<HTMLDivElement | null>(null);
  const nodes = useRef(new Map<Id, HTMLElement>());
  const artboardRefs = useRef(new Map<Id, HTMLElement>());

  const artboards = useMemo(
    () => Object.values(snapshot.artboards).sort((a, b) => a.id.localeCompare(b.id)),
    [snapshot.artboards],
  );

  const rootIds = useMemo(() => new Set(artboards.map((a) => a.root)), [artboards]);
  const dragReorder = useDragReorder(snapshot, rootIds);

  const registerNode = useCallback((id: Id, node: HTMLElement | null): void => {
    if (node) nodes.current.set(id, node);
    else nodes.current.delete(id);
  }, []);

  // Artboards are laid out in a row by the canvas itself; the boxes feed the arrow layer.
  const boxes = useMemo(() => {
    const map = new Map<Id, ArtboardBox>();
    artboards.forEach((artboard, index) => {
      const node = artboardRefs.current.get(artboard.id);
      map.set(artboard.id, {
        id: artboard.id,
        x: index * (ARTBOARD_WIDTH + ARTBOARD_GAP),
        y: 0,
        width: ARTBOARD_WIDTH,
        height: node?.offsetHeight ?? ARTBOARD_MIN_HEIGHT,
      });
    });
    return map;
  }, [artboards, snapshot]);

  const onWheel = (event: WheelEvent<HTMLDivElement>): void => {
    if (event.ctrlKey || event.metaKey) {
      setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s * (1 - event.deltaY / 500))));
      return;
    }
    setPan((p) => ({ x: p.x - event.deltaX, y: p.y - event.deltaY }));
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 1 && !(event.button === 0 && event.target === event.currentTarget)) return;
    panning.current = { x: pan.x, y: pan.y, startX: event.clientX, startY: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    dragReorder.onPointerMove(event);
    const drag = panning.current;
    if (!drag) return;
    setPan({ x: drag.x + (event.clientX - drag.startX), y: drag.y + (event.clientY - drag.startY) });
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    const reordered = dragReorder.onPointerUp();
    const drag = panning.current;
    panning.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const moved = drag && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 3;
    if (!moved && !reordered && event.target === event.currentTarget) select(undefined);
  };

  const selectedComponentId = selection?.kind === 'component' ? selection.id : undefined;
  const selectedComponent = selectedComponentId ? snapshot.components[selectedComponentId] : undefined;
  const entryId = entryArtboardId(snapshot);

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
        <FlowArrows
          snapshot={snapshot}
          boxes={boxes}
          selectedFlowId={selection?.kind === 'flow' ? selection.id : undefined}
          onSelect={(flowId) => select({ kind: 'flow', id: flowId } as Selection)}
        />

        {artboards.map((artboard, index) => (
          <div
            key={artboard.id}
            className={`artboard-slot ${activeArtboardId === artboard.id ? 'is-active' : ''}`}
            style={{ left: index * (ARTBOARD_WIDTH + ARTBOARD_GAP), width: ARTBOARD_WIDTH }}
          >
            <div className="artboard__label" onClick={() => setActiveArtboard(artboard.id)}>
              {artboard.name}
              {artboard.id === entryId ? <span className="chip">entry</span> : null}
              {(artboard.params ?? []).length > 0 ? (
                <span className="chip chip--mono">
                  {(artboard.params ?? []).map((p) => `:${p.name}`).join(' ')}
                </span>
              ) : null}
            </div>
            <div
              className="artboard"
              ref={(node) => {
                if (node) artboardRefs.current.set(artboard.id, node);
                else artboardRefs.current.delete(artboard.id);
              }}
              style={{ minHeight: ARTBOARD_MIN_HEIGHT }}
              onClick={() => setActiveArtboard(artboard.id)}
            >
              <ComponentView
                snapshot={snapshot}
                id={artboard.root}
                onSelect={selectComponent}
                registerNode={registerNode}
                onPointerDown={dragReorder.onPointerDown}
                draggingId={dragReorder.dragging}
              />
            </div>
          </div>
        ))}

        {selectedComponent ? (
          <SelectionOverlay
            id={selectedComponent.id}
            target={nodes.current.get(selectedComponent.id)}
            container={layerRef.current}
            deps={snapshot}
            scale={scale}
            label={selectedComponent.name ?? selectedComponent.type}
            variant="selected"
          />
        ) : null}
      </div>

      {dragReorder.target ? (
        <div
          className="drop-marker"
          style={
            dragReorder.target.marker.vertical
              ? {
                  left: dragReorder.target.marker.left,
                  top: dragReorder.target.marker.top,
                  width: 2,
                  height: dragReorder.target.marker.length,
                }
              : {
                  left: dragReorder.target.marker.left,
                  top: dragReorder.target.marker.top,
                  width: dragReorder.target.marker.length,
                  height: 2,
                }
          }
        />
      ) : null}

      <div className="canvas__zoom">
        <button onClick={() => setScale((s) => Math.max(MIN_SCALE, s - 0.1))}>−</button>
        <span>{Math.round(scale * 100)}%</span>
        <button onClick={() => setScale((s) => Math.min(MAX_SCALE, s + 0.1))}>+</button>
        <button
          onClick={() => {
            setScale(0.8);
            setPan({ x: 0, y: 0 });
          }}
        >
          Reset
        </button>
      </div>
    </div>
  );
}
