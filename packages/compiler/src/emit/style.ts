import type { Component, Style, StyleValue } from '@loom/ir';
import { tokenById, tokenVar } from '@loom/ui';
import { CompileError, type EmitContext } from '../types';
import { layoutToStyle } from './layout';
import { styleExpr, styleObject } from './text';

/**
 * Style emission: a component's styled properties become CSS, in the app's own token variables.
 *
 * A token reference emits `var(--loom-color-brand)` rather than the colour it currently resolves
 * to. That is the difference between a design system and a pile of hex codes — restyling a
 * project is one `:root` change, and the emitted code says *why* a surface is that colour
 * (`docs/05-guardrails.md` 19-24).
 */

const ALIGN: Record<NonNullable<Style['align']>, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
};

/** One styled property as a CSS value. */
export function styleValueCss(value: StyleValue, componentId: string, key: string): string {
  if (value.kind === 'literal') return value.value;

  // A token that no longer exists would emit an undefined custom property, which renders as
  // nothing at all — a silent blank is worse than a build error naming the property.
  if (!tokenById(value.token)) {
    throw new CompileError(
      `"${key}" uses token "${value.token}", which is not in the design system.`,
      componentId,
    );
  }
  return tokenVar(value.token);
}

/** The CSS a component's `style` block produces, on its own. */
export function styleToCss(component: Component): Record<string, string | number> {
  const style = component.style;
  if (!style) return {};

  const css: Record<string, string | number> = {};
  const put = (property: string, value: StyleValue | undefined, key: string): void => {
    if (value) css[property] = styleValueCss(value, component.id, key);
  };

  put('background', style.background, 'background');
  put('color', style.textColor, 'textColor');
  put('fontSize', style.fontSize, 'fontSize');
  put('fontWeight', style.fontWeight, 'fontWeight');
  put('borderRadius', style.radius, 'radius');
  put('boxShadow', style.shadow, 'shadow');

  // A colour with no width draws nothing, and a width with no colour draws the browser's default
  // grey. Either one alone is a mistake worth completing rather than emitting half of.
  if (style.borderColor || style.borderWidth) {
    const width = style.borderWidth ?? 1;
    const color = style.borderColor
      ? styleValueCss(style.borderColor, component.id, 'borderColor')
      : tokenVar('color.hairline');
    css.border = `${width}px solid ${color}`;
  }

  if (style.align) {
    css.textAlign = style.align;
    // A frame aligns its children; a leaf aligns its text. Emitting both is what makes the one
    // control behave the way a designer expects on either.
    if (component.layout) css.alignItems = ALIGN[style.align];
  }

  return css;
}

/** Layout and style together, in that order, so style always wins a collision. */
export function componentStyle(component: Component): Record<string, string | number> {
  const layout = component.layout ? layoutToStyle(component.layout) : {};
  return { ...layout, ...styleToCss(component) };
}

/**
 * The `style={{…}}` attribute for a component, conditional overrides included.
 *
 * Overrides spread over the base **in order**, so two conditions can set two different properties
 * without fighting — the same rule CSS itself uses, which is what a designer already expects.
 */
export function styleAttr(
  component: Component,
  ctx: EmitContext,
  base: Record<string, string | number> = {},
): string {
  // Position last: where the parent puts this is not something the component's own style block
  // gets to argue with.
  const own = { ...base, ...styleToCss(component), ...ctx.positionStyle(component) };
  const conditionals = component.conditionalStyles ?? [];

  if (conditionals.length === 0) {
    return Object.keys(own).length > 0 ? ` style=${styleExpr(own)}` : '';
  }

  const spreads = conditionals.map((entry) => {
    const css = styleToCss({ ...component, style: entry.style, conditionalStyles: undefined });
    return `...(${ctx.conditionExpr(entry.when, component.id)} ? ${styleObject(css)} : {})`;
  });

  const baseLiteral = styleObject(own);
  const parts = baseLiteral === '{}' ? spreads : [baseLiteral.slice(2, -2), ...spreads];
  return ` style={{ ${parts.join(', ')} }}`;
}
