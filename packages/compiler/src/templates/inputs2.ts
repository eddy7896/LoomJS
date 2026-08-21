import type { ComponentEmitter } from '../types';
import { indent } from '../emit/text';
import { staticString } from '../emit/props';
import { styleAttr } from '../emit/style';
import { initialFieldValue, parseOptions } from '../emit/fields';

/**
 * The rest of the input vocabulary: a textarea, a radio group, a date and a slider.
 *
 * Each is a controlled input whose state is **already the right type**, the same rule the first
 * four follow — a slider holds a number, a date holds the `YYYY-MM-DD` a date column accepts. That
 * is what lets a form fill a typed column without a cast.
 */

/** A static number prop, falling back when it is bound or nonsense. */
function staticNumber(
  component: Parameters<ComponentEmitter['emit']>[0],
  key: string,
  fallback: number,
): number {
  const value = component.props[key];
  if (value?.kind !== 'static') return fallback;
  const parsed = Number(value.value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const multilineFieldEmitter: ComponentEmitter = {
  type: 'MultilineField',
  emit(component, ctx, depth) {
    const placeholder = staticString(component, 'placeholder', 'Type here');
    const rows = staticNumber(component, 'rows', 4);
    const state = ctx.requireFieldState(component.id, initialFieldValue(component));

    return `${indent(depth)}<textarea${styleAttr(component, ctx)}
${indent(depth + 1)}value={${state}}
${indent(depth + 1)}rows={${rows}}
${indent(depth + 1)}placeholder={${JSON.stringify(placeholder)}}
${indent(depth + 1)}onChange={(event) => set_${state}(event.target.value)}
${indent(depth)}/>`;
  },
};

export const radioGroupEmitter: ComponentEmitter = {
  type: 'RadioGroup',
  emit(component, ctx, depth) {
    const options = parseOptions(staticString(component, 'options', ''));
    const question = staticString(component, 'label');
    const state = ctx.requireFieldState(component.id, initialFieldValue(component));

    // One `name` per group, derived from the component id: two groups sharing a name would let a
    // choice in one clear the other, which is a bug nobody would ever guess from the canvas.
    const group = JSON.stringify(state);

    const items = options
      .map(
        (option) => `${indent(depth + 1)}<label>
${indent(depth + 2)}<input
${indent(depth + 3)}type="radio"
${indent(depth + 3)}name={${group}}
${indent(depth + 3)}value={${JSON.stringify(option)}}
${indent(depth + 3)}checked={${state} === ${JSON.stringify(option)}}
${indent(depth + 3)}onChange={() => set_${state}(${JSON.stringify(option)})}
${indent(depth + 2)}/>
${indent(depth + 2)}<span>{${JSON.stringify(option)}}</span>
${indent(depth + 1)}</label>`,
      )
      .join('\n');

    // A `fieldset` with a `legend` is what makes a group of radios announce as one question
    // rather than as loose buttons.
    const legend = question
      ? `${indent(depth + 1)}<legend>{${JSON.stringify(question)}}</legend>\n`
      : '';

    return `${indent(depth)}<fieldset${styleAttr(component, ctx)}>
${legend}${items}
${indent(depth)}</fieldset>`;
  },
};

export const dateFieldEmitter: ComponentEmitter = {
  type: 'DateField',
  emit(component, ctx, depth) {
    const state = ctx.requireFieldState(component.id, initialFieldValue(component));
    const min = staticString(component, 'min');
    const max = staticString(component, 'max');

    const bounds =
      (min ? `\n${indent(depth + 1)}min={${JSON.stringify(min)}}` : '') +
      (max ? `\n${indent(depth + 1)}max={${JSON.stringify(max)}}` : '');

    return `${indent(depth)}<input${styleAttr(component, ctx)}
${indent(depth + 1)}type="date"
${indent(depth + 1)}value={${state}}${bounds}
${indent(depth + 1)}onChange={(event) => set_${state}(event.target.value)}
${indent(depth)}/>`;
  },
};

export const sliderEmitter: ComponentEmitter = {
  type: 'Slider',
  emit(component, ctx, depth) {
    const min = staticNumber(component, 'min', 0);
    const max = staticNumber(component, 'max', 100);
    const step = staticNumber(component, 'step', 1);
    const state = ctx.requireFieldState(component.id, initialFieldValue(component));

    return `${indent(depth)}<input${styleAttr(component, ctx)}
${indent(depth + 1)}type="range"
${indent(depth + 1)}value={${state}}
${indent(depth + 1)}min={${min}}
${indent(depth + 1)}max={${max}}
${indent(depth + 1)}step={${step}}
${indent(depth + 1)}onChange={(event) => set_${state}(Number(event.target.value))}
${indent(depth)}/>`;
  },
};
