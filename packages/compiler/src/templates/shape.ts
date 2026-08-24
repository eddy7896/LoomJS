import { SHAPE_KINDS, type ShapeKind } from '@loom/components';
import { tokenVar } from '@loom/ui';
import { CompileError, type ComponentEmitter } from '../types';
import { indent } from '../emit/text';
import { layoutToStyle } from '../emit/layout';
import { styleExpr } from '../emit/text';
import { styleToCss, styleValueCss } from '../emit/style';
import { staticString } from '../emit/props';

/**
 * Shapes — the vector primitives (`docs/12-canvas.md`), emitted as inline SVG.
 *
 * A shape is a **real element**: it takes layout and conditions like everything else, and it
 * ships with no runtime, no sprite sheet and no asset pipeline. Inline is also what makes the
 * fill a token — an `<img src>` could not be restyled by changing `:root`.
 *
 * Fill and stroke come from the same `style` block every other element uses, translated to SVG
 * paint properties here: a `background` on an `<svg>` would draw a rectangle behind an ellipse,
 * which is exactly the kind of quiet disagreement between canvas and app that must not happen.
 */

/** Geometry as percentages of the box, so a shape is whatever size it was drawn. */
function geometry(shape: ShapeKind, radius: string | undefined, strokeWidth: number): string {
  // Half the stroke sits outside the geometry, so the box is inset by it rather than clipped.
  const inset = strokeWidth / 2;
  switch (shape) {
    case 'ellipse':
      return `<ellipse cx="50%" cy="50%" rx="${pct(50, inset)}" ry="${pct(50, inset)}"`;
    case 'line':
      // A line is drawn corner to corner of its own box: dragging it out *is* the direction.
      return `<line x1="0" y1="0" x2="100%" y2="100%"`;
    case 'rectangle':
      return `<rect x="${inset}" y="${inset}" width="${pct(100, strokeWidth)}" height="${pct(100, strokeWidth)}"${
        radius ? ` rx={${JSON.stringify(radius)}}` : ''
      }`;
  }
}

/** `calc()` only when there is something to subtract — a bare percentage reads better. */
const pct = (percent: number, minus: number): string =>
  minus > 0 ? `calc(${percent}% - ${minus}px)` : `${percent}%`;

export const shapeEmitter: ComponentEmitter = {
  type: 'Shape',
  emit(component, ctx, depth) {
    const shape = staticString(component, 'shape', 'rectangle') as ShapeKind;
    if (!SHAPE_KINDS.includes(shape)) {
      throw new CompileError(
        `Shape has unknown kind "${shape}". Known: ${SHAPE_KINDS.join(', ')}.`,
        component.id,
      );
    }

    const style = component.style ?? {};
    const strokeWidth = style.borderWidth ?? (style.borderColor ? 1 : 0);
    const stroke = style.borderColor
      ? styleValueCss(style.borderColor, component.id, 'borderColor')
      : strokeWidth > 0
        ? tokenVar('color.ink')
        : undefined;

    // A line has no inside to fill, and an unfilled rectangle with no stroke would be invisible.
    const fill =
      shape === 'line'
        ? 'none'
        : style.background
          ? styleValueCss(style.background, component.id, 'background')
          : tokenVar('color.brand-tint');

    const radius =
      shape === 'rectangle' && style.radius
        ? styleValueCss(style.radius, component.id, 'radius')
        : undefined;

    // Only the box is CSS, and only the parts of it that mean anything here: a shape has no
    // children, so the flex properties a container carries would be noise in the emitted file.
    // `overflow: visible` keeps a stroke sitting on the edge from being clipped by the SVG
    // viewport, which is hidden by default.
    const layout = component.layout ? layoutToStyle(component.layout) : {};
    const own = styleToCss(component);
    const box: Record<string, string | number> = {
      display: 'block',
      overflow: 'visible',
      ...ctx.positionStyle(component),
      // Paint became SVG attributes above, but how see-through it is and which way round it faces
      // are properties of the box like any other element's.
      ...(own.opacity !== undefined ? { opacity: own.opacity } : {}),
      ...(own.transform !== undefined ? { transform: own.transform } : {}),
    };
    for (const key of ['width', 'height', 'flexGrow', 'flexShrink'] as const) {
      if (layout[key] !== undefined) box[key] = layout[key]!;
    }

    /**
     * A conditional override, as a paint expression.
     *
     * The style block became SVG attributes rather than CSS, so a conditional style would have
     * been silently dropped here — and a fill that quietly refuses to change on a condition is
     * exactly the canvas-disagrees-with-app failure this file exists to avoid. Later entries win,
     * the same order `styleAttr` spreads them in.
     */
    const painted = (
      base: string,
      pick: (entry: { background?: unknown; borderColor?: unknown }) => unknown,
    ): string => {
      const overrides = (component.conditionalStyles ?? []).filter((entry) => pick(entry.style));
      if (overrides.length === 0) return JSON.stringify(base);
      return overrides.reduceRight(
        (fallback, entry) =>
          `${ctx.conditionExpr(entry.when, component.id)} ? ${JSON.stringify(
            styleValueCss(pick(entry.style) as never, component.id, 'fill'),
          )} : ${fallback}`,
        JSON.stringify(base),
      );
    };

    const fillExpr = painted(fill, (entry) => entry.background);
    const strokeExpr = stroke ? painted(stroke, (entry) => entry.borderColor) : undefined;

    const paint = [
      `fill={${fillExpr}}`,
      ...(strokeExpr ? [`stroke={${strokeExpr}}`] : []),
      ...(strokeWidth > 0 ? [`strokeWidth={${strokeWidth}}`] : []),
      ...(shape === 'line' ? ['strokeLinecap="round"'] : []),
    ].join(' ');

    // Decorative by default: a rectangle is not something a screen reader should announce. A
    // shape that carries meaning gets a name, and then it is announced as an image.
    const name = component.name?.trim();
    const described = name && name !== 'Shape';
    const roleAttrs = described ? ` role="img" aria-label=${JSON.stringify(name)}` : ' aria-hidden="true"';

    return `${indent(depth)}<svg style=${styleExpr(box)}${roleAttrs}>
${indent(depth + 1)}${geometry(shape, radius, strokeWidth)} ${paint} />
${indent(depth)}</svg>`;
  },
};
