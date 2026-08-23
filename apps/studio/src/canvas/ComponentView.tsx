import { useCallback, type CSSProperties, type PointerEvent } from 'react';
import { actionsOf, type Component, type Id, type Snapshot } from '@loom/ir';
import { componentStyle, styleToCss } from '@loom/compiler';
import { iconPath } from '@loom/components';
import { extendSelection } from '../state/store';

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
  /** The rest of a multiple selection (G1). */
  alsoSelected: Id[];
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

  if (value?.kind === 'static') {
    // Anything a person typed, whatever type it ended up as. A boolean or a number that came back
    // as an empty string used to draw as nothing at all.
    if (value.value === undefined || value.value === null) return '';
    return String(value.value);
  }

  // These resolve at run time; the canvas shows the *source*, never a fake value. Drawing nothing
  // is what made a Text inside a List look like an empty box — it reads a column, and a column
  // has a name worth showing while the screen is being arranged.
  if (value?.kind === 'param') return `{${value.name}}`;
  if (value?.kind === 'item') return `{${value.field}}`;
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
  alsoSelected,
  hidden,
  placed,
}: Props) {
  const attach = useCallback(
    (node: HTMLElement | null) => registerNode(id, node),
    [id, registerNode],
  );
  const component = snapshot.components[id];
  if (!component) return null;
  // Hidden while designing (S2): editor-only, and gone from the canvas rather than dimmed —
  // "hide" that still draws the thing is not hiding. The emitted app is untouched; the tree row
  // stays, so it can always be brought back.
  if (hidden?.has(id)) return null;

  /**
   * One stable callback, so React attaches it once instead of detaching and re-attaching on every
   * render. An inline arrow here made the canvas hand the same node back constantly, which is the
   * kind of churn the selection overlay cannot tell from a real change.
   */
  const shared = {
    'data-loom-id': id,
    onClick: (event: React.MouseEvent) => {
      event.stopPropagation();
      // Shift adds to the selection rather than replacing it — the gesture every design tool
      // uses, and the one grouping needs to exist at all (G1).
      if (event.shiftKey) extendSelection(id);
      else onSelect(id);
    },
    onPointerDown: (event: PointerEvent) => onPointerDown(id, event),
    'data-dragging': draggingId === id ? 'true' : undefined,
    // Marked on the canvas too: a selection you can only see in the tree is one you lose track of.
    'data-also': alsoSelected.includes(id) ? 'true' : undefined,
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
        ref={attach}
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
        ref={attach}
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
        ref={attach}
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
        ref={attach as unknown as (node: SVGSVGElement | null) => void}
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
        ref={attach}
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
        ref={attach}
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

  if (component.type === 'MultilineField') {
    return (
      <textarea
        {...shared}
        ref={attach as unknown as (node: HTMLTextAreaElement | null) => void}
        readOnly
        rows={numberProp(component, 'rows', 4)}
        value={textContent(component, 'value')}
        placeholder={textContent(component, 'placeholder')}
        style={leafStyle}
      />
    );
  }

  if (component.type === 'DateField') {
    return (
      <input
        {...shared}
        ref={attach}
        type="date"
        readOnly
        value={textContent(component, 'value')}
        style={leafStyle}
      />
    );
  }

  if (component.type === 'Slider') {
    return (
      <input
        {...shared}
        ref={attach}
        type="range"
        readOnly
        value={numberProp(component, 'value', 0)}
        min={numberProp(component, 'min', 0)}
        max={numberProp(component, 'max', 100)}
        step={numberProp(component, 'step', 1)}
        style={leafStyle}
        onChange={() => undefined}
      />
    );
  }

  // A group of radios is a fieldset with a legend in the emitted app, and the legend is what makes
  // it read as one question. A canvas that drew loose circles would be judging a different thing.
  if (component.type === 'RadioGroup') {
    const options = listOf(component, 'options');
    const question = textContent(component, 'label');
    return (
      <fieldset {...shared} ref={attach} style={leafStyle}>
        {question ? <legend>{question}</legend> : null}
        {options.map((option, index) => (
          <label key={option} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="radio" readOnly checked={index === 0} name={component.id} />
            <span>{option}</span>
          </label>
        ))}
      </fieldset>
    );
  }

  if (component.type === 'Image') {
    const src = textContent(component, 'src');
    // A picture with no address yet is a *place* for one: an empty img is a broken icon, and a
    // designer arranging a page needs to see the box it will occupy.
    if (!src) {
      return (
        <div
          {...shared}
          ref={attach}
          className="canvas-placeholder"
          style={{ ...leafStyle, minWidth: 80, minHeight: 60 }}
        >
          {textContent(component, 'alt') || 'Image'}
        </div>
      );
    }
    return (
      <img
        {...shared}
        ref={attach as unknown as (node: HTMLImageElement | null) => void}
        src={src}
        alt={textContent(component, 'alt')}
        style={leafStyle}
      />
    );
  }

  if (component.type === 'Link') {
    return (
      <a
        {...shared}
        ref={attach as unknown as (node: HTMLAnchorElement | null) => void}
        // The canvas is a picture: following a link out of the editor is never what a click here
        // meant, so the address is drawn and not armed.
        href={undefined}
        style={{ cursor: 'default', textDecoration: 'underline', ...leafStyle }}
      >
        {textContent(component, 'label') || 'Link'}
      </a>
    );
  }

  if (component.type === 'Icon') {
    const size = numberProp(component, 'size', 20);
    return (
      <svg
        {...shared}
        ref={attach as unknown as (node: SVGSVGElement | null) => void}
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        style={leafStyle}
      >
        <path d={iconPath(textContent(component, 'name') || 'check')} />
      </svg>
    );
  }

  /**
   * A List renders its **first child** once per row, and nothing else — that is the implicit map
   * (`04-hallucination-check.md`: loops are never nodes).
   *
   * The canvas used to draw every child, so a List with three things in it looked like three
   * things and shipped as one. Now the first is drawn as the row it is, and anything after it is
   * drawn dimmed and labelled: still there, still selectable, still movable — and honest about
   * the fact that it will not appear in the app.
   */
  if (component.type === 'List') {
    const children = component.children ?? [];
    const [template, ...ignored] = children;

    return (
      <div {...shared} ref={attach} style={{ ...style, minHeight: children.length ? undefined : 48 }}>
        {template ? (
          <ComponentView
            placed={component.layout?.mode === 'free'}
            hidden={hidden}
            key={template}
            snapshot={snapshot}
            id={template}
            onSelect={onSelect}
            registerNode={registerNode}
            onPointerDown={onPointerDown}
            draggingId={draggingId}
            alsoSelected={alsoSelected}
          />
        ) : (
          <span className="canvas-placeholder">
            {textContent(component, 'empty') || 'Nothing yet'}
          </span>
        )}

        {ignored.length > 0 ? (
          <div className="canvas-ignored" data-testid="list-extras">
            <span className="canvas-ignored__note">
              Only the first element repeats — {ignored.length} below will not appear
            </span>
            {ignored.map((childId) => (
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
                alsoSelected={alsoSelected}
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  // A Table draws its columns and a couple of ruled rows. The rows are ghosts — the canvas has no
  // data, and inventing plausible values would be a screenshot of an app that does not exist —
  // but the columns are real, so the widths and the header a designer is judging are the ones
  // that will ship.
  if (component.type === 'Table') {
    const columns = listOf(component, 'columns');
    // No columns named yet. The app would work them out from the first row it receives, so the
    // canvas says that rather than drawing a header it cannot know.
    if (columns.length === 0) {
      return (
        <div {...shared} ref={attach} className="canvas-placeholder" style={leafStyle}>
          <span>{textContent(component, 'empty') || 'Nothing yet'}</span>
          <span className="canvas-placeholder__note">Columns come from the first row</span>
        </div>
      );
    }
    return (
      <div {...shared} ref={attach} style={leafStyle}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column}
                  style={{
                    textAlign: 'left',
                    padding: '6px 8px',
                    borderBottom: '1px solid #E8EAEE',
                  }}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[0, 1].map((row) => (
              <tr key={row}>
                {columns.map((column) => (
                  <td
                    key={column}
                    style={{ padding: '6px 8px', borderBottom: '1px solid #F1F2F5', opacity: 0.4 }}
                  >
                    —
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div
      {...shared}
      ref={attach}
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
          alsoSelected={alsoSelected}
        />
      ))}
    </div>
  );
}

/** A static number prop, falling back when it is bound or nonsense. */
function numberProp(component: Component, key: string, fallback: number): number {
  const value = component.props[key];
  if (value?.kind !== 'static') return fallback;
  const parsed = Number(value.value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** A comma-separated prop as a list — options, columns: the same shape the emitters read. */
function listOf(component: Component, key: string): string[] {
  return textContent(component, key)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** How many actions a component's click runs. One or none is not worth marking. */
function stepCount(component: Component): number {
  const onClick = component.props.onClick;
  return onClick?.kind === 'event' ? actionsOf(onClick.handler).length : 0;
}
