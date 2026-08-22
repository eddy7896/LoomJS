import { useEffect, useState } from 'react';
import { DEFAULT_SCREEN } from '@loom/components';
import { useEditor } from '../state/useEditor';
import { selectComponent } from '../state/store';
import { usePreviewSync } from './usePreviewSync';

/**
 * Preview = the emitted app, served by its own Vite dev server, in an iframe. It runs real
 * compiler output, so what fails here is a real compiler failure (the point of M1).
 */
export function PreviewPanel() {
  const snapshot = useEditor((s) => s.snapshot);
  const activeArtboardId = useEditor((s) => s.activeArtboardId);
  const status = usePreviewSync(snapshot, true);

  /**
   * The frame is remounted once, on the first build after it opened.
   *
   * A hot update only reaches a page that was already listening, and the Preview's page loads
   * while that first build is still being written — so it renders the app from before it and no
   * update ever arrives to correct it. That reads as "my first edit did nothing", which is the
   * worst thing a live preview can do. One remount at the start costs nothing and removes the
   * whole race; every build after it is a hot update, as it should be.
   */
  const [boot, setBoot] = useState(0);
  useEffect(() => {
    if (status.builds === 1) setBoot(1);
  }, [status.builds]);

  // The Preview runs at the width of the screen being designed, so "does this fit on a phone" is
  // answered by looking rather than guessing. The frame scrolls if the panel is narrower.
  const size = snapshot.artboards[activeArtboardId]?.size ?? DEFAULT_SCREEN;

  return (
    <section className="preview">
      <header className="preview__bar">
        <span className="preview__title">Preview</span>
        <span className={`dot ${status.error ? 'dot--error' : status.syncing ? 'dot--busy' : 'dot--ok'}`} />
        <span className="preview__state mono">
          {status.error ? 'build error' : status.syncing ? 'compiling…' : 'live'}
        </span>
        <span className="preview__size mono" data-testid="preview-size">
          {size.width}
        </span>
      </header>

      {status.error ? (
        <div className="preview__error">
          <strong>Build error</strong>
          <p>{status.error}</p>
          {status.entityId ? (
            <button onClick={() => selectComponent(status.entityId!)}>Reveal {status.entityId}</button>
          ) : null}
        </div>
      ) : null}

      {status.url ? (
        <div className="preview__stage">
          <iframe
            className="preview__frame"
            style={{ width: size.width }}
            // Navigated rather than remounted: replacing the element would detach the frame, and
            // anything holding on to it — a devtools panel, a test — would be left pointing at a
            // frame that no longer exists.
            src={boot > 0 ? `${status.url}?build=${boot}` : status.url}
            title="Preview"
          />
        </div>
      ) : (
        <div className="preview__error">Preview server not reachable.</div>
      )}
    </section>
  );
}
