import { actionsOf, type Action, type Component, type Id, type ValueSource } from '@loom/ir';
import { CompileError, type EmitContext } from '../types';
import { indent } from './text';
import { stateNameForComponent } from './pipeline';
import { initialFieldValue, isField } from './fields';
import { ownsComponent, valueExpr } from './props';

/**
 * Action sequences (spec 7) — one click doing more than one thing.
 *
 * An event holds an **ordered list**, and the order in the document is the order in the emitted
 * function. Always. A `trigger` is awaited, which is the entire point: "save, then clear, then
 * navigate" is only meaningful if the save has finished before the navigation starts.
 *
 * **A failed pipeline stops the sequence.** Navigating after a save that failed would show someone
 * a success they did not get. Bubble continues on failure; this is a deliberate divergence.
 */


interface Step {
  /** Lines of the emitted handler body, already at statement level. */
  lines: string[];
  /** Whether the handler has to be `async` for this step to work. */
  async: boolean;
}

const literal = (value: unknown): string => JSON.stringify(value ?? '');

/** A value an action carries: something typed in, or something on the graph. */
function valueSourceExpr(value: ValueSource, ctx: EmitContext, componentId: Id): string {
  if (value.kind === 'static') return literal(value.value);
  return valueExpr({ kind: 'bound', source: value.source }, ctx, componentId, 'value');
}

/**
 * Firing something: a pipeline (a request, awaited, and able to fail) or a derivation (a
 * recomputation in place). Which one it is comes from the wiring, never from configuration.
 */
function triggerStep(
  action: Extract<Action, { kind: 'trigger' }>,
  ctx: EmitContext,
  id: Id,
  hasFollowing: boolean,
): Step {
  const derivation = ctx.derived.find((entry) => entry.node.id === action.target.nodeId);
  if (derivation) {
    if (!derivation.runName) {
      throw new CompileError(
        `"${derivation.node.name ?? derivation.node.id}" has no run port wired, so nothing fires it.`,
        id,
      );
    }
    return { lines: [`${derivation.runName}();`], async: false };
  }

  const plan = ctx.plans.find((candidate) => candidate.node.id === action.target.nodeId);
  if (!plan) {
    // A function node this screen never planned is one nothing consumes — it was dropped as
    // demand-driven dead code. Saying "not a pipeline" sends the reader looking for a routing
    // mistake; the actual fix is at the other end, where the answer should have gone.
    const node = ctx.snapshot.nodes[action.target.nodeId];
    if (node?.category === 'fn') {
      throw new CompileError(
        `"${node.name ?? node.kind}" runs when this is pressed, but nothing on this screen ` +
          `shows or keeps its result, so pressing it would do nothing. Bind its result to a ` +
          `property, or wire it into a variable something reads.`,
        id,
      );
    }
    throw new CompileError(
      `Trigger points at node "${action.target.nodeId}", which is not a pipeline on this screen.`,
      id,
    );
  }

  // Awaited only when something comes after it. The whole reason to wait is so the next step
  // happens afterwards; with nothing next, waiting would be ceremony and the handler would become
  // `async` for no reason. When there *is* a next step, a failure ends the sequence.
  return hasFollowing
    ? { lines: [`if (!(await ${plan.names.run}())) return;`], async: true }
    : { lines: [`void ${plan.names.run}();`], async: false };
}

/** The setter for an input's own state, refusing anything that holds no value of its own. */
function fieldSetter(ctx: EmitContext, componentId: Id, ownerId: Id): { setter: string; target: Component } {
  const target = ctx.snapshot.components[componentId];
  if (!target) {
    throw new CompileError(`This action sets a component that no longer exists.`, ownerId);
  }
  if (!isField(target)) {
    throw new CompileError(
      `"${target.name ?? target.type}" holds no value of its own, so nothing can set it.`,
      ownerId,
    );
  }
  if (!ownsComponent(ctx, componentId)) {
    throw new CompileError(
      `"${target.name ?? target.type}" is on another screen, so this one cannot set it.`,
      ownerId,
    );
  }
  return { setter: `set_${stateNameForComponent(componentId)}`, target };
}

function stepFor(action: Action, ctx: EmitContext, id: Id, hasFollowing: boolean): Step {
  switch (action.kind) {
    case 'navigate':
      return { lines: [`${ctx.navigateExpr(action.flowId, id)};`], async: false };

    case 'trigger':
      return triggerStep(action, ctx, id, hasFollowing);

    case 'setVariable': {
      const state = ctx.states.find((entry) => entry.node.id === action.nodeId);
      if (!state) {
        throw new CompileError(
          `This action sets a variable nothing on this screen reads, so setting it would do ` +
            `nothing. Bind the variable to a property, or use it in a condition.`,
          id,
        );
      }
      return { lines: [`set_${state.name}(${valueSourceExpr(action.value, ctx, id)});`], async: false };
    }

    case 'setField': {
      const { setter } = fieldSetter(ctx, action.componentId, id);
      return { lines: [`${setter}(${valueSourceExpr(action.value, ctx, id)});`], async: false };
    }

    case 'clearField': {
      // Back to what it started as — one source of truth with the input emitter (`emit/fields.ts`).
      const { setter, target } = fieldSetter(ctx, action.componentId, id);
      return { lines: [`${setter}(${literal(initialFieldValue(target))});`], async: false };
    }

    case 'message': {
      const show = ctx.requireMessage();
      const tone = action.tone === 'error' ? 'error' : 'ok';
      return {
        lines: [`${show}({ text: ${literal(action.text)}, tone: ${literal(tone)} });`],
        async: false,
      };
    }

    case 'openUrl':
      // `noopener,noreferrer` always: without it the opened page can reach back through
      // `window.opener` and navigate the app somewhere else.
      return {
        lines: [`window.open(${literal(action.url)}, "_blank", "noopener,noreferrer");`],
        async: false,
      };

    case 'copy':
      // Best-effort: a browser that refuses clipboard access should not swallow the confirmation
      // that follows, so this is not awaited and not allowed to reject the handler.
      return {
        lines: [
          `void navigator.clipboard?.writeText(String(${valueSourceExpr(action.value, ctx, id)}));`,
        ],
        async: false,
      };
  }
}

/**
 * The handler attribute for one event property, or `''` when the component has no handler.
 *
 * A single unconditional action stays the one-line arrow it has always been: wrapping
 * `onClick={() => navigate("/x")}` in a block would be ceremony around nothing.
 */
export function eventAttr(
  component: Component,
  ctx: EmitContext,
  propKey: string,
  depth: number,
): string {
  const prop = component.props[propKey];
  if (!prop) return '';

  if (prop.kind !== 'event') {
    throw new CompileError(
      `"${propKey}" must hold an event handler, got "${prop.kind}".`,
      component.id,
    );
  }

  const actions = actionsOf(prop.handler);
  if (actions.length === 0) return '';

  const steps = actions.map((action, index) => ({
    action,
    step: stepFor(action, ctx, component.id, index < actions.length - 1),
  }));
  const isAsync = steps.some((entry) => entry.step.async);
  const conditional = actions.some((action) => action.when);

  if (steps.length === 1 && !isAsync && !conditional) {
    const only = steps[0]!.step.lines[0]!;
    return ` ${propKey}={() => ${only.replace(/;$/, '')}}`;
  }

  const body: string[] = [];
  for (const { action, step } of steps) {
    if (!action.when) {
      body.push(...step.lines.map((line) => `${indent(depth + 1)}${line}`));
      continue;
    }
    const test = ctx.conditionExpr(action.when, component.id);
    if (step.lines.length === 1 && !step.async) {
      body.push(`${indent(depth + 1)}if (${test}) ${step.lines[0]}`);
      continue;
    }
    body.push(`${indent(depth + 1)}if (${test}) {`);
    body.push(...step.lines.map((line) => `${indent(depth + 2)}${line}`));
    body.push(`${indent(depth + 1)}}`);
  }

  return ` ${propKey}={${isAsync ? 'async ' : ''}() => {
${body.join('\n')}
${indent(depth)}}}`;
}
