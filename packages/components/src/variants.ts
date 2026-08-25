import type { Component } from '@loom/ir';
import { defFor } from './defs';

/**
 * A component's variant choices, turned into class names (`docs/27-variants.md`).
 *
 * The document stores `variant: "outline"` — a **named decision**, exactly like a token — and this
 * is where that name becomes `loom-button loom-button--outline loom-button--md`. Both the canvas
 * and the compiler call it, which is what makes the two agree: one function, one answer, no second
 * copy of the rule to drift.
 */

/** A named design choice with a fixed set of answers. `variant`, `size`, `tone`. */
export interface VariantAxis {
  /** The prop key it is stored under. */
  key: string;
  /** What the inspector calls it. */
  label: string;
  options: readonly string[];
  /** The answer a freshly placed element arrives with. */
  default: string;
}

/**
 * The class stem for a type — `Button` becomes `loom-button`, `TextField` becomes `loom-field`.
 *
 * Several types share a stem on purpose: a text field, a number field, a date and a select are one
 * control wearing four value types, and they should look identical because they *are* identical to
 * the person filling them in.
 */
const STEMS: Record<string, string> = {
  Button: 'loom-button',
  TextField: 'loom-field',
  NumberField: 'loom-field',
  MultilineField: 'loom-field',
  DateField: 'loom-field',
  Select: 'loom-field',
  FileField: 'loom-upload',
  ImageField: 'loom-upload',
  Checkbox: 'loom-check',
  RadioGroup: 'loom-radios',
  Slider: 'loom-slider',
  Frame: 'loom-frame',
  List: 'loom-list',
  Pager: 'loom-pager',
  Table: 'loom-table',
  Text: 'loom-text',
  Link: 'loom-link',
  Image: 'loom-image',
  Video: 'loom-video',
  Audio: 'loom-audio',
  Carousel: 'loom-carousel',
  Tiles: 'loom-tiles',
  Avatar: 'loom-avatar',
  Embed: 'loom-embed',
  Icon: 'loom-icon',
  BarChart: 'loom-chart',
  LineChart: 'loom-chart',
  PieChart: 'loom-chart',
  Stat: 'loom-stat',
  Calendar: 'loom-calendar',
  Chat: 'loom-chat',
};

export function classStem(type: string): string | undefined {
  return STEMS[type];
}

/** The value an axis holds on a component: its static choice, or the default. */
export function axisValue(component: Component, axis: VariantAxis): string {
  const prop = component.props[axis.key];
  // Static only. An axis is settled before the app runs (`docs/27-variants.md`) — a variant that
  // depended on run-time data would be a conditional style, which the document already has and
  // which is the honest way to say it.
  if (prop?.kind !== 'static') return axis.default;
  const value = String(prop.value);
  // An option that is no longer offered falls back rather than emitting a class with no rule
  // behind it, which renders as nothing and looks like the variant silently stopped working.
  return axis.options.includes(value) ? value : axis.default;
}

/**
 * Every class a component wears, stem first.
 *
 * Returns an empty list for a type with no variants — Shape paints itself from its own style block,
 * and a class that styled it would be arguing with the thing it is.
 */
export function variantClasses(component: Component): string[] {
  const stem = classStem(component.type);
  if (!stem) return [];

  const axes = defFor(component.type)?.variants ?? [];
  if (axes.length === 0) return [];

  const classes = [stem];
  for (const axis of axes) classes.push(`${stem}--${axisValue(component, axis)}`);
  return classes;
}

/** The same thing as one attribute value, or undefined when there is nothing to say. */
export function variantClassName(component: Component): string | undefined {
  const classes = variantClasses(component);
  return classes.length > 0 ? classes.join(' ') : undefined;
}
