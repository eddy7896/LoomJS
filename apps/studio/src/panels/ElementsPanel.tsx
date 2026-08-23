import { useMemo, useState } from 'react';
import {
  COMPONENT_CATEGORIES,
  NODE_GROUPS,
  componentDefs,
  nodeDefs,
  type ComponentDef,
  type NodeDef,
} from '@loom/components';
import { useEditor } from '../state/useEditor';
import { addComponent } from '../state/store';
import { addBodyStep, addGlobalNode, addGraphNode } from '../state/graph';

/**
 * The element palette (S0/S1, `docs/11-editor-shell.md`).
 *
 * It replaces a row of buttons in the top toolbar, which stopped working somewhere around the
 * sixth component and would not have survived the Table, Searchbox and auth elements already
 * planned. Everything here is **generated from the vocabulary** — adding an element is one entry
 * in `defs.ts`, and it appears in the right section, findable by search, with no change here.
 */

interface Entry {
  key: string;
  label: string;
  haystack: string;
  hint?: string;
  onAdd: () => void;
}

const COLLAPSED_KEY = 'loom.palette.collapsed';

function readCollapsed(): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(COLLAPSED_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    // A browser refusing storage should cost a preference, never the editor.
    return {};
  }
}

function writeCollapsed(value: Record<string, boolean>): void {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(value));
  } catch {
    /* see readCollapsed */
  }
}

/** Label plus the words this control is called in other tools, lowercased once. */
const haystackOf = (label: string, keywords: readonly string[] = []): string =>
  [label, ...keywords].join(' ').toLowerCase();

function Section({
  title,
  entries,
  open,
  onToggle,
}: {
  title: string;
  entries: Entry[];
  open: boolean;
  onToggle: () => void;
}) {
  if (entries.length === 0) return null;

  return (
    <section className="palette__section">
      <button
        className="palette__head"
        aria-expanded={open}
        data-testid={`palette-section-${title.toLowerCase().replace(/\s+/g, '-')}`}
        onClick={onToggle}
      >
        <span className="palette__caret">{open ? '▾' : '▸'}</span>
        {title}
      </button>

      {open
        ? entries.map((entry) => (
            <button
              key={entry.key}
              className="palette__item"
              title={entry.hint}
              onClick={entry.onAdd}
            >
              + {entry.label}
            </button>
          ))
        : null}
    </section>
  );
}

export function ElementsPanel() {
  const mode = useEditor((s) => s.mode);
  const snapshot = useEditor((s) => s.snapshot);
  const selection = useEditor((s) => s.selection);
  const [query, setQuery] = useState('');
  // Which sections you keep shut is a preference, not project data: it belongs to the browser,
  // never to the snapshot. Losing it on every reload made the setting not worth having.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(readCollapsed);

  // A function node added while an API route is selected goes *into* its body — the server side.
  const containerId =
    selection?.kind === 'node' && snapshot.nodes[selection.id]?.category === 'api'
      ? selection.id
      : undefined;

  const sections = useMemo(() => {
    if (mode === 'design') {
      return COMPONENT_CATEGORIES.map((category) => ({
        title: category.label,
        entries: componentDefs()
          .filter((def: ComponentDef) => def.category === category.id)
          .map((def) => ({
            key: def.type,
            label: def.label,
            haystack: haystackOf(def.label, def.keywords),
            onAdd: () => addComponent(def.type),
          })),
      }));
    }

    const grouped = NODE_GROUPS.map((group) => ({
      title: group.label,
      entries: nodeDefs()
        .filter((def: NodeDef) => def.group === group.id)
        .map((def) => ({
          key: `${def.category}:${def.kind}`,
          label: def.label,
          haystack: haystackOf(def.label, def.keywords),
          hint:
            def.category === 'fn' && containerId
              ? 'Adds a step inside the selected API route'
              : undefined,
          onAdd: () =>
            def.category === 'fn' && containerId
              ? addBodyStep(containerId, def.kind)
              : addGraphNode(def.category, def.kind),
        })),
    }));

    // A global is the same node with a wider scope, but a designer looking for "one value every
    // screen shares" is looking for an entry in the palette, not a dropdown.
    const values = grouped.find((group) => group.title === 'Values');
    values?.entries.push({
      key: 'state:global',
      label: 'Global',
      haystack: haystackOf('Global', ['shared', 'app-wide', 'every screen']),
      hint: 'A variable every screen shares',
      onAdd: () => void addGlobalNode(),
    });

    return grouped;
  }, [mode, containerId]);

  const needle = query.trim().toLowerCase();
  const filtered = sections.map((section) => ({
    ...section,
    entries: needle
      ? section.entries.filter((entry) => entry.haystack.includes(needle))
      : section.entries,
  }));
  const found = filtered.reduce((total, section) => total + section.entries.length, 0);

  return (
    <aside className="panel palette" data-testid="elements-panel">
      <input
        className="palette__search"
        data-testid="palette-search"
        value={query}
        placeholder={mode === 'design' ? 'Search elements' : 'Search nodes'}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          // Enter places the top hit. Searching for a thing and then having to aim at it is the
          // half of "search" that does not save anyone time.
          if (event.key !== 'Enter') return;
          const first = filtered.flatMap((section) => section.entries)[0];
          if (!first) return;
          event.preventDefault();
          first.onAdd();
          setQuery('');
        }}
      />

      {found === 0 ? <p className="panel__hint">Nothing matches “{query}”.</p> : null}

      {filtered.map((section) => (
        <Section
          key={section.title}
          title={section.title}
          entries={section.entries}
          // A search that left sections shut would hide its own results.
          open={Boolean(needle) || !collapsed[section.title]}
          onToggle={() =>
            setCollapsed((current) => {
              const next = { ...current, [section.title]: !current[section.title] };
              writeCollapsed(next);
              return next;
            })
          }
        />
      ))}

    </aside>
  );
}
