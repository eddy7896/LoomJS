import type { Component, Id, Snapshot } from '@loom/ir';

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
  /** Resolve a component id or fail loudly (dangling ids are a compile error, not undefined). */
  component: (id: Id) => Component;
  /** Render a child subtree at the given indent depth. */
  renderChild: (id: Id, depth: number) => string;
}

/** A component type owns its code template (docs/02 — compile = stitch templates). */
export interface ComponentEmitter {
  type: string;
  emit: (component: Component, ctx: EmitContext, depth: number) => string;
}
