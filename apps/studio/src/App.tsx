import { useEffect, useState } from 'react';
import { Canvas } from './canvas/Canvas';
import { NodesCanvas } from './nodes/NodesCanvas';
import { Inspector } from './inspector/Inspector';
import { LayersPanel } from './panels/LayersPanel';
import { ElementsPanel } from './panels/ElementsPanel';
import { IconRail } from './panels/IconRail';
import { DataPanel } from './panels/DataPanel';
import { LogsPanel } from './panels/LogsPanel';
import { ToolsPanel } from './panels/ToolsPanel';
import { ProblemsPanel } from './panels/ProblemsPanel';
import { Toolbar } from './panels/Toolbar';
import { PreviewWindow } from './preview/PreviewWindow';
import { getState, redo, removeArtboard, removeComponent, removeFlow, undo } from './state/store';
import { groupSelection, ungroup } from './state/grouping';
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
  const rail = useEditor((s) => s.rail);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'SELECT';

      // Group and ungroup, on the keys every design tool uses.
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'g') {
        event.preventDefault();
        const { selection } = getState();
        if (event.shiftKey) {
          if (selection?.kind === 'component') ungroup(selection.id);
        } else {
          groupSelection();
        }
        return;
      }

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
      <main className="workspace">
        <IconRail />

        {/* One column, as the reference does it: what is on the screen, then what can be added,
            then what is wrong. Problems stays put in every section — a rail that hid it would
            make it the one thing you have to go looking for. */}
        <div className="rail">
          {rail === 'logs' ? (
            <LogsPanel />
          ) : rail === 'tools' ? (
            <ToolsPanel />
          ) : rail === 'data' ? (
            <DataPanel />
          ) : (
            <>
              <LayersPanel />
              <ElementsPanel />
            </>
          )}
          <ProblemsPanel />
        </div>
        {mode === 'design' ? <Canvas /> : <NodesCanvas />}
        <Inspector />

        {/* Floating, over the canvas: the running app is something to hold up against what you
            are drawing, not a column the canvas pays for permanently (`docs/12-canvas.md`). */}
        {previewOpen ? <PreviewWindow onClose={() => setPreviewOpen(false)} /> : null}
      </main>
    </div>
  );
}
