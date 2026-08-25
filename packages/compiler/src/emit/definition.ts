import type { ComponentDefinition, Snapshot } from '@loom/ir';
import { CompileError } from '../types';

/**
 * Reusable components (R1, `docs/V1-COMPLETION.md`), compiled.
 *
 * ## What it is
 *
 * A definition becomes **one real React component** in `src/components/`, and every instance
 * becomes a call to it. A header defined once and placed on three screens is one function used
 * three times, which is what a developer opening the repo expects to find.
 *
 * ## A shell is one of these
 *
 * A definition holding an `Outlet` is an **app shell**: the frame a set of screens render inside
 * (R2). It used to be its own kind of thing — `LayoutDefinition` was `{ id, name, root }` and this
 * is that plus params — and the second concept bought nothing. What made a shell a shell was never
 * its shape; it was the slot in its tree, so that is what decides it.
 *
 * The one rule that follows: a definition with a slot is **used as a shell, not placed as an
 * instance**. Placing one would put a second `Outlet` in the route tree, and react-router would
 * render the page twice.
 *
 * ## What a definition is allowed to be, in V1
 *
 * **Presentational.** Its tree may hold static props, its own params, styles, conditions and other
 * instances. It may not bind to a node or own a pipeline.
 *
 * That is a real boundary rather than a missing feature. A definition placed on three screens with
 * a pipeline inside it would need three pipelines — one per placement, each reading different
 * data — and deciding which is which is exactly the problem reusable *pipelines* solve (R4). Doing
 * it accidentally here would mean one definition whose behaviour depended on where it was dropped.
 *
 * Everything a definition needs from the outside comes through its **params**, which is also why
 * an instance's ports are its definition's params and nothing else.
 */

/** Every `Outlet` inside a subtree. */
function outletsIn(snapshot: Snapshot, rootId: string): string[] {
  const found: string[] = [];
  const walk = (id: string): void => {
    const component = snapshot.components[id];
    if (!component) return;
    if (component.type === 'Outlet') found.push(id);
    for (const child of component.children ?? []) walk(child);
  };
  walk(rootId);
  return found;
}

/** A definition with a screen slot in it is a shell. That is the whole test. */
export function isShell(snapshot: Snapshot, definition: ComponentDefinition): boolean {
  return outletsIn(snapshot, definition.root).length > 0;
}

/** The definitions a project can place as instances — everything that is not a shell. */
export function placeableDefinitions(snapshot: Snapshot): ComponentDefinition[] {
  return Object.values(snapshot.definitions ?? {}).filter(
    (definition) => !isShell(snapshot, definition),
  );
}

/** The definitions a screen can render inside. */
export function shellDefinitions(snapshot: Snapshot): ComponentDefinition[] {
  return Object.values(snapshot.definitions ?? {}).filter((definition) =>
    isShell(snapshot, definition),
  );
}

/**
 * Refuse the shell shapes that cannot work, naming the **component** — the thing a designer would
 * go and fix. A failure inside the walker would name a component id instead.
 */
export function validateShells(snapshot: Snapshot): void {
  for (const definition of Object.values(snapshot.definitions ?? {})) {
    const outlets = outletsIn(snapshot, definition.root);
    // None is not an error: that is an ordinary component, and most of them are.
    if (outlets.length > 1) {
      throw new CompileError(
        `"${definition.name}" has ${outlets.length} screen slots. A screen can only be in one ` +
          `place, so keep the one the page belongs in and delete the rest.`,
        definition.id,
      );
    }
  }

  // A screen pointing at something that is not a shell would render into nothing.
  for (const artboard of Object.values(snapshot.artboards)) {
    if (!artboard.shellId) continue;
    const shell = snapshot.definitions?.[artboard.shellId];
    if (shell && !isShell(snapshot, shell)) {
      throw new CompileError(
        `"${artboard.name}" renders inside "${shell.name}", which has no screen slot — so there ` +
          `is nowhere for the page to appear. Put a screen slot in it.`,
        artboard.id,
      );
    }
  }
}

/** `Invoice header` -> `InvoiceHeader`. A React component name, from a name someone typed. */
export function definitionComponentName(definition: ComponentDefinition): string {
  const cleaned = definition.name
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join('');

  // A name that survives nothing — "…" or "123" — still has to produce a legal identifier.
  return /^[A-Za-z]/.test(cleaned)
    ? cleaned
    : `Component${definition.id.replace(/[^a-zA-Z0-9]/g, '')}`;
}

export function definitionPath(definition: ComponentDefinition): string {
  return `src/components/${definitionComponentName(definition)}.tsx`;
}

/**
 * Definitions in the order they must be emitted, and a refusal when they contain themselves.
 *
 * A component holding an instance of itself is infinite, and the failure without this check is a
 * stack overflow in the emitted app at run time — a crash with no line number and no relation to
 * the decision that caused it. Refusing at build time names the definition instead.
 */
export function orderDefinitions(snapshot: Snapshot): ComponentDefinition[] {
  const definitions = Object.values(snapshot.definitions ?? {});
  if (definitions.length === 0) return [];

  /** Which definitions each one places inside itself. */
  const uses = new Map<string, Set<string>>();
  for (const definition of definitions) {
    const found = new Set<string>();
    const walk = (id: string): void => {
      const component = snapshot.components[id];
      if (!component) return;
      if (component.type === 'Instance') {
        const chosen = component.props.defId;
        if (chosen?.kind === 'static') found.add(String(chosen.value ?? ''));
      }
      for (const child of component.children ?? []) walk(child);
    };
    walk(definition.root);
    uses.set(definition.id, found);
  }

  const ordered: ComponentDefinition[] = [];
  const done = new Set<string>();
  const onStack = new Set<string>();

  const visit = (id: string): void => {
    if (done.has(id)) return;
    const definition = snapshot.definitions?.[id];
    if (!definition) return;

    if (onStack.has(id)) {
      throw new CompileError(
        `"${definition.name}" contains itself, directly or through another component. A component ` +
          `that holds itself never finishes rendering.`,
        definition.id,
      );
    }

    onStack.add(id);
    for (const used of uses.get(id) ?? []) visit(used);
    onStack.delete(id);

    done.add(id);
    ordered.push(definition);
  };

  for (const definition of definitions) visit(definition.id);
  return ordered;
}

/**
 * Which screens each shell holds, and which are on their own.
 *
 * A screen naming a shell that has been deleted is put back on its own rather than refused: the
 * screen is still a perfectly good screen, and losing the project over a dangling reference would
 * be a worse answer than losing the sidebar.
 */
export function groupByShell(
  snapshot: Snapshot,
  artboardIds: readonly string[],
): { shells: Map<string, string[]>; loose: string[] } {
  const shells = new Map<string, string[]>();
  const loose: string[] = [];

  for (const id of artboardIds) {
    const shellId = snapshot.artboards[id]?.shellId;
    if (shellId && snapshot.definitions?.[shellId]) {
      const existing = shells.get(shellId) ?? [];
      existing.push(id);
      shells.set(shellId, existing);
    } else {
      loose.push(id);
    }
  }

  return { shells, loose };
}
