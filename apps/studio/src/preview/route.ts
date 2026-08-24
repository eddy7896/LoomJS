import { planRoutes } from '@loom/compiler';
import type { Id, Snapshot } from '@loom/ir';
import { entryArtboardId } from '../state/store';

/**
 * Where the Preview should be pointed, for the screen being designed (`docs/12-canvas.md`).
 *
 * Routes are derived, never authored: the entry artboard answers on `/` and every other one on a
 * path made from its name. That is decided by the compiler, so it is *asked* here rather than
 * worked out again — a second copy of the rule would drift, and the day it drifted the Preview
 * would navigate somewhere the app does not serve.
 */
export interface PreviewRoute {
  path: string;
  /** Dynamic segments the screen declares. A route with these has no honest address to jump to. */
  params: readonly string[];
}

export function previewRoute(snapshot: Snapshot, artboardId: Id): PreviewRoute | undefined {
  const entry = snapshot.artboards[entryArtboardId(snapshot)];
  if (!entry) return undefined;

  try {
    const route = planRoutes(snapshot, entry).get(artboardId);
    return route ? { path: route.path, params: route.params } : undefined;
  } catch {
    // A document the compiler refuses has no routes to point at. Saying so is Problems' job, and
    // the Preview showing what it last had beats it throwing.
    return undefined;
  }
}

/**
 * The address to send the frame to, or nothing.
 *
 * A screen with params — `/order/:id` — is reachable only *through* the app, from whatever supplies
 * the id. Inventing one would render the screen against a record that does not exist, which looks
 * like a working preview of broken data. Better to leave the frame where it is.
 */
export function navigablePath(route: PreviewRoute | undefined): string | undefined {
  if (!route || route.params.length > 0) return undefined;
  return route.path;
}
