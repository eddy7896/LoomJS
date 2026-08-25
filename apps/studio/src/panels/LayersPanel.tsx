import { useState } from 'react';
import { actionsOf, type Component, type Id, type Snapshot } from '@loom/ir';
import { DEFAULT_SCREEN, defFor } from '@loom/components';
import { useEditor } from '../state/useEditor';
import {
  addArtboard,
  addShell,
  entryArtboardId,
  moveComponent,
  parentOf,
  removeComponent,
  extendSelection,
  selectComponent,
  setActiveArtboard,
  toggleAllLayers,
  toggleEditorVisibility,
  toggleLayer,
} from '../state/store';

/**
 * The elements tree (S0/S2, `docs/11-editor-shell.md`): screens and what is on them, above the
 * palette in one column.
 *
 * A screen and its root frame are **one row**, not two (`docs/12-canvas.md`): they were always
 * one object — a frame with a route — and showing the seam made a designer guess which half held
 * the padding and which held the size.
 *
 * S2 makes it the primary way to move around a screen rather than a read-only list — a component
 * can be dragged into a different Frame from here, which the canvas cannot express at all once a
 * container is empty or off-screen.
 */

/** Where a drop would put the dragged component. */
type DropAt = 'inside' | 'after';

const nameOf = (component: Component): string => component.name ?? component.type;

/** Is `candidate` inside `ancestor`? A row may not be dropped into its own subtree. */
function contains(snapshot: Snapshot, ancestor: Id, candidate: Id): boolean {
  if (ancestor === candidate) return true;
  return (snapshot.components[ancestor]?.children ?? []).some((child) =>
    contains(snapshot, child, candidate),
  );
}

export function LayersPanel() {
  const snapshot = useEditor((s) => s.snapshot);
  const selection = useEditor((s) => s.selection);
  const also = useEditor((s) => s.also);
  const activeArtboardId = useEditor((s) => s.activeArtboardId);
  const hidden = useEditor((s) => s.hiddenInEditor);
  // Collapse lives in the store so that selecting something opens the rows above it, whether or
  // not the selection changed (`state/store.ts`).
  const collapsed = useEditor((s) => s.collapsedLayers);
  const entryId = entryArtboardId(snapshot);

  const [dragging, setDragging] = useState<Id | undefined>();
  const [over, setOver] = useState<{ id: Id; at: DropAt } | undefined>();

  const artboards = Object.values(snapshot.artboards).sort((a, b) => a.id.localeCompare(b.id));
  const selectedComponentId = selection?.kind === 'component' ? selection.id : undefined;

  /** Drop `dragging` relative to `target`, as one op so it is one undo. */
  const drop = (target: Id, at: DropAt): void => {
    setOver(undefined);
    const moved = dragging;
    setDragging(undefined);
    if (!moved || moved === target) return;
    // The op refuses this too, but refusing here keeps a bad drag from ever becoming a dispatch.
    if (contains(snapshot, moved, target)) return;

    if (at === 'inside') {
      moveComponent(moved, target);
      return;
    }
    const parent = parentOf(snapshot, target);
    if (!parent) return;
    const siblings = (parent.children ?? []).filter((id) => id !== moved);
    moveComponent(moved, parent.id, siblings.indexOf(target) + 1);
  };

  return (
    <aside className="panel layers" data-testid="layers">
      <div className="panel__head">
        <h2 className="panel__title">Elements tree</h2>
        <button
          title={collapsed.size > 0 ? 'Expand everything' : 'Collapse everything'}
          data-testid="layers-collapse-all"
          onClick={toggleAllLayers}
        >
          {collapsed.size > 0 ? '⤢' : '⤡'}
        </button>
        {/* Named the same as it was in the toolbar: adding a screen is the same act wherever the
            button lives, and the tree is where screens are. */}
        <button
          data-testid="add-screen"
          onClick={() =>
            addArtboard(artboards.length === 0 ? 'Home' : `Screen ${artboards.length + 1}`)
          }
        >
          + Screen
        </button>
        {/* An app shell is a board like a screen, drawn once and rendered around the pages inside
            it (R2). It sits beside "+ Screen" because it is the same kind of act. */}
        <button
          data-testid="add-shell"
          title="A frame drawn once, around every screen inside it"
          onClick={() => addShell()}
        >
          + Shell
        </button>
      </div>

      {artboards.map((artboard) => {
        // A screen **is** its root frame (`docs/12-canvas.md`). One row, not two: the second row
        // was the same object wearing a different name, and a designer had to know which of the
        // pair held the size and which held the padding.
        const root = snapshot.components[artboard.root];
        const children = root?.children ?? [];
        const isCollapsed = collapsed.has(artboard.root);
        const isOver = over?.id === artboard.root;
        const size = artboard.size ?? DEFAULT_SCREEN;

        return (
          <div key={artboard.id}>
            <div
              className={`layer layer--artboard ${
                selection?.kind === 'artboard' && selection.id === artboard.id ? 'is-selected' : ''
              } ${activeArtboardId === artboard.id ? 'is-active' : ''} ${
                isOver ? 'is-over is-over--inside' : ''
              }`}
              data-testid={`screen-${artboard.id}`}
              onClick={() => setActiveArtboard(artboard.id)}
              // Dropping onto the screen row puts the component in the screen, which is what the
              // row now stands for.
              onDragOver={(event) => {
                if (!dragging) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                if (!isOver) setOver({ id: artboard.root, at: 'inside' });
              }}
              onDragLeave={() => {
                if (isOver) setOver(undefined);
              }}
              onDrop={(event) => {
                event.preventDefault();
                drop(artboard.root, 'inside');
              }}
            >
              {children.length > 0 ? (
                <button
                  className="layer__caret"
                  title={isCollapsed ? 'Expand' : 'Collapse'}
                  data-testid={`layer-caret-${artboard.root}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleLayer(artboard.root);
                  }}
                >
                  {isCollapsed ? '▸' : '▾'}
                </button>
              ) : (
                <span className="layer__caret" />
              )}
              <span className="layer__name">{artboard.name}</span>
              {artboard.id === entryId ? <span className="chip">/</span> : null}
              <span className="chip chip--mono">
                {size.width}×{size.height}
              </span>
            </div>

            {isCollapsed
              ? null
              : children.map((childId) => (
                  <Row
                    key={childId}
                    snapshot={snapshot}
                    id={childId}
                    depth={1}
                    selectedId={selectedComponentId}
                    alsoSelected={also}
                    rootId={artboard.root}
                    hidden={hidden}
                    collapsed={collapsed}
                    onToggle={toggleLayer}
                    dragging={dragging}
                    over={over}
                    onDragStart={setDragging}
                    onDragOver={setOver}
                    onDrop={drop}
                  />
                ))}
          </div>
        );
      })}
    </aside>
  );
}

interface RowProps {
  snapshot: Snapshot;
  id: Id;
  depth: number;
  selectedId: Id | undefined;
  /** The rest of a multiple selection, so every picked row is marked (G1). */
  alsoSelected: Id[];
  rootId: Id;
  hidden: ReadonlySet<Id>;
  collapsed: ReadonlySet<Id>;
  onToggle: (id: Id) => void;
  dragging: Id | undefined;
  over: { id: Id; at: DropAt } | undefined;
  onDragStart: (id: Id | undefined) => void;
  onDragOver: (over: { id: Id; at: DropAt } | undefined) => void;
  onDrop: (target: Id, at: DropAt) => void;
}

function Row(props: RowProps) {
  const { snapshot, id, depth, selectedId, alsoSelected, rootId, hidden, collapsed, over } = props;
  const component = snapshot.components[id];
  if (!component) return null;

  const children = component.children ?? [];
  const isContainer = Boolean(defFor(component.type)?.isContainer);
  const isCollapsed = collapsed.has(id);
  const isHidden = hidden.has(id);

  // Both already have canvas markers; the tree is where you see them without hunting.
  const steps =
    component.props.onClick?.kind === 'event'
      ? actionsOf(component.props.onClick.handler).length
      : 0;
  const conditional =
    Boolean(component.visibleWhen) || (component.conditionalStyles ?? []).length > 0;

  // A container takes the drop inside it; anything else takes it as the next sibling. That is the
  // whole gesture: "put it in here" versus "put it after this".
  const dropAt: DropAt = isContainer ? 'inside' : 'after';
  const isOver = over?.id === id;

  return (
    <>
      <div
        className={`layer ${selectedId === id ? 'is-selected' : ''} ${
          alsoSelected.includes(id) ? 'is-also' : ''
        } ${isHidden ? 'is-hidden' : ''} ${isOver ? `is-over is-over--${over.at}` : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        data-testid={`layer-${id}`}
        // The artboard root stays put: an artboard with no tree is not a thing.
        draggable={id !== rootId}
        onDragStart={(event) => {
          event.stopPropagation();
          event.dataTransfer.effectAllowed = 'move';
          props.onDragStart(id);
        }}
        onDragEnd={() => {
          props.onDragStart(undefined);
          props.onDragOver(undefined);
        }}
        onDragOver={(event) => {
          if (!props.dragging || props.dragging === id) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          if (!isOver || over.at !== dropAt) props.onDragOver({ id, at: dropAt });
        }}
        onDragLeave={() => {
          if (isOver) props.onDragOver(undefined);
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          props.onDrop(id, dropAt);
        }}
        onClick={(event) => {
          // Shift adds to the selection, here as on the canvas: the tree is where a designer
          // picks several small things without hunting for them (G1).
          if (event.shiftKey) extendSelection(id);
          else selectComponent(id);
        }}
      >
        {children.length > 0 ? (
          <button
            className="layer__caret"
            title={isCollapsed ? 'Expand' : 'Collapse'}
            data-testid={`layer-caret-${id}`}
            onClick={(e) => {
              e.stopPropagation();
              props.onToggle(id);
            }}
          >
            {isCollapsed ? '▸' : '▾'}
          </button>
        ) : (
          <span className="layer__caret" />
        )}

        <span className="layer__name">{nameOf(component)}</span>
        {conditional ? (
          <span className="chip" title="Has a condition">
            ?
          </span>
        ) : null}
        {steps > 1 ? (
          <span className="chip" title={`${steps} steps on click`}>
            {steps}
          </span>
        ) : null}
        <span className="layer__type mono">{component.type}</span>

        {/* Its own slot, outside the hover-only actions: which rows are hidden has to be legible
            at a glance, or the only way to find one is to hover every row in turn. */}
        <button
          className={`layer__eye ${isHidden ? 'is-hidden' : ''}`}
          title={isHidden ? 'Show while designing' : 'Hide while designing'}
          data-testid={`layer-eye-${id}`}
          onClick={(e) => {
            e.stopPropagation();
            toggleEditorVisibility(id);
          }}
        >
          {isHidden ? '◌' : '◉'}
        </button>

        <span className="layer__actions">
          {id !== rootId ? (
            <button
              title="Delete"
              onClick={(e) => {
                e.stopPropagation();
                removeComponent(id);
              }}
            >
              ×
            </button>
          ) : null}
        </span>
      </div>

      {isCollapsed
        ? null
        : children.map((childId) => (
            <Row key={childId} {...props} id={childId} depth={depth + 1} />
          ))}
    </>
  );
}
