import type { Id, Snapshot } from '@loom/ir';
import { DataPanel } from './DataPanel';
import { useEditor } from '../state/useEditor';
import {
  addArtboard,
  entryArtboardId,
  nudgeOrder,
  removeComponent,
  selectComponent,
  setActiveArtboard,
} from '../state/store';

/** Screens and their trees. Selecting a screen makes it the one new components land in. */
export function LayersPanel() {
  const snapshot = useEditor((s) => s.snapshot);
  const selection = useEditor((s) => s.selection);
  const activeArtboardId = useEditor((s) => s.activeArtboardId);
  const entryId = entryArtboardId(snapshot);

  const artboards = Object.values(snapshot.artboards).sort((a, b) => a.id.localeCompare(b.id));
  const selectedComponentId = selection?.kind === 'component' ? selection.id : undefined;

  return (
    <aside className="panel layers">
      <div className="panel__head">
        <h2 className="panel__title">Screens</h2>
        <button onClick={() => addArtboard(`Screen ${artboards.length + 1}`)}>+</button>
      </div>

      {artboards.map((artboard) => (
        <div key={artboard.id}>
          <div
            className={`layer layer--artboard ${
              selection?.kind === 'artboard' && selection.id === artboard.id ? 'is-selected' : ''
            } ${activeArtboardId === artboard.id ? 'is-active' : ''}`}
            onClick={() => setActiveArtboard(artboard.id)}
          >
            <span className="layer__name">{artboard.name}</span>
            {artboard.id === entryId ? <span className="chip">/</span> : null}
          </div>
          <Row
            snapshot={snapshot}
            id={artboard.root}
            depth={1}
            selectedId={selectedComponentId}
            rootId={artboard.root}
          />
        </div>
      ))}

      <DataPanel />
    </aside>
  );
}

function Row({
  snapshot,
  id,
  depth,
  selectedId,
  rootId,
}: {
  snapshot: Snapshot;
  id: Id;
  depth: number;
  selectedId: Id | undefined;
  rootId: Id;
}) {
  const component = snapshot.components[id];
  if (!component) return null;

  return (
    <>
      <div
        className={`layer ${selectedId === id ? 'is-selected' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => selectComponent(id)}
      >
        <span className="layer__name">{component.name ?? component.type}</span>
        <span className="layer__type mono">{component.type}</span>
        {id !== rootId ? (
          <span className="layer__actions">
            <button
              title="Move up"
              onClick={(e) => {
                e.stopPropagation();
                nudgeOrder(id, -1);
              }}
            >
              ↑
            </button>
            <button
              title="Move down"
              onClick={(e) => {
                e.stopPropagation();
                nudgeOrder(id, 1);
              }}
            >
              ↓
            </button>
            <button
              title="Delete"
              onClick={(e) => {
                e.stopPropagation();
                removeComponent(id);
              }}
            >
              ×
            </button>
          </span>
        ) : null}
      </div>
      {(component.children ?? []).map((childId) => (
        <Row
          key={childId}
          snapshot={snapshot}
          id={childId}
          depth={depth + 1}
          selectedId={selectedId}
          rootId={rootId}
        />
      ))}
    </>
  );
}
