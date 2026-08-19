import type { Component, PropertyValue } from '@loom/ir';
import { CompileError } from '../types';

/**
 * A property value becomes a JS expression. M0 only understands `static`; `bound` needs the
 * binding/trigger runtime (spec 4, M3) and `event` needs flow routing (M2) / triggers (M3).
 * Failing loudly here is deliberate — a silently dropped binding is worse than a build error.
 */
export function propertyExpr(value: PropertyValue, componentId: string, key: string): string {
  switch (value.kind) {
    case 'static':
      return JSON.stringify(value.value ?? null);
    case 'bound':
      throw new CompileError(
        `Bound property "${key}" is not supported yet (binding runtime lands in M3).`,
        componentId,
      );
    case 'event':
      throw new CompileError(
        `Event handler on "${key}" is not supported yet (flows land in M2, triggers in M3).`,
        componentId,
      );
  }
}

/** Read a static string prop, or fall back. */
export function staticString(component: Component, key: string, fallback = ''): string {
  const value = component.props[key];
  if (!value) return fallback;
  const expr = propertyExpr(value, component.id, key);
  const parsed: unknown = JSON.parse(expr);
  return typeof parsed === 'string' ? parsed : String(parsed ?? fallback);
}
