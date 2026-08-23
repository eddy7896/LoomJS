import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_SCREEN, SCREEN_PRESETS, screenPreset } from '@loom/components';
import { useEditor } from '../state/useEditor';
import { selectComponent } from '../state/store';
import { notePreviewLoaded, notePreviewMounted, usePreviewSync } from './usePreviewSync';

/**
 * The Preview, as a floating window (`docs/12-canvas.md`).
 *
 * It was a docked column, which meant the canvas paid for it permanently: a third of the width
 * gone whether or not anyone was looking at the running app. A window can be moved out of the
 * way, collapsed to its bar, and put back — and it can sit *over* the canvas, which is where a
 * designer wants it while comparing the two.
 *
 * **The app always renders at its real width.** A device preset sizes the frame and the stage
 * scales it to fit; it never squeezes the app into whatever space the window happens to have,
 * because a preview that lies about the viewport is worse than no preview. "Fluid" is the honest
 * opposite: the frame *is* the window, so dragging the corner resizes the viewport itself.
 */

const STORAGE_KEY = 'loom.preview.window';

/** Which frame the app is drawn in. `screen` follows the artboard being designed. */
type Device = 'screen' | 'fluid' | string;

interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  collapsed: boolean;
  device: Device;
  mockup: boolean;
}

const DEFAULTS: WindowState = {
  x: -1,
  y: -1,
  width: 460,
  height: 620,
  collapsed: false,
  device: 'screen',
  mockup: true,
};

const MIN = { width: 280, height: 200 };
const BAR_HEIGHT = 38;

function load(): WindowState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<WindowState>) } : DEFAULTS;
  } catch {
    // A window that cannot remember where it was is a small loss; a studio that will not open
    // because of it is not.
    return DEFAULTS;
  }
}

function save(state: WindowState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* private mode, or a full quota: not worth interrupting anyone over */
  }
}

/**
 * The hardware each group is drawn as.
 *
 * A mockup is not decoration: seeing a screen inside the thing it will be held in is how a
 * designer judges whether a header is reachable by a thumb or a footer is buried under a home
 * bar. So the proportions are the real ones — bezels a phone actually has, a lid with the base
 * under it — rather than a generic rounded rectangle.
 *
 * `bezel` is the border around the screen; `foot` is extra height *below* it that is not screen
 * at all, which is what makes a laptop a laptop.
 */
const CHROME = {
  phone: { bezel: 13, foot: 0 },
  tablet: { bezel: 17, foot: 0 },
  desktop: { bezel: 11, foot: 24 },
} as const;

type Chrome = keyof typeof CHROME;

function chromeFor(device: Device): Chrome | undefined {
  const preset = screenPreset(device);
  return preset?.group;
}

export function PreviewWindow({ onClose }: { onClose: () => void }) {
  const snapshot = useEditor((s) => s.snapshot);
  const activeArtboardId = useEditor((s) => s.activeArtboardId);
  const mode = useEditor((s) => s.mode);
  const status = usePreviewSync(snapshot, true);

  const [win, setWin] = useState<WindowState>(load);

  /**
   * Wiring needs the whole canvas.
   *
   * A floating window does not just cover the graph, it *eats* the gesture: a wire dropped on a
   * port underneath it lands on the window instead, and the wire never forms. So switching to
   * Nodes folds the Preview to its bar — one click from expanding it again, and expanded is
   * remembered until the mode changes, because someone who opened it there meant to.
   */
  const [openedInNodes, setOpenedInNodes] = useState(false);
  useEffect(() => setOpenedInNodes(false), [mode]);
  const collapsed = win.collapsed || (mode === 'nodes' && !openedInNodes);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [stage, setStage] = useState({ width: 0, height: 0 });

  /**
   * The stage's own size, measured as a **callback ref**.
   *
   * An effect would have run while the stage was still nothing — it only appears once the first
   * build exists — and an observer attached to null never fires. The frame then had no size to
   * fit into, fell back to 1:1, and a laptop preview was drawn 1280 pixels wide inside a 460
   * pixel window. Measuring when the node arrives is the fix.
   */
  const watcher = useRef<ResizeObserver | null>(null);
  const stageRef = useCallback((node: HTMLDivElement | null) => {
    watcher.current?.disconnect();
    watcher.current = null;
    if (!node) return;

    setStage({ width: node.clientWidth, height: node.clientHeight });
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setStage({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(node);
    watcher.current = observer;
  }, []);

  const update = useCallback((patch: Partial<WindowState>): void => {
    setWin((current) => {
      const next = { ...current, ...patch };
      save(next);
      return next;
    });
  }, []);

  /**
   * Catching the page up when a build did not reach it.
   *
   * A hot update only reaches a page that is already listening. While the Preview is loading it
   * is not, so a build written in that window is broadcast to nobody and the page renders the app
   * from before it — the first edit after opening looks like it did nothing.
   *
   * The trigger is an **observation, not a guess**: the server counted the connections at the
   * moment it wrote, and says when there were none. Comparing build numbers on load looked like a
   * second signal and was not — it also fired on pages the update *had* reached, reloading them
   * mid-interaction and wiping whatever had just been typed into the app.
   */
  const [nonce, setNonce] = useState(0);
  /**
   * Misses that happened before this page existed are not this page's problem.
   *
   * While the window is folded — the whole time someone is wiring in Nodes — there is no frame to
   * hear anything, so every build counts as missed. Reloading for those would throw away whatever
   * the person had just done in the app: a form half filled in, a toast they were reading. The
   * baseline is taken when the frame loads, and only a miss *after* that is worth correcting.
   */
  const heard = useRef(0);
  /** The misses that already existed when this page went to fetch its modules. */
  const startedAt = useRef(0);
  const missedNow = useRef(0);
  missedNow.current = status.missed;

  // A stable callback, so it runs when the frame really mounts rather than on every render.
  const corrections = useRef(0);
  const mountFrame = useCallback((node: HTMLIFrameElement | null) => {
    notePreviewMounted(Boolean(node));
    if (!node) return;
    startedAt.current = missedNow.current;
    corrections.current = 0;
  }, []);

  useEffect(() => {
    if (status.missed <= heard.current) return;
    // After the burst, not during it: a page still loading misses every build in a fast sequence,
    // and reloading per miss is a page that reloads forever and never finishes.
    const timer = setTimeout(() => {
      // Checked again on the way out: the frame may have mounted while this was waiting, in which
      // case it has already fetched the current build and reloading it would only throw away
      // whatever the person has done in the app since.
      if (status.missed <= heard.current) return;
      heard.current = status.missed;
      setNonce(status.missed);
    }, 500);
    return () => clearTimeout(timer);
  }, [status.missed]);

  // Placed in the bottom-right of the **canvas** on first open: clear of the inspector, which is
  // a panel someone is using while they watch this, and out of the corner where the node graph
  // lays out its first nodes. The floating toolbar draws above it, so overlapping there is safe.
  useEffect(() => {
    if (win.x >= 0 && win.y >= 0) return;
    const parent = frameRef.current?.offsetParent as HTMLElement | null;
    if (!parent) return;
    const origin = parent.getBoundingClientRect();
    const area = document.querySelector('.canvas')?.getBoundingClientRect() ?? origin;
    update({
      x: Math.max(16, area.right - origin.left - win.width - 24),
      y: Math.max(16, area.bottom - origin.top - win.height - 24),
    });
  }, [update, win.height, win.width, win.x, win.y]);

  /** Drag by the bar, resize by the corner: both are the same pointer maths on different fields. */
  const grab = (event: React.PointerEvent, intent: 'move' | 'resize'): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    const pointer = { x: event.clientX, y: event.clientY };
    const from = { ...win };
    const parent = frameRef.current?.offsetParent as HTMLElement | null;

    const onMove = (move: PointerEvent): void => {
      const dx = move.clientX - pointer.x;
      const dy = move.clientY - pointer.y;
      if (intent === 'move') {
        // Kept inside the workspace: a window dragged off the edge is one you cannot get back.
        const maxX = (parent?.clientWidth ?? Infinity) - 60;
        const maxY = (parent?.clientHeight ?? Infinity) - BAR_HEIGHT;
        update({
          x: Math.min(Math.max(0, from.x + dx), maxX),
          y: Math.min(Math.max(0, from.y + dy), maxY),
        });
        return;
      }
      update({
        width: Math.max(MIN.width, from.width + dx),
        height: Math.max(MIN.height, from.height + dy),
      });
    };

    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // What the app is drawn at.
  const artboardSize = snapshot.artboards[activeArtboardId]?.size ?? DEFAULT_SCREEN;
  const preset = screenPreset(win.device);
  const device =
    win.device === 'fluid'
      ? undefined
      : preset
        ? { width: preset.width, height: preset.height }
        : { width: artboardSize.width, height: artboardSize.height };

  const chrome = win.mockup ? chromeFor(win.device) : undefined;
  const { bezel, foot } = chrome ? CHROME[chrome] : { bezel: 0, foot: 0 };

  // Scaled to fit rather than squeezed: the app keeps the width it would really have.
  const scale = device
    ? Math.min(
        1,
        (stage.width - 24 - bezel * 2) / device.width,
        (stage.height - 24 - bezel * 2 - foot) / device.height,
      )
    : 1;
  const fitted = Number.isFinite(scale) && scale > 0 ? scale : 1;

  // The island and the home bar belong to the screen, so they scale with it — and they disappear
  // when the screen is too small for them to be anything but a smudge.
  const details = fitted > 0.3;

  return (
    <section
      ref={frameRef}
      className={`preview preview--window ${collapsed ? 'is-collapsed' : ''}`}
      data-testid="preview-window"
      style={{
        left: Math.max(0, win.x),
        top: Math.max(0, win.y),
        width: win.width,
        height: collapsed ? (status.error ? 'auto' : BAR_HEIGHT) : win.height,
      }}
    >
      <header className="preview__bar" onPointerDown={(event) => grab(event, 'move')}>
        <span className="preview__title">Preview</span>
        <span
          className={`dot ${status.error ? 'dot--error' : status.syncing ? 'dot--busy' : 'dot--ok'}`}
        />
        <span className="preview__state mono">
          {status.error ? 'build error' : status.syncing ? 'compiling…' : 'live'}
        </span>

        <span className="preview__spacer" />

        <span className="preview__size mono" data-testid="preview-size">
          {device ? device.width : Math.round(stage.width)}
          {fitted < 1 ? ` · ${Math.round(fitted * 100)}%` : ''}
        </span>

        <select
          className="preview__device"
          data-testid="preview-device"
          value={win.device}
          onPointerDown={(event) => event.stopPropagation()}
          onChange={(event) => update({ device: event.target.value })}
        >
          <option value="screen">This screen</option>
          <option value="fluid">Fluid</option>
          {SCREEN_PRESETS.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>

        <button
          className={win.mockup ? 'is-active' : ''}
          data-testid="preview-mockup"
          title="Draw the device around it"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => update({ mockup: !win.mockup })}
        >
          ▭
        </button>
        <button
          data-testid="preview-collapse"
          title={collapsed ? 'Expand' : 'Collapse'}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => {
            if (collapsed && mode === 'nodes') setOpenedInNodes(true);
            update({ collapsed: !collapsed });
          }}
        >
          {collapsed ? '▴' : '▾'}
        </button>
        <button
          data-testid="preview-close"
          title="Close the preview"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onClose}
        >
          ×
        </button>
      </header>

      {/* A build error is never folded away. The window collapses to keep the canvas clear, and
          hiding *why nothing works* behind that would make a broken build look like a quiet one. */}
      {status.error ? (
        <div className="preview__error">
          <strong>Build error</strong>
          <p>{status.error}</p>
          {status.entityId ? (
            <button onClick={() => selectComponent(status.entityId!)}>
              Reveal {status.entityId}
            </button>
          ) : null}
        </div>
      ) : null}

      {collapsed ? null : (
        <>
          {/* Nothing is loaded until the first build exists: until then the preview directory
              holds the bare seed app, and showing that would be showing someone else's project.
              The build a page missed while loading is caught by the reload above. */}
          {Object.keys(snapshot.artboards).length === 0 ? (
            <div className="preview__booting" data-testid="preview-empty">
              Nothing to run yet — draw a screen.
            </div>
          ) : status.url && status.builds > 0 ? (
            <div className="preview__stage" ref={stageRef}>
              <div
                className={`preview__device-frame ${chrome ? `is-${chrome}` : ''}`}
                data-testid="preview-mockup-frame"
                style={
                  device
                    ? {
                        width: device.width * fitted + bezel * 2,
                        height: device.height * fitted + bezel * 2 + foot,
                      }
                    : { width: '100%', height: '100%' }
                }
              >
                {/* The buttons down the sides. They sit outside the shell, as they do on the
                    thing itself. */}
                {chrome === 'phone' && details ? (
                  <>
                    <span className="preview__button" style={{ left: -3, top: '12%', height: '4%' }} />
                    <span className="preview__button" style={{ left: -3, top: '19%', height: '7%' }} />
                    <span className="preview__button" style={{ left: -3, top: '28%', height: '7%' }} />
                    <span className="preview__button" style={{ right: -3, top: '23%', height: '10%' }} />
                  </>
                ) : null}
                {chrome === 'tablet' && details ? (
                  <span className="preview__button" style={{ right: -3, top: '10%', height: '7%' }} />
                ) : null}

                <div
                  className={`preview__viewport ${chrome ? `is-${chrome}` : 'is-bare'}`}
                  style={
                    device
                      ? { width: device.width * fitted, height: device.height * fitted }
                      : { width: '100%', height: '100%' }
                  }
                >
                  <iframe
                    className="preview__frame"
                    src={nonce > 0 ? `${status.url}?load=${nonce}` : status.url}
                    title="Preview"
                    ref={mountFrame}
                    // What it missed *before it went to fetch* is in what it just fetched. What it
                    // missed **while it was loading** is not — that is the whole race, and it is
                    // corrected here, immediately: a moment later is a moment in which someone has
                    // typed something into the app that the reload would throw away.
                    onLoad={() => {
                      notePreviewLoaded();
                      const behind = missedNow.current > startedAt.current;
                      startedAt.current = missedNow.current;
                      heard.current = missedNow.current;
                      // Capped, because each correction can itself be overtaken while it loads,
                      // and a page that reloads forever is worse than one a build behind.
                      if (behind && corrections.current < 3) {
                        corrections.current += 1;
                        setNonce((value) => value + 1);
                      }
                    }}
                    style={
                      device
                        ? {
                            width: device.width,
                            height: device.height,
                            transform: `scale(${fitted})`,
                            transformOrigin: 'top left',
                          }
                        : { width: '100%', height: '100%' }
                    }
                  />
                </div>
                {/* Drawn over the screen, because that is where the hardware puts it: a header
                    tucked under the island is a header nobody can read. */}
                {chrome === 'phone' && details ? (
                  <span
                    className="preview__island"
                    style={{ top: bezel + 8 * fitted, height: 22 * fitted, width: 34 * fitted + 60 }}
                  />
                ) : null}
                {chrome === 'desktop' && details ? (
                  <span className="preview__camera" style={{ top: bezel - 4 }} />
                ) : null}
                {chrome === 'tablet' && details ? (
                  <span className="preview__camera" style={{ top: bezel / 2 - 2 }} />
                ) : null}
                {chrome === 'phone' && details ? <span className="preview__home" /> : null}
                {/* The lid closes onto a base: the part that makes it read as a laptop. */}
                {chrome === 'desktop' ? (
                  <span className="preview__base" style={{ height: foot }}>
                    <i />
                  </span>
                ) : null}
              </div>
            </div>
          ) : status.url ? (
            <div className="preview__booting">Compiling…</div>
          ) : (
            <div className="preview__error">Preview server not reachable.</div>
          )}

          <button
            className="preview__resize"
            data-testid="preview-resize"
            title="Resize"
            aria-label="Resize the preview"
            onPointerDown={(event) => grab(event, 'resize')}
          />
        </>
      )}
    </section>
  );
}
