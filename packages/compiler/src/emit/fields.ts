import type { Component } from '@loom/ir';
import { hasFieldState } from '@loom/components';

/**
 * What an input starts as.
 *
 * One source of truth, because two things need the same answer and they must never disagree: the
 * input emitter, which seeds the `useState`, and the `clearField` action, which puts it back.
 * "Clear" means *back to what it started as* — a number field returns to its initial number and a
 * select to its first option, not to the empty string (`docs/specs/actions.md`).
 */

/** Read a static prop, falling back when it is bound or missing. */
function staticValue(component: Component, key: string, fallback: unknown): unknown {
  const value = component.props[key];
  return value?.kind === 'static' ? (value.value ?? fallback) : fallback;
}

function staticText(component: Component, key: string, fallback = ''): string {
  const value = component.props[key];
  if (!value || value.kind !== 'static') return fallback;
  return typeof value.value === 'string' ? value.value : String(value.value ?? fallback);
}

/** `One, Two , Three` -> three options; blank entries are dropped rather than rendered empty. */
export function parseOptions(raw: string): string[] {
  return raw
    .split(',')
    .map((option) => option.trim())
    .filter(Boolean);
}

/** The starting value of an input's local state, typed as the field itself is. */
export function initialFieldValue(component: Component): unknown {
  switch (component.type) {
    case 'NumberField': {
      // An empty box reads as 0 rather than NaN: NaN would travel down a wire and land in a
      // column as null, which is a different fact from "the designer left it empty".
      const initial = Number(staticValue(component, 'value', 0));
      return Number.isFinite(initial) ? initial : 0;
    }
    case 'Checkbox':
      return Boolean(staticValue(component, 'value', false));
    case 'Slider': {
      const initial = Number(staticValue(component, 'value', 50));
      return Number.isFinite(initial) ? initial : 50;
    }
    case 'RadioGroup': {
      // Nothing chosen is a real answer for a radio group, so it starts empty rather than on the
      // first option — unlike a Select, which always shows something.
      const options = parseOptions(staticText(component, 'options'));
      const initial = staticText(component, 'value');
      return options.includes(initial) ? initial : '';
    }
    case 'Select': {
      const options = parseOptions(staticText(component, 'options'));
      const initial = staticText(component, 'value');
      // Selecting an option the list does not contain would render as blank; start on the first.
      return options.includes(initial) ? initial : (options[0] ?? '');
    }
    default:
      return staticText(component, 'value');
  }
}

/** Whether this component owns a value that an action can set or clear. */
export const isField = (component: Component): boolean => hasFieldState(component.type);
