import { useState } from 'react';
import { componentDefs, nodeDefs } from '@loom/components';
import { useEditor } from '../state/useEditor';
import { addArtboard, addComponent, redo, setMode, undo } from '../state/store';
import { addBodyStep, addGraphNode } from '../state/graph';
import { addDbStep, connectedTables } from '../state/connectors';

export function Toolbar({
  previewOpen,
  onTogglePreview,
}: {
  previewOpen: boolean;
  onTogglePreview: () => void;
}) {
  const [table, setTable] = useState('');
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const mode = useEditor((s) => s.mode);
  const selection = useEditor((s) => s.selection);
  const snapshot = useEditor((s) => s.snapshot);

  // A function node added while an API route is selected goes *into* its body — the server side.
  const containerId =
    selection?.kind === 'node' && snapshot.nodes[selection.id]?.category === 'api'
      ? selection.id
      : undefined;

  const tables = connectedTables(snapshot);

  return (
    <header className="toolbar">
      <span className="brand">loom<span className="brand__js">JS</span></span>
      <div className="toolbar__group toolbar__modes">
        <button className={mode === 'design' ? 'is-active' : ''} onClick={() => setMode('design')}>
          Design
        </button>
        <button className={mode === 'nodes' ? 'is-active' : ''} onClick={() => setMode('nodes')}>
          Nodes
        </button>
      </div>

      {mode === 'design' ? (
        <>
          <div className="toolbar__group">
            {componentDefs().map((def) => (
              <button key={def.type} onClick={() => addComponent(def.type)}>
                + {def.label}
              </button>
            ))}
          </div>

          <div className="toolbar__group">
            <button onClick={() => addArtboard()}>+ Screen</button>
          </div>
        </>
      ) : (
        <div className="toolbar__group">
          {nodeDefs().map((def) => (
            <button
              key={`${def.category}:${def.kind}`}
              title={
                def.category === 'fn' && containerId
                  ? 'Adds a step inside the selected API route'
                  : undefined
              }
              onClick={() =>
                def.category === 'fn' && containerId
                  ? addBodyStep(containerId, def.kind)
                  : addGraphNode(def.category, def.kind)
              }
            >
              + {def.label}
            </button>
          ))}

          {containerId && tables.length > 0 ? (
            <>
              <select
                value={table}
                onChange={(event) => setTable(event.target.value)}
                aria-label="Table"
              >
                {tables.map((candidate) => (
                  <option key={candidate.name} value={candidate.name}>
                    {candidate.name}
                  </option>
                ))}
              </select>
              <button onClick={() => addDbStep(containerId, table || tables[0]!.name, 'select')}>
                + Read rows
              </button>
              <button onClick={() => addDbStep(containerId, table || tables[0]!.name, 'insert')}>
                + Insert row
              </button>
            </>
          ) : null}
        </div>
      )}

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
