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

const PARAMS_VAR = 'params';
const NAVIGATE_VAR = 'navigate';
const TEXT_HELPER = 'asText';

/**
 * Bound values are not always strings — a screen bucket can hold the row an insert returned.
 * React throws on an object child, so a value whose type is not text passes through here first.
 */
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
): string {
  const component = (id: Id): Component => {
    const found = snapshot.components[id];
    if (!found) throw new CompileError(`Unknown component id "${id}".`, id);
    return found;
  };

  const seen = new Set<Id>();
  const hooks = { params: false, navigate: false, textHelper: false };
  const itemScope: string[] = [];
  const fields = new Map<Id, string>();
  const plans = planPipelines(snapshot, artboard);

  const ctx: EmitContext = {
    snapshot,
    artboard,
    routes,
    plans,
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
      const plan = plans.find((candidate) => candidate.node.id === target.nodeId);
      if (!plan) {
        throw new CompileError(
          `Trigger points at node "${target.nodeId}", which is not a pipeline on this screen.`,
          componentId,
        );
      }
      return `void ${plan.names.run}()`;
    },
    typeOfValue: (value) => (value.kind === 'bound' ? boundTypeOf(plans, value.source) : undefined),
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
    return emitter.emit(target, ctx, depth);
  }

  const tree = render(artboard.root, 2);

  const imports: string[] = [];
  const reactHooks = reactHooksUsed(plans, fields.size > 0);
  if (reactHooks.length > 0) imports.push(`import { ${reactHooks.join(', ')} } from 'react';\n`);

  const routerHooks = [hooks.navigate ? 'useNavigate' : null, hooks.params ? 'useParams' : null]
    .filter(Boolean)
    .join(', ');
  if (routerHooks) imports.push(`import { ${routerHooks} } from 'react-router-dom';\n`);

  const prelude: string[] = [];
  if (hooks.navigate) prelude.push(`  const ${NAVIGATE_VAR} = useNavigate();`);
  if (hooks.params) prelude.push(`  const ${PARAMS_VAR} = useParams();`);
  for (const [componentId, initial] of fields) {
    const name = stateNameForComponent(componentId);
    prelude.push(`  const [${name}, set_${name}] = useState(${JSON.stringify(initial)});`);
  }
  prelude.push(...emitPipelinePrelude(plans));

  return `// Generated by @loom/compiler from artboard "${artboard.name}" (${artboard.id}).
// Managed region: edits here are overwritten on the next compile.
${imports.join('')}${hooks.textHelper ? TEXT_HELPER_SOURCE : ''}
export default function ${componentName}() {
${prelude.length > 0 ? `${prelude.join('\n')}\n\n` : ''}  return (
${tree}
  );
}
`;
}

/** Only the hooks the module actually uses — the emitted app compiles with noUnusedLocals. */
function reactHooksUsed(plans: PipelinePlan[], hasFields: boolean): string[] {
  const used: string[] = [];
  if (plans.length > 0) used.push('useCallback');
  if (plans.some((plan) => !plan.trigger)) used.push('useEffect');
  if (hasFields || plans.length > 0) used.push('useState');
  return used;
}

/** Re-exported for the templates that read plain property values. */
export { valueExpr };
