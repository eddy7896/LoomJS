import type { CSSProperties, PointerEvent } from 'react';
import type { Component, Id, Snapshot } from '@loom/ir';
import { componentStyle, styleToCss } from '@loom/compiler';

/**
 * Design mode renders **real DOM**, not a raster canvas (docs/01) — what you see here is the
 * same markup the compiler emits, so the style functions are imported from the compiler rather
 * than reimplemented. One source of truth, or the canvas and the Preview drift — and a canvas
 * that lies about what an input looks like is worse than no canvas.
 */

interface Props {
  snapshot: Snapshot;
  id: Id;
  onSelect: (id: Id) => void;
  registerNode: (id: Id, node: HTMLElement | null) => void;
  onPointerDown: (id: Id, event: PointerEvent) => void;
  draggingId: Id | undefined;
}

function booleanProp(component: Component, key: string): boolean {
  const value = component.props[key];
  return value?.kind === 'static' ? Boolean(value.value) : false;
}

function textContent(component: Component, key: string): string {
  const value = component.props[key];
  if (value?.kind === 'static' && typeof value.value === 'string') return value.value;
  if (value?.kind === 'static' && typeof value.value === 'number') return String(value.value);
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
    // The canvas has no runtime values, so a conditional component is drawn and *marked* rather
    // than hidden — the Preview is where conditions actually run (`docs/specs/conditions.md`).
    'data-conditional': component.visibleWhen ? 'true' : undefined,
  };

  const style = componentStyle(component) as CSSProperties;
  const leafStyle = styleToCss(component) as CSSProperties;

  if (component.type === 'Text') {
    return (
      <span
        {...shared}
        ref={(node) => registerNode(id, node)}
        style={{ cursor: 'default', ...leafStyle }}
      >
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
        style={leafStyle}
        // Clicks select in the editor; the emitted app is where the handler actually runs.
        onDoubleClick={(event) => event.preventDefault()}
      >
        {textContent(component, 'label')}
      </button>
    );
  }

  // Inputs render as the real controls, read-only: the canvas is a picture of the app, and a
  // designer judging spacing needs to see the box the person will actually type into.
  if (component.type === 'TextField' || component.type === 'NumberField') {
    return (
      <input
        {...shared}
        ref={(node) => registerNode(id, node)}
        type={component.type === 'NumberField' ? 'number' : 'text'}
        readOnly
        value={textContent(component, 'value')}
        placeholder={textContent(component, 'placeholder')}
        style={leafStyle}
      />
    );
  }

  if (component.type === 'Checkbox') {
    return (
      <label
        {...shared}
        ref={(node) => registerNode(id, node)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, ...leafStyle }}
      >
        <input type="checkbox" readOnly checked={booleanProp(component, 'value')} />
        <span>{textContent(component, 'label')}</span>
      </label>
    );
  }

  if (component.type === 'Select') {
    const options = textContent(component, 'options')
      .split(',')
      .map((option) => option.trim())
      .filter(Boolean);
    return (
      <select
        {...shared}
        ref={(node) => registerNode(id, node)}
        value={options[0] ?? ''}
        disabled
        style={leafStyle}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

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
