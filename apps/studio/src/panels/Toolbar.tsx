import { useEffect, useState } from 'react';
import { useEditor } from '../state/useEditor';
import { redo, resetProject, undo } from '../state/store';
import { clearProject, type AutosaveHandle, type SaveState } from '../state/persistence';

/**
 * The top bar keeps only what is genuinely global (S0, `docs/11-editor-shell.md`). Placing things
 * moved to the sidebar, and switching sections moved to the icon rail — a toolbar that carried
 * every component was already the least usable surface in the editor at eight of them.
 */

export function Toolbar({
  previewOpen,
  onTogglePreview,
  autosave,
  restoreProblem,
}: {
  previewOpen: boolean;
  onTogglePreview: () => void;
  autosave?: AutosaveHandle;
  restoreProblem?: string;
}) {
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);

  return (
    <header className="toolbar">
      <span className="brand">loom<span className="brand__js">JS</span></span>

      <div className="toolbar__group">
        <button disabled={!canUndo} onClick={undo}>
          Undo
        </button>
        <button disabled={!canRedo} onClick={redo}>
          Redo
        </button>
      </div>

      <div className="toolbar__spacer" />

      <SaveStatus autosave={autosave} restoreProblem={restoreProblem} />

      <button
        data-testid="reset-project"
        title="Throw this project away and start over"
        onClick={() => {
          if (!window.confirm('Discard this project and start a new one?')) return;
          clearProject();
          resetProject();
          autosave?.flush();
        }}
      >
        New
      </button>

      <button className={previewOpen ? 'is-active' : ''} onClick={onTogglePreview}>
        {previewOpen ? 'Hide preview' : 'Preview'}
      </button>
    </header>
  );
}

/**
 * Whether the work is safe. Honest about failure: a browser refusing storage, or a document that
 * this build could not read, says so rather than showing a reassuring tick.
 */
function SaveStatus({
  autosave,
  restoreProblem,
}: {
  autosave?: AutosaveHandle;
  restoreProblem?: string;
}) {
  const [state, setState] = useState<SaveState>('idle');
  const [detail, setDetail] = useState<string | undefined>();

  useEffect(() => {
    if (!autosave) return;
    return autosave.subscribe((next, why) => {
      setState(next);
      setDetail(why);
    });
  }, [autosave]);

  if (restoreProblem) {
    return (
      <span className="save save--error" title={restoreProblem} data-testid="save-status">
        could not open saved project
      </span>
    );
  }

  if (state === 'error') {
    return (
      <span className="save save--error" title={detail} data-testid="save-status">
        not saved
      </span>
    );
  }

  return (
    <span className="save" data-testid="save-status">
      {state === 'saving' ? 'saving…' : state === 'saved' ? 'saved' : 'ready'}
    </span>
  );
}
