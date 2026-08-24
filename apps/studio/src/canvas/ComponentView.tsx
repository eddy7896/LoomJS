import { useCallback, type CSSProperties, type PointerEvent } from 'react';
import { actionsOf, type Component, type Id, type Snapshot } from '@loom/ir';
import { componentStyle, layoutSizeStyle, styleToCss } from '@loom/compiler';
import { variantClassName, iconPath } from '@loom/components';
import { extendSelection } from '../state/store';
import { ChartPreview } from './ChartPreview';

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
    /**
     * The variant classes, from the **same** function the compiler calls (`docs/27-variants.md`).
     *
     * This is the whole reason the canvas and the running app agree about what an outline button
     * looks like: not two implementations kept in step by discipline, but one answer used twice.
     */
    className: variantClassName(component),
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
  // A leaf carries the size it was drawn at and nothing else about layout — the same rule the
  // compiler follows, so a resized element is the same shape here as in the running app.
  const leafStyle = {
    ...(layoutSizeStyle(component.layout) as CSSProperties),
    ...(styleToCss(component) as CSSProperties),
    ...placement,
  };

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
      <label {...shared} ref={attach} style={leafStyle}>
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
          <label key={option}>
            <input type="radio" readOnly checked={index === 0} name={component.id} />
            <span>{option}</span>
          </label>
        ))}
      </fieldset>
    );
  }

  /**
   * The upload fields (`docs/29-storage.md`).
   *
   * Drawn as they will look before anybody has chosen a file, which is the state a designer is
   * arranging for. The input is present but never armed here: opening a file picker because
   * somebody clicked an element they were trying to select is the tool getting in the way.
   */
  if (component.type === 'FileField' || component.type === 'ImageField') {
    const value = textContent(component, 'value');
    const label = textContent(component, 'label') || 'Choose a file';
    return (
      <div {...shared} ref={attach} style={leafStyle}>
        <span className="loom-upload__pick">{label}</span>
        {component.type === 'ImageField' && value ? (
          <img className="loom-upload__preview" src={value} alt="" />
        ) : null}
        {/* Where it lands, said on the canvas: a field pointing at no bucket is the one mistake
            here that only shows up as a refusal at build time. */}
        {!textContent(component, 'bucket') ? (
          <span className="canvas-placeholder__note">No bucket</span>
        ) : null}
      </div>
    );
  }

  /**
   * Charts, drawn with sample data (`docs/30-charts.md`).
   *
   * There is no data in the editor — the rows arrive from a query when the app runs — so the canvas
   * shows a made-up series rather than an empty box. The same honesty as a Table's ghost rows: the
   * size, the shape and the colour are real, and the numbers are openly not.
   */
  if (
    component.type === 'BarChart' ||
    component.type === 'LineChart' ||
    component.type === 'PieChart'
  ) {
    return (
      <div {...shared} ref={attach} style={{ minWidth: 160, minHeight: 100, ...style }}>
        <ChartPreview component={component} />
      </div>
    );
  }

  if (component.type === 'Stat') {
    const raw = textContent(component, 'value');
    return (
      <div {...shared} ref={attach} style={leafStyle}>
        <span className="loom-stat__label">{textContent(component, 'label') || 'Total'}</span>
        {/* A bound value has nothing to show yet, so the canvas shows a plausible one rather than
            an empty space where the number will be. */}
        <span className="loom-stat__value">{raw || '1,248'}</span>
        {textContent(component, 'note') ? (
          <span className="loom-stat__note">{textContent(component, 'note')}</span>
        ) : null}
      </div>
    );
  }

  /**
   * A calendar on the canvas: this month, with no events on it.
   *
   * The grid is the thing being arranged, and it is real — the same six rows the app draws. What is
   * missing is the data, which is missing in the editor for every element that reads rows.
   */
  if (component.type === 'Calendar') {
    const agenda = textContent(component, 'variant') === 'agenda';
    const monday = textContent(component, 'weekStart') !== 'sunday';
    const weekdays = monday
      ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
      : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const offset = monday ? (first.getDay() + 6) % 7 : first.getDay();
    const start = new Date(now.getFullYear(), now.getMonth(), 1 - offset);

    return (
      <div {...shared} ref={attach} style={{ minWidth: 220, minHeight: 200, ...style }}>
        {agenda ? (
          <span className="loom-calendar__empty">
            {textContent(component, 'empty') || 'Nothing yet'}
          </span>
        ) : (
          <>
            <div className="loom-calendar__head">
              <span className="loom-calendar__step">{'\u2039'}</span>
              <span className="loom-calendar__month">
                {first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
              </span>
              <span className="loom-calendar__step">{'\u203a'}</span>
            </div>
            <div className="loom-calendar__grid">
              {weekdays.map((name) => (
                <span key={name} className="loom-calendar__weekday">
                  {name}
                </span>
              ))}
              {Array.from({ length: 42 }, (_unused, index) => {
                const date = new Date(
                  start.getFullYear(),
                  start.getMonth(),
                  start.getDate() + index,
                );
                const outside = date.getMonth() !== now.getMonth();
                const today = date.toDateString() === now.toDateString();
                return (
                  <div
                    key={index}
                    className={`loom-calendar__day${outside ? ' is-outside' : ''}${
                      today ? ' is-today' : ''
                    }`}
                  >
                    <span className="loom-calendar__date">{date.getDate()}</span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  }

  /**
   * A chat on the canvas: the composer, which is what a designer is arranging, and a note where the
   * messages will be. Inventing sample messages would put words on the artboard that no query will
   * ever produce.
   */
  if (component.type === 'Chat') {
    return (
      <div {...shared} ref={attach} style={{ minWidth: 200, minHeight: 160, ...style }}>
        <div className="loom-chat__log">
          <span className="loom-chat__empty">
            {textContent(component, 'empty') || 'No messages yet'}
          </span>
        </div>
        <div className="loom-chat__compose">
          <span className="loom-chat__draft">
            {textContent(component, 'placeholder') || 'Write a message'}
          </span>
          <span className="loom-chat__send">{textContent(component, 'sendLabel') || 'Send'}</span>
        </div>
      </div>
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
          className={`canvas-placeholder ${variantClassName(component) ?? ''}`.trim()}
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

  /**
   * Media (`docs/28-media.md`).
   *
   * The canvas draws the real elements — a `<video>` is a video, an `<audio>` is a player — because
   * a designer judging whether a player fits a layout needs the box it will actually occupy, and a
   * grey rectangle standing in for one is a different size every time.
   *
   * What it does *not* do is play them. The canvas is a picture of the app: sound starting while
   * somebody is arranging a screen is the tool interrupting the work.
   */
  if (component.type === 'Video') {
    const src = textContent(component, 'src');
    const poster = textContent(component, 'poster');
    if (!src && !poster) {
      return (
        <div
          {...shared}
          ref={attach}
          className={`canvas-placeholder ${variantClassName(component) ?? ''}`.trim()}
          style={{ minWidth: 160, minHeight: 90, ...style }}
        >
          Video
        </div>
      );
    }
    return (
      <video
        {...shared}
        ref={attach as unknown as (node: HTMLVideoElement | null) => void}
        src={src || undefined}
        poster={poster || undefined}
        controls={booleanProp(component, 'controls')}
        // Never armed here, whatever the document says: a screen full of elements that all start
        // playing when it is opened is not a canvas anybody can work in.
        autoPlay={false}
        muted
        preload="metadata"
        style={style}
      />
    );
  }

  if (component.type === 'Audio') {
    const src = textContent(component, 'src');
    return (
      <audio
        {...shared}
        ref={attach as unknown as (node: HTMLAudioElement | null) => void}
        src={src || undefined}
        controls={booleanProp(component, 'controls')}
        preload="none"
        style={style}
      />
    );
  }

  /**
   * A carousel draws its **first** picture, with the controls the app will have.
   *
   * The index is state that only exists in the running app, so the canvas shows where it starts.
   * Drawing every picture at once would be drawing something the app never renders — the same
   * mistake the List used to make with its extra children.
   */
  if (component.type === 'Carousel') {
    const slides = listOf(component, 'items');
    const first = slides[0];
    return (
      <div {...shared} ref={attach} style={{ minWidth: 120, minHeight: 80, ...style }}>
        {first ? (
          <img className="loom-carousel__slide" src={first} alt={textContent(component, 'alt')} />
        ) : (
          <span className="canvas-placeholder">Carousel</span>
        )}
        {slides.length > 1 ? (
          <>
            <span className="loom-carousel__step loom-carousel__step--back">{'\u2039'}</span>
            <span className="loom-carousel__step loom-carousel__step--next">{'\u203a'}</span>
          </>
        ) : null}
        {booleanProp(component, 'dots') && slides.length > 1 ? (
          <div className="loom-carousel__dots">
            {slides.map((slide, index) => (
              <span
                key={`${slide}-${index}`}
                className={index === 0 ? 'loom-carousel__dot is-on' : 'loom-carousel__dot'}
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  if (component.type === 'Avatar') {
    const size = numberProp(component, 'size', 40);
    const src = textContent(component, 'src');
    const name = textContent(component, 'name');
    const initials = name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0] ?? '')
      .join('')
      .toUpperCase();

    return (
      <span
        {...shared}
        ref={attach}
        style={{ ...style, width: size, height: size, fontSize: Math.round(size * 0.4) }}
      >
        {src ? (
          <img className="loom-avatar__image" src={src} alt={name} />
        ) : (
          <span>{initials}</span>
        )}
      </span>
    );
  }

  /**
   * An Embed is drawn as a labelled panel rather than as a live iframe.
   *
   * Loading someone else's page into the editor would run their scripts inside the studio, on every
   * render, for every embed on the screen — and none of that helps anyone judge a layout. The box
   * is the right size and says what is in it, which is the part that matters here.
   */
  if (component.type === 'Embed') {
    return (
      <div
        {...shared}
        ref={attach}
        className={`canvas-placeholder ${variantClassName(component) ?? ''}`.trim()}
        style={{ minWidth: 160, minHeight: 90, ...style }}
      >
        <span>{textContent(component, 'title') || 'Embed'}</span>
        <span className="canvas-placeholder__note">{textContent(component, 'src')}</span>
      </div>
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
        style={{ cursor: 'default', ...leafStyle }}
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
        <div
          {...shared}
          ref={attach}
          // Its own class *and* the variant one: a table with no columns yet still has the look a
          // designer picked for it, and a bare className after the spread would drop that.
          className={`canvas-placeholder ${variantClassName(component) ?? ''}`.trim()}
          style={leafStyle}
        >
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
                <th key={column} style={{ textAlign: 'left', padding: '6px 8px' }}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[0, 1].map((row) => (
              <tr key={row}>
                {columns.map((column) => (
                  <td key={column} style={{ padding: '6px 8px', opacity: 0.4 }}>
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

  /**
   * Tiles wrap by **width**, so the canvas has to lay them out the same way the app will.
   *
   * The generic container below is flex, which would put every child in one row and tell a designer
   * nothing about how the gallery behaves at the size they are drawing for.
   */
  const tiles =
    component.type === 'Tiles'
      ? {
          display: 'grid',
          gridTemplateColumns: `repeat(auto-fill, minmax(${Math.max(
            40,
            Math.trunc(numberProp(component, 'minWidth', 160)),
          )}px, 1fr))`,
          gap: `${Math.max(0, Math.trunc(numberProp(component, 'gap', 12)))}px`,
        }
      : {};

  return (
    <div
      {...shared}
      ref={attach}
      style={{
        ...style,
        ...tiles,
        minHeight: component.children?.length ? undefined : 48,
      }}
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
