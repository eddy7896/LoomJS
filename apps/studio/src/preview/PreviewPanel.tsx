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
            src={status.url}
            title="Preview"
          />
        </div>
      ) : (
        <div className="preview__error">Preview server not reachable.</div>
      )}
    </section>
  );
}
