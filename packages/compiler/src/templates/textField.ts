import { classAttr } from '../emit/variants';
import type { ComponentEmitter } from '../types';
import { indent } from '../emit/text';
import { staticString } from '../emit/props';
import { styleAttr } from '../emit/style';

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

    const styled = styleAttr(component, ctx);

    // Explicit, like every other input template: `text` is the browser default, but a developer
    // reading the output should not have to know that to know what this is.
    return `${indent(depth)}<input${classAttr(component)}${styled}
${indent(depth + 1)}type="text"
${indent(depth + 1)}value={${state}}
${indent(depth + 1)}placeholder={${JSON.stringify(placeholder)}}
${indent(depth + 1)}onChange={(event) => set_${state}(event.target.value)}
${indent(depth)}/>`;
  },
};
