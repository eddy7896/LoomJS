import type {
  Artboard,
  Component,
  Condition,
  Id,
  PortRef,
  PropertyValue,
  Snapshot,
  TypeRef,
} from '@loom/ir';
import type { RouteMap } from './emit/routes';
import type { PipelinePlan } from './emit/pipeline';
import type { DerivedPlan } from './emit/derived';
import type { ScreenStatePlan } from './emit/state';

/** One file the compiler emits. `path` is POSIX-relative to the output root. */
export interface EmittedFile {
  path: string;
  content: string;
}

export interface CompileResult {
  files: EmittedFile[];
}

/**
 * Raised when the graph cannot be turned into code. Carries the offending entity id so
 * the editor can map the failure back to a node/component (the Build error tier, docs/02).
 */
export class CompileError extends Error {
  readonly entityId: string | undefined;

  constructor(message: string, entityId?: string) {
    super(message);
    this.name = 'CompileError';
    this.entityId = entityId;
  }
}

/** What an emitter can reach while rendering one component. */
export interface EmitContext {
  snapshot: Snapshot;
  /** The artboard being emitted — owns the route params in scope. */
  artboard: Artboard;
  routes: RouteMap;
  /** Pipelines touching this artboard (spec 4). */
  plans: PipelinePlan[];
  /** Values derived in the browser by function nodes outside any API route. */
  derived: DerivedPlan[];
  /** Screen buckets this artboard reads: many writers, one reader (`emit/state.ts`). */
  states: ScreenStatePlan[];
  /** Resolve a component id or fail loudly (dangling ids are a compile error, not undefined). */
  component: (id: Id) => Component;
  /** Render a child subtree at the given indent depth. */
  renderChild: (id: Id, depth: number) => string;
  /** Declare that this module needs `useParams()`; returns the local variable name. */
  requireParams: () => string;
  /** Declare that this module needs `useNavigate()`; returns the local variable name. */
  requireNavigate: () => string;
  /** The current row variable, when emitting inside a List template; undefined outside one. */
  itemVar: () => string | undefined;
  /** Emit `render` with `item` in scope, for a List's per-row template. */
  withItem: <T>(item: string, render: () => T) => T;
  /**
   * Declare local state for a controlled input; returns its variable name. The initial value
   * carries its own type — a number field's state is a number, a checkbox's is a boolean — so a
   * form can fill a typed column without a cast.
   */
  requireFieldState: (componentId: Id, initial: unknown) => string;
  /**
   * Declare that this screen shows messages; returns the state variable behind the toast. Like
   * every other local, it is only emitted when something actually sets it.
   */
  requireMessage: () => string;
  /** The JS expression that navigates along `flowId` (path + payload). */
  navigateExpr: (flowId: Id, componentId: Id) => string;
  /**
   * The path `flowId` reaches, as an expression — the same route `navigateExpr` would go to, but
   * as a value. A real `<a>` needs the destination in its `href`, not a handler that goes there.
   */
  pathExpr: (flowId: Id, componentId: Id) => string;
  /** Declare that this module renders a router `<Link>`; returns the component name to emit. */
  requireLink: () => string;
  /** The type a property value carries, when it is knowable (bindings). */
  typeOfValue: (value: PropertyValue) => TypeRef | undefined;
  /** Declare a page number for a paging List; returns its state variable name. */
  requirePageState: (componentId: Id) => string;
  /** Declare that this module needs the text coercion helper; returns its name. */
  requireTextHelper: () => string;
  /** The JS expression a condition compiles to, already truthy-coerced (spec 6). */
  conditionExpr: (condition: Condition, componentId: Id) => string;
}

/** A component type owns its code template (docs/02 — compile = stitch templates). */
export interface ComponentEmitter {
  type: string;
  emit: (component: Component, ctx: EmitContext, depth: number) => string;
}
