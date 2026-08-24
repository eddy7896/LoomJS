import { classAttr } from '../emit/variants';
import type { ComponentEmitter } from '../types';
import { indent } from '../emit/text';
import { staticString } from '../emit/props';
import { styleAttr } from '../emit/style';
import { initialFieldValue, parseOptions } from '../emit/fields';

/**
 * The input vocabulary beyond text: a number, a boolean, and a choice.
 *
 * Each is a controlled input whose state is **already the right type** — a number field holds a
 * number, a checkbox holds a boolean. That is what lets a form fill a numeric or boolean column
 * without a cast, and what makes a Gate's condition mean what it says.
 */

export const numberFieldEmitter: ComponentEmitter = {
  type: 'NumberField',
  emit(component, ctx, depth) {
    const placeholder = staticString(component, 'placeholder', '0');
    const state = ctx.requireFieldState(component.id, initialFieldValue(component));

    // An empty box reads as 0 rather than NaN: NaN would travel down the wire and land in a
    // column as null, which is a different fact from "the designer left it empty".
    return `${indent(depth)}<input${classAttr(component)}${styleAttr(component, ctx)}
${indent(depth + 1)}type="number"
${indent(depth + 1)}value={${state}}
${indent(depth + 1)}placeholder={${JSON.stringify(placeholder)}}
${indent(depth + 1)}onChange={(event) => set_${state}(event.target.value === "" ? 0 : Number(event.target.value))}
${indent(depth)}/>`;
  },
};

export const checkboxEmitter: ComponentEmitter = {
  type: 'Checkbox',
  emit(component, ctx, depth) {
    const label = staticString(component, 'label', 'Yes');
    const state = ctx.requireFieldState(component.id, initialFieldValue(component));

    return `${indent(depth)}<label${classAttr(component)}${styleAttr(component, ctx)}>
${indent(depth + 1)}<input
${indent(depth + 2)}type="checkbox"
${indent(depth + 2)}checked={${state}}
${indent(depth + 2)}onChange={(event) => set_${state}(event.target.checked)}
${indent(depth + 1)}/>
${indent(depth + 1)}<span>{${JSON.stringify(label)}}</span>
${indent(depth)}</label>`;
  },
};

export const selectEmitter: ComponentEmitter = {
  type: 'Select',
  emit(component, ctx, depth) {
    const options = parseOptions(staticString(component, 'options', ''));
    const state = ctx.requireFieldState(component.id, initialFieldValue(component));

    const items = options
      .map(
        (option) =>
          `${indent(depth + 1)}<option value={${JSON.stringify(option)}}>{${JSON.stringify(option)}}</option>`,
      )
      .join('\n');

    return `${indent(depth)}<select${classAttr(component)}${styleAttr(component, ctx)} value={${state}} onChange={(event) => set_${state}(event.target.value)}>
${items}
${indent(depth)}</select>`;
  },
};
