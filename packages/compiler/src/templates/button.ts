import type { ComponentEmitter } from '../types';
import { indent } from '../emit/text';
import { styleAttr } from '../emit/style';
import { valueExpr } from '../emit/props';
import { eventAttr } from '../emit/actions';

/**
 * Button = the leaf that starts a sequence. Its `onClick` property holds an ordered list of
 * actions (spec 7); everything about what those are and how they compile lives in `emit/actions`,
 * so a second component with an event gets the same behaviour by calling the same function.
 */
export const buttonEmitter: ComponentEmitter = {
  type: 'Button',
  emit(component, ctx, depth) {
    const label = component.props.label;
    const labelExpr = label ? valueExpr(label, ctx, component.id, 'label') : '""';

    const attrs = styleAttr(component, ctx);
    const handler = eventAttr(component, ctx, 'onClick', depth);

    return `${indent(depth)}<button type="button"${attrs}${handler}>{${labelExpr}}</button>`;
  },
};
