import type { ComponentEmitter } from '../types';
import { indent } from '../emit/text';
import { staticString } from '../emit/props';
import { styleToCss } from '../emit/style';
import { styleExpr } from '../emit/text';

/**
 * TextField = a controlled input. Its value is local component state, which is also what a
 * pipeline reads when the field's mirror port is wired into an API node (spec 4).
 */
export const textFieldEmitter: ComponentEmitter = {
  type: 'TextField',
  emit(component, ctx, depth) {
    const initial = staticString(component, 'value');
    const placeholder = staticString(component, 'placeholder');
    const state = ctx.requireFieldState(component.id, initial);

    const style = styleToCss(component);
    const styled = Object.keys(style).length > 0 ? `
${indent(depth + 1)}style=${styleExpr(style)}` : '';

    return `${indent(depth)}<input${styled}
${indent(depth + 1)}value={${state}}
${indent(depth + 1)}placeholder={${JSON.stringify(placeholder)}}
${indent(depth + 1)}onChange={(event) => set_${state}(event.target.value)}
${indent(depth)}/>`;
  },
};
