import type { ComponentEmitter } from '../types';
import { indent } from '../emit/text';
import { staticString } from '../emit/props';
import { styleAttr } from '../emit/style';

/**
 * The input vocabulary beyond text: a number, a boolean, and a choice.
 *
 * Each is a controlled input whose state is **already the right type** — a number field holds a
 * number, a checkbox holds a boolean. That is what lets a form fill a numeric or boolean column
 * without a cast, and what makes a Gate's condition mean what it says.
 */

/** Read a static prop that is not a string, falling back when it is bound or missing. */
function staticValue(component: Parameters<ComponentEmitter['emit']>[0], key: string, fallback: unknown): unknown {
  const value = component.props[key];
  return value?.kind === 'static' ? (value.value ?? fallback) : fallback;
}

export const numberFieldEmitter: ComponentEmitter = {
  type: 'NumberField',
  emit(component, ctx, depth) {
    const initial = Number(staticValue(component, 'value', 0));
    const placeholder = staticString(component, 'placeholder', '0');
    const state = ctx.requireFieldState(component.id, Number.isFinite(initial) ? initial : 0);

    // An empty box reads as 0 rather than NaN: NaN would travel down the wire and land in a
    // column as null, which is a different fact from "the designer left it empty".
    return `${indent(depth)}<input${styleAttr(component, ctx)}
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
    const initial = Boolean(staticValue(component, 'value', false));
    const label = staticString(component, 'label', 'Yes');
    const state = ctx.requireFieldState(component.id, initial);

    return `${indent(depth)}<label${styleAttr(component, ctx)}>
${indent(depth + 1)}<input
${indent(depth + 2)}type="checkbox"
${indent(depth + 2)}checked={${state}}
${indent(depth + 2)}onChange={(event) => set_${state}(event.target.checked)}
${indent(depth + 1)}/>
${indent(depth + 1)}<span>{${JSON.stringify(label)}}</span>
${indent(depth)}</label>`;
  },
};

/** `One, Two , Three` -> three options; blank entries are dropped rather than rendered empty. */
export function parseOptions(raw: string): string[] {
  return raw
    .split(',')
    .map((option) => option.trim())
    .filter(Boolean);
}

export const selectEmitter: ComponentEmitter = {
  type: 'Select',
  emit(component, ctx, depth) {
    const options = parseOptions(staticString(component, 'options', ''));
    const initial = staticString(component, 'value');
    // Selecting an option the list does not contain would render as blank; start on the first.
    const start = options.includes(initial) ? initial : (options[0] ?? '');
    const state = ctx.requireFieldState(component.id, start);

    const items = options
      .map(
        (option) =>
          `${indent(depth + 1)}<option value={${JSON.stringify(option)}}>{${JSON.stringify(option)}}</option>`,
      )
      .join('\n');

    return `${indent(depth)}<select${styleAttr(component, ctx)} value={${state}} onChange={(event) => set_${state}(event.target.value)}>
${items}
${indent(depth)}</select>`;
  },
};
