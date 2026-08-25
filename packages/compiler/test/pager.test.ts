import { describe, expect, it } from 'vitest';
import { createComponent, mirrorPortsFor } from '@loom/components';
import { applyOp, createEmptyProject, type Component, type Snapshot } from '@loom/ir';
import { compile, diagnose } from '../src/index';

/**
 * The page control (Q2, `docs/V1-COMPLETION.md`).
 *
 * Q2 shipped the read half — a range, an exact count, a total the database counted. This is the
 * part a person touches, and the claim it has to hold up is narrow: **changing the page re-runs
 * the read**, using the machinery a reactive pipeline already has rather than a second way to
 * fetch.
 */

function withPager(props: Record<string, unknown> = {}): Snapshot {
  const pager: Component = {
    ...createComponent('Pager', 'cp_pager'),
    props: {
      ...createComponent('Pager', 'cp_pager').props,
      ...Object.fromEntries(
        Object.entries(props).map(([key, value]) => [key, { kind: 'static' as const, value }]),
      ),
    },
  };
  const root: Component = { ...createComponent('Frame', 'cp_root'), children: [pager.id] };

  const base = applyOp(createEmptyProject('Paged'), {
    type: 'addArtboard',
    artboard: { id: 'ab_1', name: 'Home', root: root.id },
    root,
  });

  return {
    ...base,
    components: { ...base.components, [root.id]: root, [pager.id]: pager },
  };
}

const homeOf = (snapshot: Snapshot) =>
  compile(snapshot).files.find((file) => file.path.includes('/artboards/'))!.content;

describe('what a pager is', () => {
  /**
   * Its page lives in component state, which is the whole trick: a reactive read already re-runs
   * when its inputs change, and an input is a component's state. No new mechanism.
   */
  it('holds the page as ordinary component state', () => {
    const home = homeOf(withPager());
    expect(home).toContain('useState(0)');
    expect(home).toContain('set_field_cp_pager');
  });

  it('starts where it was told to', () => {
    expect(homeOf(withPager({ value: 3 }))).toContain('useState(3)');
  });

  /** Previous, where you are, Next — the only arrangement anyone expects. */
  it('emits the three things and nothing else', () => {
    const home = homeOf(withPager());
    expect(home).toContain('loom-pager__step');
    expect(home).toContain('loom-pager__where');
    expect(home).toContain('Previous');
    expect(home).toContain('Next');
  });

  /**
   * It changes a number. The pipeline that was already watching that number does the fetching —
   * a page control that issued its own request would be a second way to run a query, and the
   * first way already handles the loading state, the error and the invalidation.
   */
  it('does not fetch anything itself', () => {
    const home = homeOf(withPager());
    expect(home).not.toContain('fetch(');
  });

  it('cannot go before the first page', () => {
    const home = homeOf(withPager());
    expect(home).toContain('disabled={field_cp_pager <= 0}');
    expect(home).toContain('Math.max(0, field_cp_pager - 1)');
  });

  it('takes its labels from the project', () => {
    const home = homeOf(withPager({ previousLabel: 'Back', nextLabel: 'More' }));
    expect(home).toContain('"Back"');
    expect(home).toContain('"More"');
  });
});

describe('its face in Nodes mode', () => {
  /**
   * The two ports are the whole feature: a page going out to the read, and a total coming back
   * from it. Both bind properties the emitter actually reads, which is what `propKey` is for.
   */
  it('sends a page and receives a total', () => {
    const ports = mirrorPortsFor(createComponent('Pager', 'cp_probe'));

    const page = ports.find((port) => port.name === 'page')!;
    expect(page.direction).toBe('out');
    expect(page.propKey).toBe('page');
    expect(page.type).toEqual({ kind: 'number' });

    const total = ports.find((port) => port.name === 'total')!;
    expect(total.direction).toBe('in');
    expect(total.propKey).toBe('total');
  });
});

describe('what it warns about', () => {
  /**
   * Without a total it cannot know which page is the last one. Worth saying, and worth saying as
   * a warning rather than an error: the read it belongs to may be the next thing being wired.
   */
  it('says so when nothing tells it how many rows there are', () => {
    const problems = diagnose(withPager());
    const noted = problems.find((problem) => problem.code === 'pager-no-total');
    expect(noted?.severity).toBe('warning');
  });

  /** Unbound, Next stays available: a control that refuses to advance looks broken. */
  it('still lets you go forward when the total is unknown', () => {
    expect(homeOf(withPager())).toContain('Math.ceil(Number(0) / 100)');
  });
});
