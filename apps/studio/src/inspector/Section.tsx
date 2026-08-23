import { useState, type ReactNode } from 'react';

/**
 * A section of the inspector (`docs/13-inspector.md`).
 *
 * The panel is long — a component carries position, layout, appearance, fill, stroke, behaviour —
 * and a long panel is only usable if it is *divided*. So every group is a titled, collapsible
 * section with a thin rule above it, and what a designer collapses stays collapsed: the panel
 * settles into the shape of the work rather than resetting on every selection.
 *
 * The `add` slot is the small control on the right of a header — the one that turns "Stroke" from
 * a label into somewhere a stroke can be put.
 */

const STORAGE_KEY = 'loom.inspector.collapsed';

function loadCollapsed(): Set<string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

let collapsed = loadCollapsed();
const listeners = new Set<() => void>();

function toggle(name: string): void {
  const next = new Set(collapsed);
  if (next.has(name)) next.delete(name);
  else next.add(name);
  collapsed = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
  } catch {
    /* remembering is a convenience, not a requirement */
  }
  for (const listener of listeners) listener();
}

export function Section({
  name,
  children,
  add,
  hint,
}: {
  /** The title, and the key this section is remembered by. */
  name: string;
  children: ReactNode;
  /** The control on the right of the header, if this section has something to add. */
  add?: ReactNode;
  hint?: string;
}) {
  const [, force] = useState(0);
  useState(() => {
    const listener = (): void => force((n) => n + 1);
    listeners.add(listener);
    return () => listeners.delete(listener);
  });

  const isClosed = collapsed.has(name);
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  return (
    <section className={`ins ${isClosed ? 'is-closed' : ''}`} data-testid={`section-${id}`}>
      <header className="ins__head">
        <button
          className="ins__title"
          data-testid={`section-${id}-toggle`}
          aria-expanded={!isClosed}
          onClick={() => toggle(name)}
        >
          {name}
        </button>
        {add ? <span className="ins__actions">{add}</span> : null}
      </header>
      {isClosed ? null : (
        <div className="ins__body">
          {children}
          {hint ? <p className="panel__hint">{hint}</p> : null}
        </div>
      )}
    </section>
  );
}

/** A row of controls with no label of its own — Figma's dense pairs, in loom's own surface. */
export function Row({ children }: { children: ReactNode }) {
  return <div className="ins__row">{children}</div>;
}

/** A small control with an icon or letter in front of it: `X 0`, `W 382`. */
export function Cell({
  mark,
  title,
  children,
}: {
  mark: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <label className="ins__cell" title={title}>
      <span className="ins__mark">{mark}</span>
      {children}
    </label>
  );
}

/** One of a set of mutually exclusive choices, drawn as a segmented control. */
export function Choice({
  active,
  title,
  testId,
  onPick,
  children,
}: {
  active: boolean;
  title: string;
  testId: string;
  onPick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      className={`ins__choice ${active ? 'is-active' : ''}`}
      title={title}
      aria-label={title}
      aria-pressed={active}
      data-testid={testId}
      onClick={onPick}
    >
      {children}
    </button>
  );
}

/** Drawn at 16 on a 24 grid so a row of them sits on the pixel grid. */
export function Glyph({ path, filled }: { path: string; filled?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <path
        d={path}
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
