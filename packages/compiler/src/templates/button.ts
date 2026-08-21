import type { ComponentEmitter } from '../types';
import { CompileError } from '../types';
import { indent } from '../emit/text';
import { styleAttr } from '../emit/style';
import { valueExpr } from '../emit/props';

/**
 * Button = the leaf that starts a flow. Its `onClick` property holds an event handler; a
 * `navigate` handler compiles to react-router navigation along the flow arrow (M2); a `trigger`
 * handler fires a backend pipeline (M3).
 */
export const buttonEmitter: ComponentEmitter = {
  type: 'Button',
  emit(component, ctx, depth) {
    const label = component.props.label;
    const labelExpr = label ? valueExpr(label, ctx, component.id, 'label') : '""';

    const onClick = component.props.onClick;
    let handler = '';

    if (onClick) {
      if (onClick.kind !== 'event') {
        throw new CompileError(
          `Button "onClick" must hold an event handler, got "${onClick.kind}".`,
          component.id,
        );
      }
      handler =
        onClick.handler.kind === 'trigger'
          ? ` onClick={() => ${ctx.triggerExpr(onClick.handler.target, component.id)}}`
          : ` onClick={() => ${ctx.navigateExpr(onClick.handler.flowId, component.id)}}`;
    }

    const attrs = styleAttr(component, ctx);

    return `${indent(depth)}<button type="button"${attrs}${handler}>{${labelExpr}}</button>`;
  },
};
