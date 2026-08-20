import type { CSSProperties, PointerEvent } from 'react';
import type { Component, Id, Snapshot } from '@loom/ir';
import { layoutToStyle } from '@loom/compiler';

/**
 * Design mode renders **real DOM**, not a raster canvas (docs/01) — what you see here is the
 * same markup the compiler emits, so `layoutToStyle` is imported from the compiler rather than
 * reimplemented. One source of truth for layout, or the canvas and the Preview drift.
 */

interface Props {
  snapshot: Snapshot;
  id: Id;
  onSelect: (id: Id) => void;
  registerNode: (id: Id, node: HTMLElement | null) => void;
  onPointerDown: (id: Id, event: PointerEvent) => void;
  draggingId: Id | undefined;
}

function textContent(component: Component, key: string): string {
  const value = component.props[key];
  if (value?.kind === 'static' && typeof value.value === 'string') return value.value;
  // Route params and node bindings resolve at runtime; show the source, not a fake value.
  if (value?.kind === 'param') return `{${value.name}}`;
  if (value?.kind === 'bound') return '(bound)';
  return '';
}

export function ComponentView({
  snapshot,
  id,
  onSelect,
  registerNode,
  onPointerDown,
  draggingId,
}: Props) {
  const component = snapshot.components[id];
  if (!component) return null;

  const shared = {
    'data-loom-id': id,
    onClick: (event: React.MouseEvent) => {
      event.stopPropagation();
      onSelect(id);
    },
    onPointerDown: (event: PointerEvent) => onPointerDown(id, event),
    'data-dragging': draggingId === id ? 'true' : undefined,
  };

  if (component.type === 'Text') {
    return (
      <span {...shared} ref={(node) => registerNode(id, node)} style={{ cursor: 'default' }}>
        {textContent(component, 'content')}
      </span>
    );
  }

  if (component.type === 'Button') {
    return (
      <button
        {...shared}
        ref={(node) => registerNode(id, node)}
        type="button"
        // Clicks select in the editor; the emitted app is where the handler actually runs.
        onDoubleClick={(event) => event.preventDefault()}
      >
        {textContent(component, 'label')}
      </button>
    );
  }

  const style = (component.layout ? layoutToStyle(component.layout) : {}) as CSSProperties;

  return (
    <div
      {...shared}
      ref={(node) => registerNode(id, node)}
      style={{ ...style, minHeight: component.children?.length ? undefined : 48 }}
    >
      {(component.children ?? []).map((childId) => (
        <ComponentView
          key={childId}
          snapshot={snapshot}
          id={childId}
          onSelect={onSelect}
          registerNode={registerNode}
          onPointerDown={onPointerDown}
          draggingId={draggingId}
        />
      ))}
    </div>
  );
}
