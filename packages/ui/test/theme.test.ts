import { describe, expect, it } from 'vitest';
import { cssVarName, resolveTheme, themeCss, themeStyle, tokenById, TOKENS, tokensIn, tokenValue, tokenVar } from '../src/index';

/**
 * The token set is the design system's contract. What matters is that an id is stable and a
 * project override reaches everything built on it — that is the whole difference between a system
 * and a pile of hex codes.
 */
describe('tokens', () => {
  it('carries loom’s brand as a named decision, not a value to copy', () => {
    expect(tokenById('color.brand')?.value).toBe('#ec3013');
    expect(tokenById('color.ink')?.value).toBe('#1b1d21');
  });

  it('gives every token a unique id and a css custom property', () => {
    const ids = TOKENS.map((token) => token.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(cssVarName('color.brand')).toBe('--loom-color-brand');
    expect(tokenVar('radius.lg')).toBe('var(--loom-radius-lg)');
  });

  it('groups them so a control offers only what fits the property', () => {
    expect(tokensIn('radius').map((token) => token.id)).toContain('radius.pill');
    expect(tokensIn('color').every((token) => token.group === 'color')).toBe(true);
    expect(tokensIn('text')).not.toHaveLength(0);
  });
});

describe('a project theme', () => {
  it('defaults to loom’s values when nothing is overridden', () => {
    expect(tokenValue('color.brand')).toBe('#ec3013');
    expect(resolveTheme().every((entry) => !entry.overridden)).toBe(true);
  });

  it('moves everything built on a token when that token moves', () => {
    const theme = { 'color.brand': '#0055ff' };
    expect(tokenValue('color.brand', theme)).toBe('#0055ff');
    expect(themeCss(theme)).toContain('--loom-color-brand: #0055ff;');
    // Everything else stays where it was: an override is one decision, not a new palette.
    expect(themeCss(theme)).toContain('--loom-color-ink: #1b1d21;');
  });

  it('marks which tokens the project changed, so the panel can offer a reset', () => {
    const resolved = resolveTheme({ 'color.brand': '#0055ff' });
    expect(resolved.find((entry) => entry.id === 'color.brand')?.overridden).toBe(true);
    expect(resolved.find((entry) => entry.id === 'color.ink')?.overridden).toBe(false);
  });

  it('ignores a blank override rather than emitting an empty custom property', () => {
    expect(tokenValue('color.brand', { 'color.brand': '   ' })).toBe('#ec3013');
  });

  it('emits the type faces alongside the palette', () => {
    expect(themeCss()).toContain('--loom-font-body');
    expect(themeCss()).toContain('Archivo');
    expect(themeStyle()['--loom-font-mono']).toContain('JetBrains Mono');
  });
});
