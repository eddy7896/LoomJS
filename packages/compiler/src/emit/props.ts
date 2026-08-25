import type { Component, Id, PortRef, PropertyValue } from '@loom/ir';
import { hasFieldState } from '@loom/components';
import { CompileError, type EmitContext } from '../types';
import { bindingExpr, stateNameForComponent } from './pipeline';
import { orgExpr, sessionExpr } from './auth';

/**
 * A property value becomes a JS expression.
 *
 * `static` is a literal, `param` reads the artboard's route data (M2), `bound` reads a pipeline's
 * output state (M3, spec 4), and `item` reads a field of the current row inside a List's template
 * (M4). `event` is handled by the emitters that own the event, not here. Failing loudly beats
 * silently dropping a binding.
 */

/**
 * A binding straight to an input's mirror: show what the person typed, with nothing in between.
 *
 * This is the simplest wire on the canvas and it deserves the simplest emission — the field's own
 * state variable, read directly. No pipeline, no derivation, no request.
 */
export function fieldStateExpr(
  ctx: EmitContext,
  source: PortRef,
  componentId: Id,
): string | undefined {
  const node = ctx.snapshot.nodes[source.nodeId];
  if (!node || node.category !== 'ui' || !node.mirrorOf) return undefined;

  const mirrored = ctx.snapshot.components[node.mirrorOf];
  if (!mirrored) return undefined;

  if (!hasFieldState(mirrored.type)) {
    throw new CompileError(
      `"${mirrored.name ?? mirrored.type}" holds no value of its own, so nothing can read from it.`,
      componentId,
    );
  }

  // The state only exists on the screen that renders the input.
  if (!ownsComponent(ctx, node.mirrorOf)) {
    throw new CompileError(
      `"${mirrored.name ?? mirrored.type}" is on another screen, so this one cannot read it.`,
      componentId,
    );
  }

  return stateNameForComponent(node.mirrorOf);
}

/** Whether a component belongs to the artboard being emitted. */
export function ownsComponent(ctx: EmitContext, componentId: Id): boolean {
  const seen = new Set<Id>();
  const walk = (id: Id): boolean => {
    if (id === componentId) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return (ctx.snapshot.components[id]?.children ?? []).some(walk);
  };
  return walk(ctx.artboard.root);
}
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
          `Property "${key}" reads param "${value.name}", which "${ctx.artboard.name}" does not declare.`,
          componentId,
        );
      }
      return ctx.paramExpr(value.name, componentId);
    }
    case 'bound': {
      const field = fieldStateExpr(ctx, value.source, componentId);
      if (field) return field;
      // Who is signed in is read straight off the auth context — no pipeline, no state of its own.
      const session = sessionExpr(ctx, value.source, componentId);
      if (session) return session;
      // Which organisation they are in, from the same round trip (O1).
      const org = orgExpr(ctx, value.source, componentId);
      if (org) return org;
      return bindingExpr(ctx.plans, ctx.derived, ctx.states, value.source, componentId);
    }
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

/**
 * Read a static number prop, or fall back.
 *
 * Lived as a private copy in two templates and now needs a third, which is the point at which a
 * duplicate becomes two places to fix the same bug. A non-finite value falls back rather than
 * emitting `NaN` — a size of NaN renders nothing and looks like missing data.
 */
export function staticNumber(component: Component, key: string, fallback: number): number {
  const value = component.props[key];
  if (value?.kind !== 'static') return fallback;
  const parsed = Number(value.value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Read a static string prop, or fall back (used for labels that cannot be dynamic yet). */
export function staticString(component: Component, key: string, fallback = ''): string {
  const value = component.props[key];
  if (!value || value.kind !== 'static') return fallback;
  return typeof value.value === 'string' ? value.value : String(value.value ?? fallback);
}
