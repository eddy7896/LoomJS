import type { ComponentEmitter } from '../types';
import { CompileError } from '../types';
import { indent } from '../emit/text';
import { valueExpr } from '../emit/props';

/**
 * Button = the leaf that starts a flow. Its `onClick` property holds an event handler; a
 * `navigate` handler compiles to react-router navigation along the flow arrow (M2). A `trigger`
 * handler fires a backend pipeline and lands with the trigger runtime (M3).
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
      if (onClick.handler.kind === 'trigger') {
        throw new CompileError(
          'Trigger handlers are not supported yet (trigger runtime lands in M3).',
          component.id,
        );
      }
      handler = ` onClick={() => ${ctx.navigateExpr(onClick.handler.flowId, component.id)}}`;
    }

    return `${indent(depth)}<button type="button"${handler}>{${labelExpr}}</button>`;
  },
};
