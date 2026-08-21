import type { ComponentEmitter } from '../types';
import { componentStyle, styleAttr } from '../emit/style';
import { indent } from '../emit/text';

/** Frame = the flex container. Owns layout; renders its children in order. */
export const frameEmitter: ComponentEmitter = {
  type: 'Frame',
  emit(component, ctx, depth) {
    const attrs = styleAttr(component, ctx, { display: 'flex', ...componentStyle(component) });
    const children = component.children ?? [];

    if (children.length === 0) return `${indent(depth)}<div${attrs} />`;

    const body = children.map((id) => ctx.renderChild(id, depth + 1)).join('\n');
    return `${indent(depth)}<div${attrs}>\n${body}\n${indent(depth)}</div>`;
  },
};
