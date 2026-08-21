/**
 * loom's design tokens — the vocabulary every generated app and the studio itself are styled in.
 *
 * A token is a **named decision**, not a value a designer types. That is the whole point: pick
 * `brand` and every surface using it moves together when the brand moves, and nothing in the
 * document records `#ec3013` in twelve places (`docs/05-guardrails.md` 19-24).
 *
 * The set is deliberately small and functional. Colour is functional — a category, a surface, a
 * state — never decorative, so there is no `blue-400` here to reach for.
 */

export type TokenGroup = 'color' | 'space' | 'radius' | 'text' | 'weight' | 'shadow';

export interface TokenDef {
  /** Stable id used in the document and emitted as `--loom-<id>`. */
  id: string;
  group: TokenGroup;
  label: string;
  /** The default value. A project may override it; the id never changes. */
  value: string;
}

const token = (group: TokenGroup, id: string, label: string, value: string): TokenDef => ({
  id,
  group,
  label,
  value,
});

/** Brand and surface colours, from `docs/Design System/DesignDoc.html`. */
const COLORS: TokenDef[] = [
  token('color', 'color.brand', 'Brand', '#ec3013'),
  token('color', 'color.brand-tint', 'Brand tint', '#fdece8'),
  token('color', 'color.ink', 'Ink', '#1b1d21'),
  token('color', 'color.muted', 'Muted', '#868d97'),
  token('color', 'color.surface', 'Surface', '#ffffff'),
  token('color', 'color.canvas', 'Canvas', '#f6f7f9'),
  token('color', 'color.hairline', 'Hairline', '#e8eaee'),
  token('color', 'color.ok', 'Ok', '#12a07a'),
  token('color', 'color.warn', 'Warn', '#d98a12'),
  token('color', 'color.danger', 'Danger', '#ec3013'),
  token('color', 'color.transparent', 'None', 'transparent'),
];

/** One spacing scale, used for gap and padding alike, so rhythm stays consistent. */
const SPACE: TokenDef[] = [
  token('space', 'space.0', 'None', '0px'),
  token('space', 'space.1', 'XS', '4px'),
  token('space', 'space.2', 'S', '8px'),
  token('space', 'space.3', 'M', '16px'),
  token('space', 'space.4', 'L', '24px'),
  token('space', 'space.5', 'XL', '40px'),
];

const RADIUS: TokenDef[] = [
  token('radius', 'radius.none', 'Square', '0px'),
  token('radius', 'radius.sm', 'Small', '6px'),
  token('radius', 'radius.md', 'Medium', '10px'),
  token('radius', 'radius.lg', 'Large', '14px'),
  token('radius', 'radius.pill', 'Pill', '999px'),
];

const TEXT: TokenDef[] = [
  token('text', 'text.xs', 'Caption', '11px'),
  token('text', 'text.sm', 'Small', '13px'),
  token('text', 'text.md', 'Body', '15px'),
  token('text', 'text.lg', 'Subhead', '20px'),
  token('text', 'text.xl', 'Title', '28px'),
  token('text', 'text.xxl', 'Display', '40px'),
];

const WEIGHT: TokenDef[] = [
  token('weight', 'weight.regular', 'Regular', '400'),
  token('weight', 'weight.medium', 'Medium', '500'),
  token('weight', 'weight.bold', 'Bold', '700'),
];

const SHADOW: TokenDef[] = [
  token('shadow', 'shadow.none', 'None', 'none'),
  token('shadow', 'shadow.sm', 'Soft', '0 1px 2px rgba(20, 22, 26, 0.08)'),
  token('shadow', 'shadow.md', 'Lifted', '0 8px 24px rgba(20, 22, 26, 0.10)'),
];

export const TOKENS: readonly TokenDef[] = [
  ...COLORS,
  ...SPACE,
  ...RADIUS,
  ...TEXT,
  ...WEIGHT,
  ...SHADOW,
];

const BY_ID = new Map(TOKENS.map((entry) => [entry.id, entry]));

export function tokenById(id: string): TokenDef | undefined {
  return BY_ID.get(id);
}

export function tokensIn(group: TokenGroup): TokenDef[] {
  return TOKENS.filter((entry) => entry.group === group);
}

/** `color.brand` -> `--loom-color-brand`. Stable, so overriding one is a one-line change. */
export function cssVarName(id: string): string {
  return `--loom-${id.replace(/\./g, '-')}`;
}

/** The type faces. Archivo for interface, JetBrains Mono for code, values and types. */
export const FONTS = {
  body: "'Archivo', system-ui, -apple-system, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, Menlo, monospace",
} as const;

/** The stylesheet link a generated app needs for those faces. */
export const FONT_STYLESHEET =
  'https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;700&family=JetBrains+Mono:wght@400;500&display=swap';
