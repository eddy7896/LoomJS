import type { ComponentEmitter } from '../types';
import { layoutToStyle } from '../emit/layout';
import { indent, styleExpr } from '../emit/text';

/** Frame = the flex container. Owns layout; renders its children in order. */
export const frameEmitter: ComponentEmitter = {
  type: 'Frame',
  emit(component, ctx, depth) {
    const style = component.layout ? layoutToStyle(component.layout) : { display: 'flex' };
    const attrs = ` style=${styleExpr(style)}`;
    const children = component.children ?? [];

    if (children.length === 0) return `${indent(depth)}<div${attrs} />`;

    const body = children.map((id) => ctx.renderChild(id, depth + 1)).join('\n');
    return `${indent(depth)}<div${attrs}>\n${body}\n${indent(depth)}</div>`;
  },
};
