import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { componentsCss } from '../src/index';

/**
 * Every section that was written is a section that ships.
 *
 * Three of them — the active nav item (R2), the error fallback (L1) and the pager (Q2) — were each
 * defined as a constant and then not added to the list `componentsCss` joins. The stylesheet
 * compiled, the constant existed, and the rules reached nobody: elements carried classes that
 * matched no rule at all.
 *
 * Nothing caught it. The variant drift test in the compiler only checks classes that are *variant
 * options*, and none of these is one — so the gap sat exactly where no existing gate was looking.
 *
 * This reads the source rather than the output, because the source is the only place the omission
 * is visible: from the outside, a section that was never joined looks identical to one that was
 * never written.
 */
describe('the stylesheet ships every section it defines', () => {
  it('joins every declared block into the emitted CSS', async () => {
    const source = await readFile(new URL('../src/variants.ts', import.meta.url), 'utf8');

    const declared = [...source.matchAll(/^const ([A-Z_]+) = `/gm)].map((match) => match[1]!);
    const joined = source.slice(source.indexOf('return ['), source.indexOf('].join'));

    // If this ever reads zero, the regex stopped matching and the test stopped testing.
    expect(declared.length).toBeGreaterThan(5);

    for (const name of declared) {
      expect(joined, `${name} is written and never emitted`).toContain(name);
    }
  });

  it('actually contains the three rules that were missing', () => {
    const css = componentsCss();
    // The active item in a shell's navigation (R2).
    expect(css).toContain('.loom-active');
    // What is shown where something failed to render (L1).
    expect(css).toContain('.loom-error');
    // Previous, where you are, Next (Q2).
    expect(css).toContain('.loom-pager');
  });
});
