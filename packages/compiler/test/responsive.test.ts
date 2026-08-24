import { describe, expect, it } from 'vitest';
import { createComponent } from '@loom/components';
import { applyOp, createEmptyProject, type Component, type Snapshot } from '@loom/ir';
import { compile } from '../src/index';
import { resolveResponsive, responsiveCss, SM_MAX_WIDTH } from '../src/emit/responsive';

/**
 * Phone layouts (L3, `docs/V1-COMPLETION.md`).
 *
 * The claim being tested is narrow and worth stating: **one screen reads correctly at 390px and at
 * 1440px, with no second document.** Not a breakpoint system, not a second set of artboards — one
 * override, emitted as one media query the project owns.
 */

function project(root: Component, extra: Component[] = []): Snapshot {
  let snapshot = applyOp(createEmptyProject('Responsive'), {
    type: 'addArtboard',
    artboard: { id: 'ab_1', name: 'Home', root: root.id },
    root,
  });
  for (const component of extra) {
    snapshot = { ...snapshot, components: { ...snapshot.components, [component.id]: component } };
  }
  return { ...snapshot, components: { ...snapshot.components, [root.id]: root } };
}

const rowThatStacks = (): Component => ({
  ...createComponent('Frame', 'cp_row'),
  layout: {
    direction: 'row',
    gap: 24,
    padding: 16,
    align: 'stretch',
    justify: 'start',
    responsive: { sm: { direction: 'column', gap: 8 } },
  },
});

describe('a screen that changes on a phone', () => {
  it('emits one media query at the phone width', () => {
    const css = responsiveCss(project(rowThatStacks()));
    expect(css).toBeDefined();
    expect(css).toContain(`@media (max-width: ${SM_MAX_WIDTH}px)`);
    // The override, and only the override — the twelve properties that did not change stay in the
    // inline style where they already were.
    expect(css).toContain('flex-direction: column');
    expect(css).toContain('gap: 8px');
  });

  it('carries the class that rule targets onto the element', () => {
    const result = compile(project(rowThatStacks()));
    const screen = result.files.find((file) => file.path.endsWith('Home.tsx'))!;
    expect(screen.content).toContain('loom-sm-cp_row');
  });

  it('writes the stylesheet into the project and imports it', () => {
    const result = compile(project(rowThatStacks()));
    expect(result.files.find((file) => file.path === 'src/responsive.css')).toBeDefined();
    const index = result.files.find((file) => file.path === 'src/index.css')!;
    expect(index.content).toContain("@import './responsive.css';");
  });

  /**
   * Demand-driven, like everything else the compiler emits. A project nobody has given a phone
   * layout should not carry a stylesheet for one, an import for one, or a class for one.
   */
  it('emits nothing at all when no one has touched a phone layout', () => {
    const plain = project(createComponent('Frame', 'cp_plain'));
    expect(responsiveCss(plain)).toBeUndefined();

    const result = compile(plain);
    expect(result.files.find((file) => file.path === 'src/responsive.css')).toBeUndefined();
    expect(result.files.find((file) => file.path === 'src/index.css')!.content).not.toContain(
      'responsive.css',
    );
    expect(result.files.find((file) => file.path.endsWith('Home.tsx'))!.content).not.toContain(
      'loom-sm-',
    );
  });
});

/**
 * The canvas reaches the same answer by a different route, and this is the seam.
 *
 * A media query asks the viewport. An artboard has a width of its own, and the browser window's
 * has nothing to do with the phone-sized screen a designer is looking at — so the canvas resolves
 * the overrides directly. Both merge the same thing in the same order.
 */
describe('the canvas resolves the same override against the artboard', () => {
  it('applies the phone layout at a phone width', () => {
    const resolved = resolveResponsive(rowThatStacks(), 390);
    expect(resolved.layout?.direction).toBe('column');
    expect(resolved.layout?.gap).toBe(8);
    // Untouched properties come from the base, which is the point of storing a difference.
    expect(resolved.layout?.padding).toBe(16);
  });

  it('leaves the base alone at a desktop width', () => {
    const resolved = resolveResponsive(rowThatStacks(), 1440);
    expect(resolved.layout?.direction).toBe('row');
    expect(resolved.layout?.gap).toBe(24);
  });

  it('changes nothing for a component that declares no override', () => {
    const plain = createComponent('Frame', 'cp_plain');
    expect(resolveResponsive(plain, 390)).toBe(plain);
  });

  it('switches exactly at the boundary, so the two surfaces agree about where it is', () => {
    expect(resolveResponsive(rowThatStacks(), SM_MAX_WIDTH).layout?.direction).toBe('column');
    expect(resolveResponsive(rowThatStacks(), SM_MAX_WIDTH + 1).layout?.direction).toBe('row');
  });
});
