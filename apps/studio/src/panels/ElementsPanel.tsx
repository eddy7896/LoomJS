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
import { startPaletteDrag, type PaletteDrag } from '../canvas/paletteDrag';
import { SSO_PROVIDERS } from '@loom/connectors';
import { connection } from '../state/connectors';

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
  /**
   * What dragging this entry onto the canvas places (`docs/19-sign-in-elements.md`).
   *
   * Clicking drops an element wherever the selection happens to be, which is right for the first
   * element on a screen and wrong for the fourth. Dragging says *where*. An entry with no payload
   * is one that is not a component — a node, a variable — and stays click-only.
   */
  drag?: PaletteDrag;
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
  note,
}: {
  title: string;
  entries: Entry[];
  open: boolean;
  onToggle: () => void;
  /** What has to be true before anything in this section works. */
  note?: string;
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

      {open && note ? <p className="panel__hint">{note}</p> : null}

      {open
        ? entries.map((entry) => (
            <button
              key={entry.key}
              className="palette__item"
              data-testid={`palette-${entry.key}`}
              title={entry.hint}
              // Click puts it where the selection is; drag says where. Both end in the same
              // placement (`docs/19-sign-in-elements.md`).
              draggable={Boolean(entry.drag)}
              onDragStart={(event) => {
                if (entry.drag) startPaletteDrag(event, entry.drag);
              }}
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
      const elements = COMPONENT_CATEGORIES.map((category) => ({
        title: category.label,
        entries: componentDefs()
          .filter((def: ComponentDef) => def.category === category.id)
          .map((def) => ({
            key: def.type,
            label: def.label,
            haystack: haystackOf(def.label, def.keywords),
            onAdd: () => addComponent(def.type),
            drag: { type: def.type },
          })),
      }));

      /**
       * Signing in (`docs/19-sign-in-elements.md`).
       *
       * A button per provider, arriving with its label and its action already set, because "a
       * button that signs in with Google" is the thing being asked for — placing a blank Button
       * and wiring it afterwards is the same thing in four steps.
       *
       * They are ordinary Buttons. Nothing here is a new component type, and everything about one
       * can be edited afterwards like any other.
       */
      return [
        ...elements,
        {
          title: 'Sign in',
          // Signing people in needs a connection, and finding that out from Problems after
          // placing three buttons is finding out late.
          note: connection(snapshot)
            ? undefined
            : 'These need a Supabase connection — connect one in Data.',
          entries: SSO_PROVIDERS.map((provider) => ({
            key: `signin-${provider.id}`,
            label: provider.label,
            haystack: haystackOf(provider.label, [
              'sign in',
              'log in',
              'oauth',
              'sso',
              'auth',
              provider.id,
            ]),
            hint: provider.note ?? `A button that signs in with ${provider.label}`,
            onAdd: () => addComponent('Button', { signInWith: provider.id }),
            drag: { type: 'Button', signInWith: provider.id },
          })),
        },
      ];
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
          note={'note' in section ? (section.note as string | undefined) : undefined}
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
