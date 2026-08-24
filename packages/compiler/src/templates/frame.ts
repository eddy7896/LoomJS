import { classAttr } from '../emit/variants';
import type { ComponentEmitter } from '../types';
import { componentStyle, styleAttr } from '../emit/style';
import { indent } from '../emit/text';

/**
 * Frame = the container. Owns the layout and renders what is inside it.
 *
 * Which layout is the frame's own business (`emit/layout.ts`): stacked, it is a flex container;
 * free, it is a positioning context and nothing else. The `display: flex` fallback is only for a
 * frame carrying no layout at all — asserting it over a free frame would emit a flex container
 * whose children are all out of flow, which is a description of nothing.
 */
export const frameEmitter: ComponentEmitter = {
  type: 'Frame',
  emit(component, ctx, depth) {
    const own = componentStyle(component);
    const attrs = styleAttr(component, ctx, component.layout ? own : { display: 'flex', ...own });
    const children = component.children ?? [];

    const classes = classAttr(component);

    if (children.length === 0) return `${indent(depth)}<div${classes}${attrs} />`;

    const body = children.map((id) => ctx.renderChild(id, depth + 1)).join('\n');
    return `${indent(depth)}<div${classes}${attrs}>\n${body}\n${indent(depth)}</div>`;
  },
};
