import type { Artboard, Component, Id, Snapshot } from '@loom/ir';
import { CompileError, type EmitContext } from '../types';
import { DOCUMENT_CLASS, documentStyle, isDocument, pageOf } from './document';
import { definitionComponentName } from './definition';
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
import { positionToStyle } from './layout';
import { indent } from './text';
import { tsTypeOf } from '@loom/typesys';
import { MESSAGE_FN } from './messages';
import { authVar, sessionTypeOf } from './auth';
import { DIVIDE_HELPER_SOURCE, emitDerived, planDerived, usesDivideHelper } from './derived';
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

/** One more level in, for a tree that has been wrapped. */
function indentBlock(block: string): string {
  return block
    .split('\n')
    .map((line) => (line ? `  ${line}` : line))
    .join('\n');
}

/** Walk one artboard's component tree into a React function component module. */
export function emitArtboardModule(
  snapshot: Snapshot,
  artboard: Artboard,
  routes: RouteMap,
  componentName: string,
  globals: GlobalPlan[] = [],
  /**
   * Emit a **reusable component** rather than a screen (R1, `docs/V1-COMPLETION.md`).
   *
   * The whole difference is where params come from and what the module's signature looks like:
   * the tree, the styles, the conditions and the nested instances are rendered by exactly the
   * same walker. A second emitter would be a second place for a Frame to be wrong.
   *
   * The caller passes the definition as a synthetic artboard, so the existing param validation
   * ("this reads a param the thing does not declare") keeps working with no special case.
   */
  definition = false,
): string {
  const component = (id: Id): Component => {
    const found = snapshot.components[id];
    if (!found) throw new CompileError(`Unknown component id "${id}".`, id);
    return found;
  };

  /** Who holds whom, so a child can be asked where its parent puts it. */
  const parents = new Map<Id, Component>();
  for (const candidate of Object.values(snapshot.components)) {
    for (const child of candidate.children ?? []) parents.set(child, candidate);
  }

  const seen = new Set<Id>();
  const hooks = {
    params: false,
    navigate: false,
    textHelper: false,
    truthy: false,
    message: false,
    link: false,
    auth: false,
    upload: false,
  };
  const itemScope: string[] = [];
  const fields = new Map<Id, unknown>();
  const pages = new Set<string>();
  const effects: string[] = [];
  const extraStates = new Map<string, unknown>();
  const chartHelpers = new Set<string>();
  /** Reusable components this module places, so their imports can be written (R1). */
  const usedDefinitions = new Set<Id>();
  const calendarHelpers = new Set<string>();
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
    requireDefinition: (definitionId, componentId) => {
      const found = snapshot.definitions?.[definitionId];
      if (!found) {
        throw new CompileError(
          `This component points at a definition that no longer exists.`,
          componentId,
        );
      }
      usedDefinitions.add(definitionId);
      return definitionComponentName(found);
    },
    paramExpr: (name) => {
      // A reusable component is handed its params as React props; a screen reads them off the
      // route. Same property value, different source (R1).
      if (definition) return `(${name} ?? "")`;
      hooks.params = true;
      return `${PARAMS_VAR}.${name} ?? ""`;
    },
    requireNavigate: () => {
      hooks.navigate = true;
      return NAVIGATE_VAR;
    },
    requireFieldState: (componentId, initial) => {
      fields.set(componentId, initial);
      return stateNameForComponent(componentId);
    },
    requireEffect: (code) => {
      effects.push(code);
    },
    requireState: (name, initial) => {
      extraStates.set(name, initial);
      return name;
    },
    requireUpload: () => {
      hooks.upload = true;
      return 'uploadFile';
    },
    requireChart: (names) => {
      for (const name of names) chartHelpers.add(name);
    },
    requireCalendar: (names) => {
      for (const name of names) calendarHelpers.add(name);
    },
    requirePageState: (componentId) => {
      const name = `page_${componentId.replace(/[^a-zA-Z0-9_]/g, '_')}`;
      pages.add(name);
      return name;
    },
    requireMessage: () => {
      hooks.message = true;
      return MESSAGE_FN;
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
      // The current user's ports carry their own types, so a Text bound to "signed in" still
      // knows it is holding a boolean rather than something to print raw.
      const session = sessionTypeOf(snapshot, value.source);
      if (session) return session;
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
    requireLink: () => {
      hooks.link = true;
      return 'Link';
    },
    requireAuth: () => {
      hooks.auth = true;
      return authVar();
    },
    positionStyle: (target) => positionToStyle(target, parents.get(target.id)),
    pathExpr: (flowId, componentId) => {
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

      return pathExpression(destination, values);
    },
    // Going somewhere and *being able to point at it* are the same destination reached two ways:
    // a handler for a Button, an `href` for a Link.
    navigateExpr: (flowId, componentId) =>
      `${ctx.requireNavigate()}(${ctx.pathExpr(flowId, componentId)})`,
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

  const rendered = render(artboard.root, 2);

  /**
   * A document is wrapped, not restyled (L2, `docs/V1-COMPLETION.md`).
   *
   * The wrapper carries the page — its size in millimetres and its margin — and the class the
   * print stylesheet looks for. Putting that on the root component itself would mean a designer's
   * own padding and the paper's margin fighting over one property, and whichever they set last
   * would win by accident.
   */
  let definitionImports = '';
  const tree = isDocument(artboard)
    ? (() => {
        const page = pageOf(artboard);
        const style = Object.entries(documentStyle(page))
          .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
          .join(', ');
        return `    <div className="${DOCUMENT_CLASS}" style={{ ${style} }}>
${indentBlock(rendered)}
    </div>`;
      })()
    : rendered;

  /**
   * A reusable component's params are its props, written out as a real typed signature so the
   * emitted repo reads like a repo. A screen takes nothing: its params come off the route.
   */
  const declaredParams = artboard.params ?? [];
  const signature =
    definition && declaredParams.length > 0
      ? `{ ${declaredParams.map((param) => param.name).join(', ')} }: { ${declaredParams
          .map((param) => `${param.name}?: ${tsTypeOf(param.type)}`)
          .join('; ')} }`
      : '';

  /**
   * A screen reaches a component through `../components/`; a component reaches another through
   * `./`, because it is already in that folder. Sorted, so the import block is stable between
   * compiles and a diff shows only what changed.
   */
  if (usedDefinitions.size > 0) {
    const prefix = definition ? './' : '../components/';
    const lines = [...usedDefinitions]
      .map((id) => definitionComponentName(snapshot.definitions![id]!))
      .sort()
      .map((name) => `import ${name} from '${prefix}${name}';`);
    definitionImports = `${lines.join('\n')}\n`;
  }

  const imports: string[] = [];
  const reactHooks = reactHooksUsed(
    plans,
    states,
    fields.size > 0 || pages.size > 0 || extraStates.size > 0 || derived.some((d) => d.runName),
    effects.length > 0,
  );
  if (reactHooks.length > 0) imports.push(`import { ${reactHooks.join(', ')} } from 'react';\n`);

  const routerHooks = [
    hooks.link ? 'Link' : null,
    hooks.navigate ? 'useNavigate' : null,
    hooks.params ? 'useParams' : null,
  ]
    .filter(Boolean)
    .join(', ');
  if (routerHooks) imports.push(`import { ${routerHooks} } from 'react-router-dom';\n`);
  // An app-wide variable lives above the router, so a screen reaches it through the context hook
  // rather than owning it (`emit/globals.ts`).
  if (usesGlobals(states)) imports.push(`import { useGlobals } from '../state/globals';\n`);
  if (hooks.message) imports.push(`import { useMessages } from '../state/messages';\n`);
  // Three steps that never touch a credential: ask, send, report (`docs/29-storage.md`).
  if (hooks.upload) imports.push(`import { uploadFile } from '../upload';\n`);
  // Inline SVG, drawn from one module the whole project shares (`docs/30-charts.md`).
  if (chartHelpers.size > 0) {
    imports.push(`import { ${[...chartHelpers].sort().join(', ')} } from '../charts';\n`);
  }
  if (calendarHelpers.size > 0) {
    imports.push(`import { ${[...calendarHelpers].sort().join(', ')} } from '../calendar';\n`);
  }
  // The session is held above the router too: it outlives every screen, and the screen showing
  // who is here should not be the thing deciding who is here (`emit/auth.ts`).
  if (hooks.auth) imports.push(`import { useAuth } from '../state/auth';\n`);

  const prelude: string[] = [];
  if (hooks.navigate) prelude.push(`  const ${NAVIGATE_VAR} = useNavigate();`);
  // The toast is one host above the router, so a message outlives the screen that sent it.
  if (hooks.message) prelude.push(`  const { ${MESSAGE_FN} } = useMessages();`);
  if (hooks.params) prelude.push(`  const ${PARAMS_VAR} = useParams();`);
  if (hooks.auth) prelude.push(`  const ${authVar()} = useAuth();`);
  for (const name of pages) prelude.push(`  const [${name}, set_${name}] = useState(0);`);
  for (const [name, initial] of extraStates) {
    prelude.push(`  const [${name}, set_${name}] = useState(${JSON.stringify(initial)});`);
  }
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
  // Effects last of all: one may read a derived value, and nothing above reads an effect.
  prelude.push(...effects);

  return `// Generated by @loom/compiler from artboard "${artboard.name}" (${artboard.id}).
// Managed region: edits here are overwritten on the next compile.
${definitionImports}${imports.join('')}${hooks.truthy ? TRUTHY_HELPER_SOURCE : ''}${hooks.textHelper ? TEXT_HELPER_SOURCE : ''}${usesDivideHelper(derived) ? DIVIDE_HELPER_SOURCE : ''}
export default function ${componentName}(${signature}) {
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
  hasEffects = false,
): string[] {
  const used: string[] = [];
  if (plans.length > 0) used.push('useCallback');
  // Imported once however many things need it: the emitted app builds with `noUnusedLocals`, and
  // a duplicate name in an import list is a syntax error rather than a warning.
  if (plans.some((plan) => !plan.trigger) || hasEffects) used.push('useEffect');
  // A global is state the provider owns, not this module — only a screen variable needs the hook.
  if (hasFields || plans.length > 0 || states.some((state) => state.scope === 'screen')) {
    used.push('useState');
  }
  return used;
}

/** Re-exported for the templates that read plain property values. */
export { valueExpr };
