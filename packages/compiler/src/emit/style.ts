import type { Component, Effect, Style, StyleValue } from '@loom/ir';
import { tokenById, tokenVar } from '@loom/ui';
import { CompileError, type EmitContext } from '../types';
import { layoutSizeStyle, layoutToStyle } from './layout';
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

/**
 * Effects, as the CSS they are.
 *
 * Each one is a **composition** rather than a raw property: glass is a backdrop blur, a
 * translucent tint and the hairline that makes an edge visible against what shows through. They
 * are written out here so the emitted app carries ordinary CSS — no runtime, no library, nothing
 * to install — and several of the same kind stack in the order they were added.
 */
function effectsToCss(effects: readonly Effect[]): Record<string, string> {
  const css: Record<string, string> = {};
  const shadows: string[] = [];
  const filters: string[] = [];
  const backdrop: string[] = [];
  const layers: string[] = [];

  for (const effect of effects) {
    if (effect.kind === 'shadow') {
      const parts = [
        effect.inset ? 'inset' : '',
        `${effect.x}px`,
        `${effect.y}px`,
        `${effect.blur}px`,
        `${effect.spread}px`,
        effect.color,
      ].filter(Boolean);
      shadows.push(parts.join(' '));
      continue;
    }

    if (effect.kind === 'blur') {
      filters.push(`blur(${effect.radius}px)`);
      continue;
    }

    if (effect.kind === 'glass') {
      backdrop.push(`blur(${effect.blur}px)`);
      // The tint sits *over* the blur, so it has to be translucent or the blur is invisible.
      css.background = withAlpha(effect.tint, effect.opacity);
      // A frosted edge is what stops glass reading as a flat translucent rectangle.
      css.border = `1px solid ${withAlpha('#ffffff', 35)}`;
      continue;
    }

    // Grain, drawn by the browser from an SVG filter: no asset, no request, and it scales with
    // the box rather than tiling a bitmap.
    const turbulence = `<svg xmlns='http://www.w3.org/2000/svg'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='${(
      effect.scale / 100
    ).toFixed(2)}' numOctaves='3'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='${(
      effect.opacity / 100
    ).toFixed(2)}'/></svg>`;
    layers.push(`url("data:image/svg+xml,${turbulence.replace(/"/g, "'").replace(/#/g, '%23')}")`);
  }

  if (shadows.length > 0) css.boxShadow = shadows.join(', ');
  if (filters.length > 0) css.filter = filters.join(' ');
  if (backdrop.length > 0) css.backdropFilter = backdrop.join(' ');
  if (layers.length > 0) {
    css.backgroundImage = layers.join(', ');
    // Over the fill rather than instead of it.
    css.backgroundBlendMode = 'overlay';
  }
  return css;
}

/** `#1b1d21` at 35% -> `rgb(27 29 33 / 35%)`. Anything that is not a hex is passed through. */
function withAlpha(color: string, percent: number): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!hex) return color;
  const value = Number.parseInt(hex[1]!, 16);
  const rgb = [(value >> 16) & 255, (value >> 8) & 255, value & 255].join(' ');
  return `rgb(${rgb} / ${Math.round(percent)}%)`;
}

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

  // Per-object properties, straight through: no token scale stands behind "37%".
  if (style.opacity !== undefined && style.opacity < 100) css.opacity = style.opacity / 100;
  if (style.clip) css.overflow = 'hidden';

  // One transform for all of them, because they are one CSS property. Rotation and flipping are
  // painted rather than laid out — the box a thing occupies does not move, which is what makes
  // them safe in a frame that arranges its children.
  const transform = [
    style.rotation ? `rotate(${style.rotation}deg)` : '',
    style.flipX ? 'scaleX(-1)' : '',
    style.flipY ? 'scaleY(-1)' : '',
  ]
    .filter(Boolean)
    .join(' ');
  if (transform) css.transform = transform;

  // Effects last: a shadow a designer added should win over the shadow token they had before.
  if (style.effects && style.effects.length > 0) {
    Object.assign(css, effectsToCss(style.effects));
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
  /**
   * The drawn size first, so anything an emitter passes in — and the style block after it — still
   * wins. A container's emitter already includes its whole layout; this is what carries the size of
   * everything else, which used to be dropped on the floor.
   */
  const own = {
    ...layoutSizeStyle(component.layout),
    ...base,
    ...styleToCss(component),
    ...ctx.positionStyle(component),
  };
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
