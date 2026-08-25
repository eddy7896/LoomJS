import type { ComponentEmitter } from '../types';
import { indent } from '../emit/text';
import { classAttr } from '../emit/variants';
import { styleAttr } from '../emit/style';
import { layoutSizeStyle } from '../emit/layout';

/**
 * Where the screen goes (R2, `docs/V1-COMPLETION.md`).
 *
 * It emits react-router's `<Outlet />` inside a box that carries whatever size and style the slot
 * was given, so a designer can say "the page fills the rest of this row" the way they would for
 * anything else. The wrapper is what holds the layout decision; the `Outlet` is the position.
 */
export const outletEmitter: ComponentEmitter = {
  type: 'Outlet',
  emit(component, ctx, depth) {
    ctx.requireOutlet();

    return `${indent(depth)}<div${classAttr(component)}${styleAttr(component, ctx, layoutSizeStyle(component.layout))}>
${indent(depth + 1)}<Outlet />
${indent(depth)}</div>`;
  },
};
