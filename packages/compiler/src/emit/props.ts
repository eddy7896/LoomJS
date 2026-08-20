import type { Component, PropertyValue } from '@loom/ir';
import { CompileError, type EmitContext } from '../types';
import { bindingExpr } from './pipeline';

/**
 * A property value becomes a JS expression.
 *
 * `static` is a literal, `param` reads the artboard's route data (M2), `bound` reads a pipeline's
 * output state (M3, spec 4), and `item` reads a field of the current row inside a List's template
 * (M4). `event` is handled by the emitters that own the event, not here. Failing loudly beats
 * silently dropping a binding.
 */
export function valueExpr(
  value: PropertyValue,
  ctx: EmitContext,
  componentId: string,
  key: string,
): string {
  switch (value.kind) {
    case 'static':
      return JSON.stringify(value.value ?? null);
    case 'param': {
      const declared = (ctx.artboard.params ?? []).some((p) => p.name === value.name);
      if (!declared) {
        throw new CompileError(
          `Property "${key}" reads param "${value.name}", which artboard "${ctx.artboard.name}" does not declare.`,
          componentId,
        );
      }
      return `${ctx.requireParams()}.${value.name} ?? ""`;
    }
    case 'bound':
      return bindingExpr(ctx.plans, ctx.derived, value.source, componentId);
    case 'item': {
      const item = ctx.itemVar();
      if (!item) {
        throw new CompileError(
          `Property "${key}" reads row field "${value.field}", but "${componentId}" is not inside a List.`,
          componentId,
        );
      }
      return `${item}[${JSON.stringify(value.field)}] ?? ""`;
    }
    case 'event':
      throw new CompileError(
        `Property "${key}" holds an event handler but "${componentId}" does not accept one here.`,
        componentId,
      );
  }
}

/** Read a static string prop, or fall back (used for labels that cannot be dynamic yet). */
export function staticString(component: Component, key: string, fallback = ''): string {
  const value = component.props[key];
  if (!value || value.kind !== 'static') return fallback;
  return typeof value.value === 'string' ? value.value : String(value.value ?? fallback);
}
