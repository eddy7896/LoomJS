import type { CSSProperties, MouseEvent } from 'react';
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
  selectedId: Id | undefined;
  onSelect: (id: Id, event: MouseEvent) => void;
  registerNode: (id: Id, node: HTMLElement | null) => void;
}

function staticString(component: Component, key: string): string {
  const value = component.props[key];
  if (value?.kind === 'static' && typeof value.value === 'string') return value.value;
  if (value?.kind === 'bound') return '(bound)';
  return '';
}

export function ComponentView({ snapshot, id, selectedId, onSelect, registerNode }: Props) {
  const component = snapshot.components[id];
  if (!component) return null;

  const select = (event: MouseEvent): void => {
    event.stopPropagation();
    onSelect(id, event);
  };

  const shared = {
    'data-loom-id': id,
    ref: (node: HTMLElement | null) => registerNode(id, node),
    onClick: select,
  };

  if (component.type === 'Text') {
    return (
      <span {...shared} style={{ cursor: 'default' }}>
        {staticString(component, 'content')}
      </span>
    );
  }

  const style = (component.layout ? layoutToStyle(component.layout) : {}) as CSSProperties;

  return (
    <div {...shared} style={{ ...style, minHeight: component.children?.length ? undefined : 48 }}>
      {(component.children ?? []).map((childId) => (
        <ComponentView
          key={childId}
          snapshot={snapshot}
          id={childId}
          selectedId={selectedId}
          onSelect={onSelect}
          registerNode={registerNode}
        />
      ))}
    </div>
  );
}
