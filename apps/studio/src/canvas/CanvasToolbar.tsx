import { useEffect, useRef, useState } from 'react';
import { componentDefs, COMPONENT_CATEGORIES } from '@loom/components';
import { useEditor } from '../state/useEditor';
import { setTool } from '../state/store';

/**
 * The floating toolbar (`docs/12-canvas.md` C1).
 *
 * It sits on the canvas, centred at the bottom, because that is where the hand already is. The
 * left rail still answers "what exists"; this answers "what am I drawing", and reaching across
 * the window to a column mid-gesture is exactly what it removes.
 *
 * Everything here is a **component type** — there are no editor-only tools. A rectangle is the
 * Shape element with its first field set, which is why the toolbar needs no vocabulary of its own.
 */

interface ToolDef {
  /** The store's tool string: a component type, with a variant after a colon. */
  tool: string;
  label: string;
  shortcut: string;
  path: string;
}

/** Drawn at 20x20 on a 24 grid, stroked, so they sit on the pixel grid at 1x. */
const TOOLS: readonly ToolDef[] = [
  { tool: 'move', label: 'Move', shortcut: 'V', path: 'M5 3l14 8-6 1.6L10.5 19z' },
  { tool: 'Frame', label: 'Frame', shortcut: 'F', path: 'M8 3v18M16 3v18M3 8h18M3 16h18' },
  { tool: 'Text', label: 'Text', shortcut: 'T', path: 'M5 6V4h14v2M12 4v16M9 20h6' },
  { tool: 'Shape:rectangle', label: 'Rectangle', shortcut: 'R', path: 'M4 5h16v14H4z' },
  { tool: 'Shape:ellipse', label: 'Ellipse', shortcut: 'O', path: 'M12 5a7 7 0 110 14 7 7 0 010-14z' },
  { tool: 'Shape:line', label: 'Line', shortcut: 'L', path: 'M5 19L19 5' },
  { tool: 'Image', label: 'Image', shortcut: 'I', path: 'M4 5h16v14H4zM4 15l4-4 5 5M14 12l2-2 4 4' },
];

function Icon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export function CanvasToolbar() {
  const tool = useEditor((s) => s.tool);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'SELECT' || target?.isContentEditable) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === 'Escape') {
        setOpen(false);
        setTool('move');
        return;
      }
      const match = TOOLS.find((entry) => entry.shortcut.toLowerCase() === event.key.toLowerCase());
      if (!match) return;
      event.preventDefault();
      setOpen(false);
      setTool(match.tool);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const query = search.trim().toLowerCase();
  const matches = componentDefs().filter(
    (def) =>
      !query ||
      def.label.toLowerCase().includes(query) ||
      (def.keywords ?? []).some((word) => word.includes(query)),
  );

  return (
    <div className="toolbelt" data-testid="toolbelt">
      {TOOLS.map((entry) => (
        <button
          key={entry.tool}
          className={`toolbelt__tool ${tool === entry.tool ? 'is-active' : ''}`}
          data-testid={`tool-${entry.tool}`}
          title={`${entry.label} — ${entry.shortcut}`}
          aria-label={entry.label}
          aria-pressed={tool === entry.tool}
          onClick={() => {
            setOpen(false);
            setTool(entry.tool);
          }}
        >
          <Icon path={entry.path} />
        </button>
      ))}

      <span className="toolbelt__split" />

      {/* The rest of the vocabulary, without leaving the canvas. */}
      <button
        className={`toolbelt__tool toolbelt__more ${open ? 'is-active' : ''}`}
        data-testid="tool-more"
        title="All elements"
        aria-label="All elements"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
          setSearch('');
          window.setTimeout(() => searchRef.current?.focus(), 0);
        }}
      >
        <Icon path="M4 6h16M4 12h16M4 18h16" />
      </button>

      {open ? (
        <div className="toolbelt__popover" data-testid="toolbelt-popover">
          <input
            ref={searchRef}
            className="toolbelt__search"
            data-testid="toolbelt-search"
            placeholder="Search elements"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setOpen(false);
              if (event.key !== 'Enter') return;
              const first = matches[0];
              if (!first) return;
              setTool(first.type);
              setOpen(false);
            }}
          />
          {COMPONENT_CATEGORIES.map((category) => {
            const inCategory = matches.filter((def) => def.category === category.id);
            if (inCategory.length === 0) return null;
            return (
              <div key={category.id} className="toolbelt__group">
                <span className="toolbelt__group-label">{category.label}</span>
                {inCategory.map((def) => (
                  <button
                    key={def.type}
                    data-testid={`toolbelt-${def.type}`}
                    onClick={() => {
                      setTool(def.type);
                      setOpen(false);
                    }}
                  >
                    {def.label}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
