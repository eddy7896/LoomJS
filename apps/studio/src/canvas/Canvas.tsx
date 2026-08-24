import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent,
} from 'react';
import type { Id, ScreenSize } from '@loom/ir';
import { DEFAULT_SCREEN, presetForSize } from '@loom/components';
import { themeStyle } from '@loom/ui';
import { useVariantStylesheet } from './useVariantStylesheet';
import { useEditor } from '../state/useEditor';
import {
  isFree,
  entryArtboardId,
  select,
  selectComponent,
  setActiveArtboard,
  setArtboardGuides,
  setArtboardSize,
  type Selection,
} from '../state/store';
import { CanvasToolbar } from './CanvasToolbar';
import { Guides, loadChrome, Ruler, saveChrome, type ChromeState } from './CanvasChrome';
import { useDrawPlace } from './useDrawPlace';
import { dropFromPalette, isPaletteDrag, paletteDropTarget } from './paletteDrag';
import type { DropTarget } from './dropTarget';
import { ComponentView } from './ComponentView';
import { SelectionOverlay } from './SelectionOverlay';
import { FlowArrows, type ArtboardBox } from './FlowArrows';
import { useDragReorder } from './useDragReorder';

const MIN_SCALE = 0.25;
const MAX_SCALE = 2.5;
const ARTBOARD_GAP = 120;
/** Small enough to still be a screen, large enough to still be grabbable at low zoom. */
const MIN_SCREEN = { width: 240, height: 240 };

/**
 * The Design canvas: artboards are DOM behind a pan/zoom transform (docs/09 risk register —
 * this is DOM + overlay, deliberately not konva, because the artboard renders real React).
 * Artboards sit side by side and the flow arrows between them are the app's routes.
 */
export function Canvas() {
  // The variants the elements below are painted with, from the same string the project gets.
  useVariantStylesheet();

  const snapshot = useEditor((s) => s.snapshot);
  const hiddenInEditor = useEditor((s) => s.hiddenInEditor);
  const alsoSelected = useEditor((s) => s.also);
  const selection = useEditor((s) => s.selection);
  const activeArtboardId = useEditor((s) => s.activeArtboardId);
  const tool = useEditor((s) => s.tool);

  const [scale, setScale] = useState(0.8);
  // How this person works, not what the project is: rulers and a grid follow the designer
  // (`docs/12-canvas.md`).
  const [chrome, setChrome] = useState<ChromeState>(loadChrome);
  /** The guide being pulled out of a ruler, drawn until it is let go of. */
  const [draft, setDraft] = useState<{ axis: 'x' | 'y'; at: number } | undefined>();
  const setChromeState = (patch: Partial<ChromeState>): void => {
    setChrome((current) => {
      const next = { ...current, ...patch };
      saveChrome(next);
      return next;
    });
  };
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panning = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);

  const layerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  /**
   * The canvas's own size, for the rulers to draw against.
   *
   * A callback ref that measured inline would be a new function every render, so React would
   * re-attach it every render and the measurement would set state forever.
   */
  const watcher = useRef<ResizeObserver | null>(null);
  const canvasRef = useCallback((node: HTMLDivElement | null) => {
    watcher.current?.disconnect();
    watcher.current = null;
    if (!node) return;

    setSize({ width: node.clientWidth, height: node.clientHeight });
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(node);
    watcher.current = observer;
  }, []);
  const nodes = useRef(new Map<Id, HTMLElement>());
  const artboardRefs = useRef(new Map<Id, HTMLElement>());

  const artboards = useMemo(
    () => Object.values(snapshot.artboards).sort((a, b) => a.id.localeCompare(b.id)),
    [snapshot.artboards],
  );

  /** The size being dragged, held locally so a resize is one undo step rather than sixty. */
  const [resizing, setResizing] = useState<{ id: Id; width: number; height: number } | null>(null);

  const sizeOf = useCallback(
    (artboard: { id: Id; size?: ScreenSize }): { width: number; height: number } => {
      if (resizing?.id === artboard.id) return { width: resizing.width, height: resizing.height };
      return artboard.size ?? { width: DEFAULT_SCREEN.width, height: DEFAULT_SCREEN.height };
    },
    [resizing],
  );

  /** Where each artboard starts, accumulated so screens of different widths still sit in a row. */
  const offsets = useMemo(() => {
    const map = new Map<Id, number>();
    let x = 0;
    for (const artboard of artboards) {
      map.set(artboard.id, x);
      x += sizeOf(artboard).width + ARTBOARD_GAP;
    }
    return map;
  }, [artboards, sizeOf]);

  const rootIds = useMemo(() => new Set(artboards.map((a) => a.root)), [artboards]);
  const dragReorder = useDragReorder(snapshot, rootIds, scale, chrome);
  // With a tool armed, a press draws instead of selecting (`docs/12-canvas.md` C2).
  const drawPlace = useDrawPlace(snapshot, tool, scale, chrome);
  // Where a palette drag would land, so the same insertion line a reorder draws is drawn here.
  const [paletteTarget, setPaletteTarget] = useState<DropTarget | undefined>();

  /**
   * The DOM node behind each component, for the selection chrome to measure.
   *
   * Writing a ref does not re-render, so the overlay used to draw only if something else happened
   * to re-render right after the node arrived — and when nothing did, a freshly drawn component
   * had no handles at all. The counter is what turns "the node is here now" into a render.
   */
  const [attached, setAttached] = useState(0);
  const registerNode = useCallback((id: Id, node: HTMLElement | null): void => {
    const had = nodes.current.get(id);
    if (node) nodes.current.set(id, node);
    else nodes.current.delete(id);
    if (had !== node) setAttached((count) => count + 1);
  }, []);

  // Artboards are laid out in a row by the canvas itself; the boxes feed the arrow layer.
  const boxes = useMemo(() => {
    const map = new Map<Id, ArtboardBox>();
    artboards.forEach((artboard) => {
      const node = artboardRefs.current.get(artboard.id);
      const size = sizeOf(artboard);
      map.set(artboard.id, {
        id: artboard.id,
        x: offsets.get(artboard.id) ?? 0,
        y: 0,
        width: size.width,
        // The frame is a minimum: content taller than the screen grows the artboard rather than
        // being clipped, because a designer needs to see what they built.
        height: Math.max(node?.offsetHeight ?? 0, size.height),
      });
    });
    return map;
  }, [artboards, snapshot, offsets, sizeOf]);

  /**
   * Dragged out of a ruler: the guide lands on the screen it was dropped over, in that screen's
   * own pixels — a guide belongs to a composition, not to the infinite space between screens.
   */
  const addGuide = (axis: 'x' | 'y', at: number): void => {
    const artboard = snapshot.artboards[activeArtboardId];
    if (!artboard) return;
    const guides = artboard.guides ?? { x: [], y: [] };
    const local = axis === 'x' ? at - (offsets.get(artboard.id) ?? 0) : at;
    setArtboardGuides(artboard.id, {
      x: axis === 'x' ? [...guides.x, Math.round(local)] : [...guides.x],
      y: axis === 'y' ? [...guides.y, Math.round(local)] : [...guides.y],
    });
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>): void => {
    if (event.ctrlKey || event.metaKey) {
      setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s * (1 - event.deltaY / 500))));
      return;
    }
    setPan((p) => ({ x: p.x - event.deltaX, y: p.y - event.deltaY }));
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (drawPlace.onPointerDown(event)) {
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button !== 1 && !(event.button === 0 && event.target === event.currentTarget)) return;
    panning.current = { x: pan.x, y: pan.y, startX: event.clientX, startY: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    drawPlace.onPointerMove(event);
    dragReorder.onPointerMove(event);
    const drag = panning.current;
    if (!drag) return;
    setPan({ x: drag.x + (event.clientX - drag.startX), y: drag.y + (event.clientY - drag.startY) });
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId) && drawPlace.draw) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (drawPlace.onPointerUp()) return;
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
      ref={canvasRef}
      className={`canvas ${tool === 'move' ? '' : 'canvas--drawing'} ${
        chrome.rulers ? 'has-rulers' : ''
      }`}
      onWheel={onWheel}
      // Dropping an element from the palette (`docs/19-sign-in-elements.md`). Only ours: a file
      // or a selection dragged in from elsewhere is left to the browser.
      onDragOver={(event) => {
        if (!isPaletteDrag(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        setPaletteTarget(paletteDropTarget(snapshot, event));
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setPaletteTarget(undefined);
      }}
      onDrop={(event) => {
        if (!isPaletteDrag(event)) return;
        event.preventDefault();
        setPaletteTarget(undefined);
        dropFromPalette(snapshot, event, scale, (parentId) => isFree(snapshot, parentId));
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div
        className="canvas__layer"
        ref={layerRef}
        // The project's tokens are defined here, so the artboards below resolve the same
        // `var(--loom-…)` the emitted app does. Without them the canvas would draw unstyled
        // boxes and quietly disagree with the Preview.
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
          ...themeStyle(snapshot.theme),
        }}
      >
        <FlowArrows
          snapshot={snapshot}
          boxes={boxes}
          selectedFlowId={selection?.kind === 'flow' ? selection.id : undefined}
          onSelect={(flowId) => select({ kind: 'flow', id: flowId } as Selection)}
        />

        {artboards.map((artboard) => (
          <div
            key={artboard.id}
            className={`artboard-slot ${activeArtboardId === artboard.id ? 'is-active' : ''}`}
            style={{ left: offsets.get(artboard.id) ?? 0, width: sizeOf(artboard).width }}
          >
            <div className="artboard__label" onClick={() => setActiveArtboard(artboard.id)}>
              {artboard.name}
              {artboard.id === entryId ? <span className="chip">entry</span> : null}
              <span className="chip chip--mono" data-testid={`screen-size-${artboard.id}`}>
                {sizeOf(artboard).width} x {sizeOf(artboard).height}
                {presetForSize(sizeOf(artboard).width, sizeOf(artboard).height)
                  ? ` ${presetForSize(sizeOf(artboard).width, sizeOf(artboard).height)!.label}`
                  : ''}
              </span>
              {(artboard.params ?? []).length > 0 ? (
                <span className="chip chip--mono">
                  {(artboard.params ?? []).map((p) => `:${p.name}`).join(' ')}
                </span>
              ) : null}
            </div>
            <div
              className={`artboard ${chrome.grid ? 'has-grid' : ''}`}
              ref={(node) => {
                if (node) artboardRefs.current.set(artboard.id, node);
                else artboardRefs.current.delete(artboard.id);
              }}
              style={{
                minHeight: sizeOf(artboard).height,
                ...(chrome.grid
                  ? ({ '--grid-step': `${chrome.step}px` } as React.CSSProperties)
                  : {}),
              }}
              onClick={() => setActiveArtboard(artboard.id)}
            >
              <Guides
                artboard={artboard}
                width={sizeOf(artboard).width}
                height={Math.max(
                  artboardRefs.current.get(artboard.id)?.offsetHeight ?? 0,
                  sizeOf(artboard).height,
                )}
                scale={scale}
              />
              <ComponentView
                snapshot={snapshot}
                id={artboard.root}
                onSelect={selectComponent}
                registerNode={registerNode}
                onPointerDown={dragReorder.onPointerDown}
                draggingId={dragReorder.dragging}
                alsoSelected={alsoSelected}
                hidden={hiddenInEditor}
              />
            </div>

            {/* Drag the corner to resize the screen. The listeners go on the window for the
                duration of the drag: the pointer leaves this 14px button immediately, and one op
                lands on release so a resize is one undo rather than one per pixel. */}
            <button
              className="artboard__resize"
              title="Resize screen"
              aria-label={`Resize ${artboard.name}`}
              data-testid={`resize-${artboard.id}`}
              onPointerDown={(event) => {
                event.stopPropagation();
                event.preventDefault();
                const start = sizeOf(artboard);
                const from = { x: event.clientX, y: event.clientY };
                let latest = { width: start.width, height: start.height };

                const onMove = (move: PointerEvent): void => {
                  // Divide by the zoom, or the screen grows faster than the pointer.
                  latest = {
                    width: Math.max(
                      MIN_SCREEN.width,
                      Math.round(start.width + (move.clientX - from.x) / scale),
                    ),
                    height: Math.max(
                      MIN_SCREEN.height,
                      Math.round(start.height + (move.clientY - from.y) / scale),
                    ),
                  };
                  setResizing({ id: artboard.id, ...latest });
                };

                const onUp = (): void => {
                  window.removeEventListener('pointermove', onMove);
                  window.removeEventListener('pointerup', onUp);
                  setResizing(null);
                  if (latest.width === start.width && latest.height === start.height) return;
                  setArtboardSize(artboard.id, {
                    ...latest,
                    preset: presetForSize(latest.width, latest.height)?.id,
                  });
                };

                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', onUp);
              }}
            />
          </div>
        ))}

        {draft ? (
          <div
            className={`guide guide--draft guide--${draft.axis}`}
            data-testid="guide-draft"
            style={
              draft.axis === 'x'
                ? { left: draft.at, top: -4000, height: 8000 }
                : { top: draft.at, left: -4000, width: 8000 }
            }
          />
        ) : null}

        {selectedComponent ? (
          <SelectionOverlay
            resize={{ snapshot, chrome }}
            id={selectedComponent.id}
            target={nodes.current.get(selectedComponent.id)}
            container={layerRef.current}
            deps={[snapshot, attached]}
            scale={scale}
            label={selectedComponent.name ?? selectedComponent.type}
            variant="selected"
          />
        ) : null}
      </div>

      {/* One insertion line, drawn for whichever gesture is in flight: reordering a layer, or
          dragging something new out of the palette. */}
      {(dragReorder.target ?? paletteTarget) ? (
        <div
          className="drop-marker"
          style={
            (dragReorder.target ?? paletteTarget)!.marker.vertical
              ? {
                  left: (dragReorder.target ?? paletteTarget)!.marker.left,
                  top: (dragReorder.target ?? paletteTarget)!.marker.top,
                  width: 2,
                  height: (dragReorder.target ?? paletteTarget)!.marker.length,
                }
              : {
                  left: (dragReorder.target ?? paletteTarget)!.marker.left,
                  top: (dragReorder.target ?? paletteTarget)!.marker.top,
                  width: (dragReorder.target ?? paletteTarget)!.marker.length,
                  height: 2,
                }
          }
        />
      ) : null}

      {drawPlace.draw ? (
        <div
          className="draw-band"
          data-testid="draw-band"
          style={{
            left: drawPlace.draw.rect.left,
            top: drawPlace.draw.rect.top,
            width: drawPlace.draw.rect.width,
            height: drawPlace.draw.rect.height,
          }}
        />
      ) : null}

      {artboards.length === 0 ? (
        <div className="canvas__empty" data-testid="canvas-empty">
          <p>
            <strong>Draw a frame to make your first screen.</strong>
          </p>
          <p className="panel__hint">
            Press <kbd>F</kbd> and drag anywhere here, or pick a device size from the frame tool.
          </p>
        </div>
      ) : null}

      {chrome.rulers ? (
        <>
          <Ruler
            axis="x"
            length={size.width}
            offset={pan.x}
            scale={scale}
            artboards={artboards.map((artboard) => ({
              id: artboard.id,
              left: offsets.get(artboard.id) ?? 0,
              width: sizeOf(artboard).width,
            }))}
            onGuide={addGuide}
            onDrafting={(axis, at) => setDraft(axis ? { axis, at } : undefined)}
          />
          <Ruler
            axis="y"
            length={size.height}
            offset={pan.y}
            scale={scale}
            artboards={[]}
            onGuide={addGuide}
            onDrafting={(axis, at) => setDraft(axis ? { axis, at } : undefined)}
          />
          <span className="ruler__corner" />
        </>
      ) : null}

      <div className="canvas__chrome">
        <button
          className={chrome.rulers ? 'is-active' : ''}
          data-testid="toggle-rulers"
          title="Rulers"
          onClick={() => setChromeState({ rulers: !chrome.rulers })}
        >
          Rulers
        </button>
        <button
          className={chrome.grid ? 'is-active' : ''}
          data-testid="toggle-grid"
          title={`Grid — ${chrome.step}px`}
          onClick={() => setChromeState({ grid: !chrome.grid })}
        >
          Grid
        </button>
        <button
          className={chrome.snap ? 'is-active' : ''}
          data-testid="toggle-snap"
          title="Snap to the grid and to guides"
          onClick={() => setChromeState({ snap: !chrome.snap })}
        >
          Snap
        </button>
      </div>

      <CanvasToolbar />

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
