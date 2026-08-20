import type { Artboard, Component, Id, Snapshot } from '@loom/ir';
import type { RouteMap } from './emit/routes';

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
  /** Resolve a component id or fail loudly (dangling ids are a compile error, not undefined). */
  component: (id: Id) => Component;
  /** Render a child subtree at the given indent depth. */
  renderChild: (id: Id, depth: number) => string;
  /** Declare that this module needs `useParams()`; returns the local variable name. */
  requireParams: () => string;
  /** Declare that this module needs `useNavigate()`; returns the local variable name. */
  requireNavigate: () => string;
  /** The JS expression that navigates along `flowId` (path + payload). */
  navigateExpr: (flowId: Id, componentId: Id) => string;
}

/** A component type owns its code template (docs/02 — compile = stitch templates). */
export interface ComponentEmitter {
  type: string;
  emit: (component: Component, ctx: EmitContext, depth: number) => string;
}
