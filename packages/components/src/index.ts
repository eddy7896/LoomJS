import { componentDefs, type ComponentDef } from './defs';

export * from './icons';
export * from './defs';
export * from './nodes';
export * from './variants';

/**
 * The element types the palette offers.
 *
 * An `Instance` is deliberately absent: it is created by promoting a frame or by placing a
 * definition, and one with nothing behind it has nothing to render (R1).
 */
export function placeableDefs(): readonly ComponentDef[] {
  return componentDefs().filter((def) => def.placeable !== false);
}
