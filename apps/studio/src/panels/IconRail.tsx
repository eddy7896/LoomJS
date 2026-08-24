import { useEditor } from '../state/useEditor';
import { setRail, type Rail } from '../state/store';

/**
 * The icon rail (S0, `docs/11-editor-shell.md`).
 *
 * Four sections: Design, Nodes, Data, Logs. Bubble's rail also carries Code, API and Settings,
 * and drawing those greyed out would promise things that do not exist — a rail that lies is worse
 * than a short rail. They arrive when they have something behind them, which is exactly how Logs
 * arrived (`docs/23-logs.md`).
 *
 * Icons are inline SVG rather than a font or a package: the studio ships no icon dependency, and
 * four paths do not justify one.
 */

const ICONS: Record<Rail, JSX.Element> = {
  // A page with a frame on it — the screen you are drawing.
  design: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M7 8h10M7 12h6" />
    </>
  ),
  // Two boxes and a wire — the graph.
  nodes: (
    <>
      <rect x="2.5" y="4" width="7" height="6" rx="1.5" />
      <rect x="14.5" y="14" width="7" height="6" rx="1.5" />
      <path d="M9.5 7h3a2 2 0 0 1 2 2v6" />
    </>
  ),
  // Lines of text, longest first — what was said, in order.
  logs: (
    <>
      <path d="M4 7h16M4 12h11M4 17h7" />
    </>
  ),
  // A stack of discs — the database.
  data: (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
      <path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
    </>
  ),
};

const SECTIONS: readonly { id: Rail; label: string; hint: string }[] = [
  { id: 'design', label: 'Design', hint: 'Screens and what is on them' },
  { id: 'nodes', label: 'Nodes', hint: 'The graph behind the screens' },
  { id: 'data', label: 'Data', hint: 'Connections and tables' },
  { id: 'logs', label: 'Logs', hint: 'What the running app says' },
];

export function IconRail() {
  const rail = useEditor((s) => s.rail);

  return (
    <nav className="rail-icons" aria-label="Sections">
      {SECTIONS.map((section) => (
        <button
          key={section.id}
          className={rail === section.id ? 'is-active' : ''}
          // The accessible name is the word, not the icon: this is how the section is referred to
          // everywhere else in the editor, and how a screen reader should announce it.
          aria-label={section.label}
          aria-pressed={rail === section.id}
          title={`${section.label} — ${section.hint}`}
          data-testid={`rail-${section.id}`}
          onClick={() => setRail(section.id)}
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {ICONS[section.id]}
          </svg>
        </button>
      ))}
    </nav>
  );
}
