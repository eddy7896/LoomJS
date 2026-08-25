import type { LayoutDefinition, Snapshot } from '@loom/ir';
import { CompileError } from '../types';

/**
 * App shells — one sidebar across forty routes (R2, `docs/V1-COMPLETION.md`), compiled.
 *
 * ## Why this blocks every target app class
 *
 * Every dashboard-shaped app — ERP, CRM, school, B2B SaaS — is a persistent frame with a page
 * inside it. Until now each screen was a whole page, so a sidebar had to be redrawn on every one
 * of them, and changing a nav item meant changing it forty times. That is not a product.
 *
 * ## Mounted once, not re-rendered per navigation
 *
 * A shell is emitted as a react-router **layout route**: a `<Route>` with no path of its own whose
 * children are the screens inside it. React keeps the shell mounted and swaps only what is inside
 * the `<Outlet />`.
 *
 * That is the difference between a shell and a component every screen happens to place. The second
 * one would look identical and would tear the sidebar down and rebuild it on every click — losing
 * its scroll position, closing its open sections, and re-running anything it does on mount.
 *
 * ## What makes a subtree a shell
 *
 * **Exactly one `Outlet`.** None and the screens have nowhere to render; two and react-router
 * renders the page twice. Both are refused at build time, because both fail in a way that points
 * nowhere near the decision that caused them.
 */

/** `Main shell` -> `MainShell`. */
export function shellComponentName(layout: LayoutDefinition): string {
  const cleaned = layout.name
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join('');

  return /^[A-Za-z]/.test(cleaned) ? cleaned : `Shell${layout.id.replace(/[^a-zA-Z0-9]/g, '')}`;
}

export function shellPath(layout: LayoutDefinition): string {
  return `src/layouts/${shellComponentName(layout)}.tsx`;
}

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

/**
 * The shells a project has, refusing the two shapes that cannot work.
 *
 * Checked here rather than in the emitter so the message names the **layout**, which is the thing
 * a designer would go and fix. A failure inside the walker would name a component id instead.
 */
export function validShells(snapshot: Snapshot): LayoutDefinition[] {
  const layouts = Object.values(snapshot.layouts ?? {});

  for (const layout of layouts) {
    const outlets = outletsIn(snapshot, layout.root);

    if (outlets.length === 0) {
      throw new CompileError(
        `"${layout.name}" has no screen slot, so the screens using it would have nowhere to ` +
          `appear. Put a screen slot where the page should go.`,
        layout.id,
      );
    }
    if (outlets.length > 1) {
      throw new CompileError(
        `"${layout.name}" has ${outlets.length} screen slots. A screen can only be in one place, ` +
          `so keep the one the page belongs in and delete the rest.`,
        layout.id,
      );
    }
  }

  return layouts;
}

/**
 * Which screens each shell holds, and which are on their own.
 *
 * A screen naming a layout that has been deleted is put back on its own rather than refused: the
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
    const layoutId = snapshot.artboards[id]?.layoutId;
    if (layoutId && snapshot.layouts?.[layoutId]) {
      const existing = shells.get(layoutId) ?? [];
      existing.push(id);
      shells.set(layoutId, existing);
    } else {
      loose.push(id);
    }
  }

  return { shells, loose };
}
