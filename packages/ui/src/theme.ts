import { cssVarName, FONTS, TOKENS, tokenById } from './tokens';

/**
 * A **theme** is the token set with a project's overrides applied.
 *
 * Overrides are keyed by token id, so a project that moves its brand colour changes one entry and
 * every surface built on `color.brand` follows. That is the difference between a design system
 * and a pile of hex codes, and it is why the document stores token *ids* rather than values.
 */

export type ThemeOverrides = Record<string, string>;

export interface ResolvedToken {
  id: string;
  value: string;
  /** True when the project changed it from loom's default. */
  overridden: boolean;
}

export function resolveTheme(overrides: ThemeOverrides = {}): ResolvedToken[] {
  return TOKENS.map((entry) => {
    const override = overrides[entry.id];
    // An override naming a token nobody defined is ignored rather than emitted: an unknown
    // custom property would silently render as nothing.
    return {
      id: entry.id,
      value: override && override.trim() ? override.trim() : entry.value,
      overridden: Boolean(override && override.trim() && override.trim() !== entry.value),
    };
  });
}

/** The value a token resolves to under a set of overrides. */
export function tokenValue(id: string, overrides: ThemeOverrides = {}): string | undefined {
  const override = overrides[id];
  if (override && override.trim()) return override.trim();
  return tokenById(id)?.value;
}

/** `var(--loom-color-brand)` — what a style property actually emits. */
export function tokenVar(id: string): string {
  return `var(${cssVarName(id)})`;
}

/**
 * The `:root` block, as text. Emitted into the generated app's stylesheet and injected into the
 * studio, so both are styled from one source and cannot drift.
 */
export function themeCss(overrides: ThemeOverrides = {}): string {
  const lines = resolveTheme(overrides).map(
    (entry) => `  ${cssVarName(entry.id)}: ${entry.value};`,
  );
  lines.push(`  --loom-font-body: ${FONTS.body};`);
  lines.push(`  --loom-font-mono: ${FONTS.mono};`);
  return `:root {\n${lines.join('\n')}\n}\n`;
}

/** The same values as a style object, for the canvas, which renders real DOM rather than CSS. */
export function themeStyle(overrides: ThemeOverrides = {}): Record<string, string> {
  const style: Record<string, string> = {};
  for (const entry of resolveTheme(overrides)) style[cssVarName(entry.id)] = entry.value;
  style['--loom-font-body'] = FONTS.body;
  style['--loom-font-mono'] = FONTS.mono;
  return style;
}
