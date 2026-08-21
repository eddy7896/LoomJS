import type { Artboard, Component, Id, Snapshot } from '@loom/ir';
import { CompileError, type EmitContext } from '../types';
import { emitterFor, knownComponentTypes } from '../templates/registry';
import { pathExpression, type RouteMap } from './routes';
import {
  boundTypeOf,
  emitPipelinePrelude,
  planPipelines,
  stateNameForComponent,
  type PipelinePlan,
} from './pipeline';
import { valueExpr } from './props';
import { indent } from './text';
import {
  DIVIDE_HELPER_SOURCE,
  emitDerived,
  planDerived,
  usesDivideHelper,
} from './derived';
import {
  emitScreenStates,
  planScreenStates,
  usesGlobals,
  type GlobalPlan,
  type ScreenStatePlan,
} from './state';

const PARAMS_VAR = 'params';
const NAVIGATE_VAR = 'navigate';
const TEXT_HELPER = 'asText';
const TRUTHY_HELPER = 'isOn';

/**
 * Bound values are not always strings — a screen bucket can hold the row an insert returned.
 * React throws on an object child, so a value whose type is not text passes through here first.
 */
/**
 * One truthiness rule for the whole emitted app. A form field arrives as the string "true" and a
 * checkbox arrives as a boolean; both mean checked, and nothing else does.
 */
const TRUTHY_HELPER_SOURCE = `
function ${TRUTHY_HELPER}(value: unknown): boolean {
  return value === true || value === 'true';
}
`;

const TEXT_HELPER_SOURCE = `
function ${TEXT_HELPER}(value: unknown): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}
`;

/** Walk one artboard's component tree into a React function component module. */
export function emitArtboardModule(
  snapshot: Snapshot,
  artboard: Artboard,
  routes: RouteMap,
  componentName: string,
  globals: GlobalPlan[] = [],
): string {
  const component = (id: Id): Component => {
    const found = snapshot.components[id];
    if (!found) throw new CompileError(`Unknown component id "${id}".`, id);
    return found;
  };

  const seen = new Set<Id>();
  const hooks = { params: false, navigate: false, textHelper: false, truthy: false };
  const itemScope: string[] = [];
  const fields = new Map<Id, unknown>();
  // Buckets first: they are the merge point every other plan needs to know about. A pipeline has
  // to know which buckets its success path sets, and a derivation is *demanded* by a bucket it
  // writes even when no property binds it (`emit/state.ts`).
  const states = planScreenStates(snapshot, artboard, globals);
  const plans = planPipelines(snapshot, artboard, states);
  // Function nodes outside any API route run here, in the browser: the container boundary is the
  // network boundary (`docs/specs/binding-trigger-runtime.md`).
  const derived = planDerived(snapshot, artboard, plans, states);

  const ctx: EmitContext = {
    snapshot,
    artboard,
    routes,
    plans,
    derived,
    states,
    component,
    renderChild: (id, depth) => render(id, depth),
    itemVar: () => itemScope[itemScope.length - 1],
    withItem: (item, render) => {
      itemScope.push(item);
      try {
        return render();
      } finally {
        itemScope.pop();
      }
    },
    requireParams: () => {
      hooks.params = true;
      return PARAMS_VAR;
    },
    requireNavigate: () => {
      hooks.navigate = true;
      return NAVIGATE_VAR;
    },
    requireFieldState: (componentId, initial) => {
      fields.set(componentId, initial);
      return stateNameForComponent(componentId);
    },
    triggerExpr: (target, componentId) => {
      // A trigger can fire a pipeline (a request) or a derivation (a recomputation in place).
      const derivation = derived.find((entry) => entry.node.id === target.nodeId);
      if (derivation) {
        if (!derivation.runName) {
          throw new CompileError(
            `"${derivation.node.name ?? derivation.node.id}" has no run port wired, so nothing fires it.`,
            componentId,
          );
        }
        return `${derivation.runName}()`;
      }

      const plan = plans.find((candidate) => candidate.node.id === target.nodeId);
      if (!plan) {
        // A function node this screen never planned is one nothing consumes — it was dropped as
        // demand-driven dead code. Saying "not a pipeline" sends the reader looking for a routing
        // mistake; the actual fix is at the other end, where the answer should have gone.
        const node = snapshot.nodes[target.nodeId];
        if (node?.category === 'fn') {
          throw new CompileError(
            `"${node.name ?? node.kind}" runs when this is pressed, but nothing on this screen ` +
              `shows or keeps its result, so pressing it would do nothing. Bind its result to a ` +
              `property, or wire it into a variable something reads.`,
            componentId,
          );
        }
        throw new CompileError(
          `Trigger points at node "${target.nodeId}", which is not a pipeline on this screen.`,
          componentId,
        );
      }
      return `void ${plan.names.run}()`;
    },
    conditionExpr: (condition, componentId) => {
      hooks.truthy = true;
      const value = valueExpr(
        { kind: 'bound', source: condition.source },
        ctx,
        componentId,
        'condition',
      );
      const test = `${TRUTHY_HELPER}(${value})`;
      return condition.test === 'not' ? `!${test}` : test;
    },
    typeOfValue: (value) => {
      if (value.kind !== 'bound') return undefined;
      // A binding straight to an input's mirror carries that port's type: a number field read
      // into a Text still has to go through the coercion helper.
      const source = snapshot.nodes[value.source.nodeId];
      if (source?.category === 'ui' && source.mirrorOf) {
        return source.ports.find((port) => port.id === value.source.portId)?.type;
      }
      return boundTypeOf(plans, derived, states, value.source);
    },
    requireTextHelper: () => {
      hooks.textHelper = true;
      return TEXT_HELPER;
    },
    navigateExpr: (flowId, componentId) => {
      const flow = snapshot.flows[flowId];
      if (!flow) throw new CompileError(`Unknown flow "${flowId}".`, componentId);
      if (flow.from !== artboard.id) {
        throw new CompileError(
          `Flow "${flowId}" starts on a different artboard than the component using it.`,
          componentId,
        );
      }
      const destination = routes.get(flow.to);
      if (!destination) throw new CompileError(`Flow "${flowId}" has no destination.`, componentId);

      const values = new Map<string, string>();
      for (const entry of flow.payload ?? []) {
        if (entry.kind === 'bound') {
          throw new CompileError(
            `Flow payload for "${entry.param}" reads a node port, which needs the binding runtime (M3).`,
            componentId,
          );
        }
        // An empty value would emit a path that no route matches — treat it as missing.
        if (entry.value === null || entry.value === undefined || entry.value === '') continue;
        values.set(entry.param, JSON.stringify(entry.value));
      }

      return `${ctx.requireNavigate()}(${pathExpression(destination, values)})`;
    },
  };

  function render(id: Id, depth: number): string {
    // A component reachable twice means the tree is not a tree; emitting it would
    // duplicate state silently.
    if (seen.has(id)) {
      throw new CompileError(`Component "${id}" appears twice in the tree (cycle).`, id);
    }
    seen.add(id);

    const target = component(id);
    const emitter = emitterFor(target.type);
    if (!emitter) {
      throw new CompileError(
        `No template for component type "${target.type}". Known types: ${knownComponentTypes().join(', ')}.`,
        id,
      );
    }

    const element = emitter.emit(target, ctx, depth);
    if (!target.visibleWhen) return element;

    // Not rendered at all, rather than hidden with CSS: an element that still occupies layout,
    // still takes focus and still ships its contents is a bug waiting to be filed — and for an
    // auth-gated panel it is a leak (`docs/specs/conditions.md`).
    const test = ctx.conditionExpr(target.visibleWhen, id);
    return `${indent(depth)}{${test} ? (
${element}
${indent(depth)}) : null}`;
  }

  const tree = render(artboard.root, 2);

  const imports: string[] = [];
  const reactHooks = reactHooksUsed(
    plans,
    states,
    fields.size > 0 || derived.some((d) => d.runName),
  );
  if (reactHooks.length > 0) imports.push(`import { ${reactHooks.join(', ')} } from 'react';\n`);

  const routerHooks = [hooks.navigate ? 'useNavigate' : null, hooks.params ? 'useParams' : null]
    .filter(Boolean)
    .join(', ');
  if (routerHooks) imports.push(`import { ${routerHooks} } from 'react-router-dom';\n`);
  // An app-wide variable lives above the router, so a screen reaches it through the context hook
  // rather than owning it (`emit/globals.ts`).
  if (usesGlobals(states)) imports.push(`import { useGlobals } from '../state/globals';\n`);

  const prelude: string[] = [];
  if (hooks.navigate) prelude.push(`  const ${NAVIGATE_VAR} = useNavigate();`);
  if (hooks.params) prelude.push(`  const ${PARAMS_VAR} = useParams();`);
  for (const [componentId, initial] of fields) {
    const name = stateNameForComponent(componentId);
    prelude.push(`  const [${name}, set_${name}] = useState(${JSON.stringify(initial)});`);
  }
  // Buckets are declared before the pipelines and derivations that set them: a `run` closes over
  // its setter, so the bucket has to exist first.
  prelude.push(...emitScreenStates(states));
  prelude.push(...emitPipelinePrelude(plans));
  // Derived values come last: they may read a field's state or a route's result, both declared
  // above, and nothing reads them but the tree below.
  prelude.push(...emitDerived(derived));

  return `// Generated by @loom/compiler from artboard "${artboard.name}" (${artboard.id}).
// Managed region: edits here are overwritten on the next compile.
${imports.join('')}${hooks.truthy ? TRUTHY_HELPER_SOURCE : ''}${hooks.textHelper ? TEXT_HELPER_SOURCE : ''}${usesDivideHelper(derived) ? DIVIDE_HELPER_SOURCE : ''}
export default function ${componentName}() {
${prelude.length > 0 ? `${prelude.join('\n')}\n\n` : ''}  return (
${tree}
  );
}
`;
}

/** Only the hooks the module actually uses — the emitted app compiles with noUnusedLocals. */
function reactHooksUsed(
  plans: PipelinePlan[],
  states: ScreenStatePlan[],
  hasFields: boolean,
): string[] {
  const used: string[] = [];
  if (plans.length > 0) used.push('useCallback');
  if (plans.some((plan) => !plan.trigger)) used.push('useEffect');
  // A global is state the provider owns, not this module — only a screen variable needs the hook.
  if (hasFields || plans.length > 0 || states.some((state) => state.scope === 'screen')) {
    used.push('useState');
  }
  return used;
}

/** Re-exported for the templates that read plain property values. */
export { valueExpr };
