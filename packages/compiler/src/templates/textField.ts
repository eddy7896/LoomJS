import type { ComponentEmitter } from '../types';
import { indent } from '../emit/text';
import { staticString } from '../emit/props';

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

    return `${indent(depth)}<input
${indent(depth + 1)}value={${state}}
${indent(depth + 1)}placeholder={${JSON.stringify(placeholder)}}
${indent(depth + 1)}onChange={(event) => set_${state}(event.target.value)}
${indent(depth)}/>`;
  },
};
