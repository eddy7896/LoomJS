import type { Id, Snapshot } from '@loom/ir';
import { useEditor } from '../state/useEditor';
import { nudgeOrder, removeComponent, rootComponentId, select } from '../state/store';

export function LayersPanel() {
  const snapshot = useEditor((s) => s.snapshot);
  const selectedId = useEditor((s) => s.selectedId);
  const rootId = rootComponentId(snapshot);

  return (
    <aside className="panel layers">
      <h2 className="panel__title">Layers</h2>
      <Row snapshot={snapshot} id={rootId} depth={0} selectedId={selectedId} rootId={rootId} />
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
        onClick={() => select(id)}
      >
        <span className="layer__name">{component.name ?? component.type}</span>
        <span className="layer__type mono">{component.type}</span>
        {id !== rootId ? (
          <span className="layer__actions">
            <button title="Move up" onClick={(e) => (e.stopPropagation(), nudgeOrder(id, -1))}>
              ↑
            </button>
            <button title="Move down" onClick={(e) => (e.stopPropagation(), nudgeOrder(id, 1))}>
              ↓
            </button>
            <button title="Delete" onClick={(e) => (e.stopPropagation(), removeComponent(id))}>
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
