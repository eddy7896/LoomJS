import { useEffect, useState } from 'react';
import { Canvas } from './canvas/Canvas';
import { Inspector } from './inspector/Inspector';
import { LayersPanel } from './panels/LayersPanel';
import { Toolbar } from './panels/Toolbar';
import { PreviewPanel } from './preview/PreviewPanel';
import { getState, redo, removeArtboard, removeComponent, removeFlow, undo } from './state/store';

export default function App() {
  const [previewOpen, setPreviewOpen] = useState(true);

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
        else removeArtboard(selection.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="studio">
      <Toolbar previewOpen={previewOpen} onTogglePreview={() => setPreviewOpen((v) => !v)} />
      <main className={`workspace ${previewOpen ? 'workspace--preview' : ''}`}>
        <LayersPanel />
        <Canvas />
        {previewOpen ? <PreviewPanel /> : null}
        <Inspector />
      </main>
    </div>
  );
}
