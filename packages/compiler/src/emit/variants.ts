import type { Component } from '@loom/ir';
import { variantClassName } from '@loom/components';

/**
 * The `className` an element carries (`docs/27-variants.md`).
 *
 * The classes themselves are worked out by `@loom/components`, which the studio's canvas calls
 * too. That is deliberate and it is the whole design: one function decides what an outline button
 * is called, so the canvas and the emitted app cannot disagree about it. A second implementation
 * here would be a second thing to keep in step, and it would eventually not be.
 */
export function classAttr(component: Component): string {
  const className = variantClassName(component);
  return className ? ` className=${JSON.stringify(className)}` : '';
}
