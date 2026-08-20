import type { ComponentEmitter } from '../types';
import { indent } from '../emit/text';
import { valueExpr } from '../emit/props';

/** Text = a leaf span carrying its `content` prop (static text or a route param). */
export const textEmitter: ComponentEmitter = {
  type: 'Text',
  emit(component, ctx, depth) {
    const value = component.props.content;
    const expr = value ? valueExpr(value, ctx, component.id, 'content') : '""';
    return `${indent(depth)}<span>{${expr}}</span>`;
  },
};
