import type { CSSProperties, PointerEvent } from 'react';
import { actionsOf, type Component, type Id, type Snapshot } from '@loom/ir';
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
  /** Components hidden while designing. Editor-only; never reaches the compiler. */
  hidden?: ReadonlySet<Id>;
  /** True when the parent holds its children where they were put rather than arranging them. */
  placed?: boolean;
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
  hidden,
  placed,
}: Props) {
  const component = snapshot.components[id];
  if (!component) return null;
  // Hidden while designing (S2): editor-only, and gone from the canvas rather than dimmed —
  // "hide" that still draws the thing is not hiding. The emitted app is untouched; the tree row
  // stays, so it can always be brought back.
  if (hidden?.has(id)) return null;

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
    // A click that does more than one thing says so here, so a sequence is never invisible from
    // the outside (`docs/specs/actions.md`).
    'data-steps': stepCount(component) > 1 ? String(stepCount(component)) : undefined,
  };

  // Inside a free frame a child sits where it was put — the same absolute placement the compiler
  // emits, so the canvas and the app agree about it (`docs/12-canvas.md`).
  const placement: CSSProperties = placed
    ? {
        position: 'absolute',
        left: Math.round(component.position?.x ?? 0),
        top: Math.round(component.position?.y ?? 0),
      }
    : {};
  const style = { ...(componentStyle(component) as CSSProperties), ...placement };
  const leafStyle = { ...(styleToCss(component) as CSSProperties), ...placement };

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

  // A shape draws itself, here as in the emitted app (`docs/12-canvas.md`). The paint comes from
  // the same style block the compiler reads, translated to SVG the same way — a canvas that drew
  // a plain box where the app draws an ellipse is the disagreement this file exists to prevent.
  if (component.type === 'Shape') {
    const kind = textContent(component, 'shape') || 'rectangle';
    const paint = leafStyle as { background?: string; border?: string; borderRadius?: string };
    const stroke = paint.border?.split(' ') ?? [];
    const strokeWidth = Number.parseFloat(stroke[0] ?? '0') || 0;
    const strokeColor = stroke.slice(2).join(' ') || undefined;
    const fill = kind === 'line' ? 'none' : (paint.background ?? 'var(--loom-color-brand-tint)');
    const inset = strokeWidth / 2;
    const shrink = (percent: number): string =>
      strokeWidth > 0 ? `calc(${percent}% - ${strokeWidth}px)` : `${percent}%`;

    return (
      <svg
        {...shared}
        ref={(node) => registerNode(id, node as unknown as HTMLElement | null)}
        style={{ ...style, display: 'block', overflow: 'visible', minHeight: undefined }}
      >
        {kind === 'ellipse' ? (
          <ellipse
            cx="50%"
            cy="50%"
            rx={strokeWidth > 0 ? `calc(50% - ${inset}px)` : '50%'}
            ry={strokeWidth > 0 ? `calc(50% - ${inset}px)` : '50%'}
            fill={fill}
            stroke={strokeColor}
            strokeWidth={strokeWidth || undefined}
          />
        ) : kind === 'line' ? (
          <line
            x1="0"
            y1="0"
            x2="100%"
            y2="100%"
            fill="none"
            stroke={strokeColor ?? 'var(--loom-color-ink)'}
            strokeWidth={strokeWidth || 2}
            strokeLinecap="round"
          />
        ) : (
          <rect
            x={inset}
            y={inset}
            width={shrink(100)}
            height={shrink(100)}
            rx={paint.borderRadius}
            fill={fill}
            stroke={strokeColor}
            strokeWidth={strokeWidth || undefined}
          />
        )}
      </svg>
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
          placed={component.layout?.mode === 'free'}
          hidden={hidden}
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

/** How many actions a component's click runs. One or none is not worth marking. */
function stepCount(component: Component): number {
  const onClick = component.props.onClick;
  return onClick?.kind === 'event' ? actionsOf(onClick.handler).length : 0;
}
