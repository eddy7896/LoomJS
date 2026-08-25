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
