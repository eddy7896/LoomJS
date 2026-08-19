import { componentDefs } from '@loom/components';
import { useEditor } from '../state/useEditor';
import { addComponent, redo, undo } from '../state/store';

export function Toolbar({
  previewOpen,
  onTogglePreview,
}: {
  previewOpen: boolean;
  onTogglePreview: () => void;
}) {
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);

  return (
    <header className="toolbar">
      <span className="brand">loom<span className="brand__js">JS</span></span>
      <span className="toolbar__mode">Design</span>

      <div className="toolbar__group">
        {componentDefs().map((def) => (
          <button key={def.type} onClick={() => addComponent(def.type)}>
            + {def.label}
          </button>
        ))}
      </div>

      <div className="toolbar__group">
        <button disabled={!canUndo} onClick={undo}>
          Undo
        </button>
        <button disabled={!canRedo} onClick={redo}>
          Redo
        </button>
      </div>

      <div className="toolbar__spacer" />

      <button className={previewOpen ? 'is-active' : ''} onClick={onTogglePreview}>
        {previewOpen ? 'Hide preview' : 'Preview'}
      </button>
    </header>
  );
}
