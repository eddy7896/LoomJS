/**
 * The icon set.
 *
 * Twelve shapes, drawn as SVG path data, shipped as strings. Not an icon *font* and not a package:
 * a dependency whose whole job is to draw twenty shapes is one the emitted app should not carry,
 * and a font brings a network request, a flash of missing glyphs and an accessibility problem with
 * it. The compiler inlines the path; the app ships one `<svg>` and nothing else.
 *
 * Every shape is drawn on a 24×24 grid with a 1.6 stroke and no fill, so they sit together at any
 * size. Adding one is a line here — but the same bar applies as everywhere else: a set that grows
 * to two hundred is a set nobody can choose from.
 */

export const ICONS = {
  check: 'M4 12.5l5 5L20 6.5',
  close: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM16 16l4.5 4.5',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20c0-3.3 3.6-5 8-5s8 1.7 8 5',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 11a2 2 0 1 1 0 4 1.7 1.7 0 0 0-1.6 1z',
  trash: 'M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6',
  edit: 'M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3z',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  arrowLeft: 'M19 12H5M11 18l-6-6 6-6',
  chevronDown: 'M6 9l6 6 6-6',
  calendar: 'M4 7h16v13H4zM4 11h16M8 3v4M16 3v4',
  mail: 'M3 6h18v12H3zM3 6l9 7 9-7',
  heart: 'M12 20s-7-4.4-7-9.2A4 4 0 0 1 12 8a4 4 0 0 1 7 2.8C19 15.6 12 20 12 20z',
  star: 'M12 4l2.5 5.2 5.5.8-4 3.9 1 5.6-5-2.7-5 2.7 1-5.6-4-3.9 5.5-.8z',
} as const satisfies Record<string, string>;

export type IconName = keyof typeof ICONS;

/** Stable order for the inspector's picker; alphabetical, so a name can be found by scanning. */
export const ICON_NAMES: readonly IconName[] = (Object.keys(ICONS) as IconName[]).sort();

/** The path for a name, falling back rather than emitting an empty `<svg>`. */
export function iconPath(name: string): string {
  return ICONS[name as IconName] ?? ICONS.check;
}
