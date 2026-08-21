import { useEffect, useState } from 'react';
import { Canvas } from './canvas/Canvas';
import { NodesCanvas } from './nodes/NodesCanvas';
import { Inspector } from './inspector/Inspector';
import { LayersPanel } from './panels/LayersPanel';
import { ProblemsPanel } from './panels/ProblemsPanel';
import { Toolbar } from './panels/Toolbar';
import { PreviewPanel } from './preview/PreviewPanel';
import { getState, redo, removeArtboard, removeComponent, removeFlow, undo } from './state/store';
import { removeNode, removeWire } from './state/graph';
import { useEditor } from './state/useEditor';
import type { AutosaveHandle } from './state/persistence';

export default function App({
  autosave,
  restoreProblem,
}: {
  autosave?: AutosaveHandle;
  restoreProblem?: string;
}) {
  const [previewOpen, setPreviewOpen] = useState(true);
  const mode = useEditor((s) => s.mode);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'SELECT';

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (!typing && (event.key === 'Delete' || event.key === 'Backspace')) {
        const { selection } = getState();
        if (!selection) return;
        event.preventDefault();
        if (selection.kind === 'component') removeComponent(selection.id);
        else if (selection.kind === 'flow') removeFlow(selection.id);
        else if (selection.kind === 'node') removeNode(selection.id);
        else if (selection.kind === 'wire') removeWire(selection.id);
        else removeArtboard(selection.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="studio">
      <Toolbar
        previewOpen={previewOpen}
        onTogglePreview={() => setPreviewOpen((v) => !v)}
        autosave={autosave}
        restoreProblem={restoreProblem}
      />
      <main className={`workspace ${previewOpen ? 'workspace--preview' : ''}`}>
        {/* The left rail carries what is *true of the project*: its screens, and what is wrong
            with them. Both stay visible in either mode. */}
        <div className="rail">
          <LayersPanel />
          <ProblemsPanel />
        </div>
        {mode === 'design' ? <Canvas /> : <NodesCanvas />}
        {previewOpen ? <PreviewPanel /> : null}
        <Inspector />
      </main>
    </div>
  );
}
