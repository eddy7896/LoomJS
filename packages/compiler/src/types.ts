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
  /**
   * The expression a declared param reads from.
   *
   * A screen's params come off the route (`useParams()`); a **reusable component's** come in as
   * React props (R1). The two are the same idea — a value the thing is given rather than one it
   * holds — so they are the same `param` property value, and only where it is read from differs.
   */
  paramExpr: (name: string, componentId: Id) => string;
  /**
   * Declare that this module places a reusable component; returns the name to render (R1).
   *
   * The import is added by the module walker rather than by the instance template, because only
   * the walker knows where the module it is writing sits — a screen reaches a component through
   * `../components/`, and a component reaches another through `./`.
   */
  requireDefinition: (definitionId: Id, componentId: Id) => string;
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
  /** Declare that this shell renders the slot its screens appear in (R2). */
  requireOutlet: () => void;
  /**
   * Declare that this module catches a render error somewhere inside it (L1); returns the
   * component name to emit. A List asks for it so one bad row does not blank the rest.
   */
  requireBoundary: () => string;
  /**
   * Declare that this screen reads or changes who is signed in; returns the local holding the
   * session (spec 10). It carries no token — only who the server says is here.
   */
  requireAuth: () => string;
  /** The type a property value carries, when it is knowable (bindings). */
  typeOfValue: (value: PropertyValue) => TypeRef | undefined;
  /**
   * Declare a `useEffect` the component needs, written out in full.
   *
   * A leaf emitter cannot add hooks to the module on its own, and some elements genuinely need one
   * — a carousel that advances by itself is a timer, and a timer that is never cleared is a leak
   * that outlives the screen. The effect is emitted after the derived values, so it may read them.
   */
  requireEffect: (code: string) => void;
  /**
   * Declare a piece of state the component owns, by name.
   *
   * `requireFieldState` is the *value* of an input — one per component, and what a binding reads.
   * This is for everything else an element needs to remember: an upload knows whether it is busy
   * and what went wrong, and neither belongs in the value that ends up in a database column.
   */
  requireState: (name: string, initial: unknown) => string;
  /** Declare that this module uploads files; returns the helper's name. */
  requireUpload: () => string;
  /**
   * Declare the chart helpers this module uses (`docs/30-charts.md`).
   *
   * By name, and only the ones actually called: the emitted app builds with `noUnusedLocals`, so an
   * import list written to cover every chart would fail the build of a project that has one.
   */
  requireChart: (names: readonly string[]) => void;
  /** The same, for the calendar arithmetic (`docs/31-calendar-chat.md`). */
  requireCalendar: (names: readonly string[]) => void;
  /** Declare a page number for a paging List; returns its state variable name. */
  requirePageState: (componentId: Id) => string;
  /** Declare that this module needs the text coercion helper; returns its name. */
  requireTextHelper: () => string;
  /** The JS expression a condition compiles to, already truthy-coerced (spec 6). */
  conditionExpr: (condition: Condition, componentId: Id) => string;
  /**
   * Where a component sits, when its parent is a **free** frame — empty for everything else.
   * Asked here rather than computed in each template, because it depends on the *parent*, which
   * only the walker knows (`docs/12-canvas.md`).
   */
  positionStyle: (component: Component) => Record<string, string | number>;
}

/** A component type owns its code template (docs/02 — compile = stitch templates). */
export interface ComponentEmitter {
  type: string;
  emit: (component: Component, ctx: EmitContext, depth: number) => string;
}
