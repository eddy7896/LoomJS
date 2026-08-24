import type { Artboard, Snapshot } from '@loom/ir';
import { CompileError } from '../types';
import { pascalCase } from './text';

/**
 * Flow-arrows-as-router (docs/02): each artboard is a route, the entry artboard is `/`, and an
 * artboard that declares params gets a dynamic path. Routes are derived, never authored — the
 * designer draws an arrow, not a URL.
 */

export interface RouteInfo {
  artboardId: string;
  /** React component name for the artboard module. */
  componentName: string;
  /** e.g. `/`, `/detail`, `/detail/:id` */
  path: string;
  params: string[];
}

export type RouteMap = Map<string, RouteInfo>;

/** `Item detail` -> `item-detail` */
export function kebabCase(input: string): string {
  const slug = input
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'screen';
}

export function planRoutes(snapshot: Snapshot, entry: Artboard): RouteMap {
  const routes: RouteMap = new Map();
  const takenNames = new Set<string>();
  const takenPaths = new Set<string>();

  const ordered = Object.entries(snapshot.artboards).sort(([a], [b]) => a.localeCompare(b));

  for (const [id, artboard] of ordered) {
    const baseName = pascalCase(artboard.name);
    let componentName = baseName;
    let n = 2;
    while (takenNames.has(componentName)) componentName = `${baseName}${n++}`;
    takenNames.add(componentName);

    const params = (artboard.params ?? []).map((p) => p.name);
    for (const param of params) {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(param)) {
        throw new CompileError(`Param "${param}" is not a valid identifier.`, id);
      }
    }

    let base = id === entry.id ? '' : `/${kebabCase(artboard.name)}`;
    if (base !== '' && takenPaths.has(base)) {
      let suffix = 2;
      while (takenPaths.has(`${base}-${suffix}`)) suffix++;
      base = `${base}-${suffix}`;
    }
    takenPaths.add(base);

    const path = `${base}${params.map((p) => `/:${p}`).join('')}` || '/';
    routes.set(id, { artboardId: id, componentName, path, params });
  }

  return routes;
}

/**
 * Build the JS expression a navigate() call takes, filling the destination's dynamic segments
 * from the flow's payload.
 */
export function pathExpression(route: RouteInfo, values: Map<string, string>): string {
  if (route.params.length === 0) return JSON.stringify(route.path);

  const segments = route.path.split('/').filter(Boolean);
  const parts: string[] = [];

  for (const segment of segments) {
    if (!segment.startsWith(':')) {
      parts.push(JSON.stringify(`/${segment}`));
      continue;
    }
    const name = segment.slice(1);
    const expr = values.get(name);
    if (!expr) {
      throw new CompileError(
        `Flow to "${route.componentName}" is missing a value for param "${name}".`,
        route.artboardId,
      );
    }
    parts.push(`"/" + encodeURIComponent(String(${expr}))`);
  }

  return parts.join(' + ');
}
