import type { ComponentEmitter } from '../types';
import { indent } from '../emit/text';
import { styleAttr } from '../emit/style';
import { valueExpr } from '../emit/props';

/** Text = a leaf span carrying its `content` prop (static text or a route param). */
export const textEmitter: ComponentEmitter = {
  type: 'Text',
  emit(component, ctx, depth) {
    const attrs = styleAttr(component, ctx);

    const value = component.props.content;
    if (!value) return `${indent(depth)}<span${attrs}>{""}</span>`;

    const expr = valueExpr(value, ctx, component.id, 'content');
    // Anything that is not plainly text goes through the coercion helper: a record rendered as
    // a JSX child is a runtime crash, and the compiler knows the type here.
    const type = ctx.typeOfValue(value);
    const safe = type && type.kind !== 'text' ? `${ctx.requireTextHelper()}(${expr})` : expr;
    return `${indent(depth)}<span${attrs}>{${safe}}</span>`;
  },
};
