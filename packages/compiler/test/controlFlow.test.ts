import { describe, expect, it } from 'vitest';
import { compile } from '../src/index';
import { CompileError } from '../src/types';
import { supabaseSnapshot } from './fixtures';
import type { Node, Snapshot } from '@loom/ir';

/**
 * Branch and For each (N2, `docs/V1-COMPLETION.md` §10).
 *
 * Two things the canvas could not say. A Gate **stops** a pipeline, and stopping is not choosing —
 * so "if it paid, send a receipt, otherwise send a reminder" meant two routes and the same decision
 * written down twice. And nothing could do anything *per row*, so invoicing, reminders and bulk
 * import all had to leave the graph entirely.
 *
 * The For each is bounded on purpose and the tests hold that line: it walks a list and it has a
 * cap. "Narrow the query" stays loom's answer to *where is the loop*; this answers *do this to each
 * of these*, which is a different question. A `while` is the general-purpose-VPL slide guardrail 7
 * names, and it stays refused.
 */

const step = (id: string, kind: string, config: Record<string, unknown> = {}): Node => ({
  id,
  category: 'fn',
  kind,
  position: { x: 0, y: 0 },
  config,
  ports: [
    { id: 'pt_input', name: 'input', direction: 'in', portKind: 'data', type: { kind: 'any' } },
    { id: 'pt_result', name: 'result', direction: 'out', portKind: 'data', type: { kind: 'any' } },
  ],
});

/** The Supabase fixture, with `extra` nodes spliced into its route's body. */
function withSteps(extra: Node[], bodyIds: string[]): Snapshot {
  const base = supabaseSnapshot();
  const route = Object.values(base.nodes).find((node) => node.category === 'api')!;
  const existing = ((route.config ?? {}) as { body?: string[] }).body ?? [];

  return {
    ...base,
    nodes: {
      ...base.nodes,
      ...Object.fromEntries(extra.map((node) => [node.id, node])),
      [route.id]: {
        ...route,
        config: { ...(route.config as object), body: [...existing, ...bodyIds] },
      },
    },
  };
}

const routeCode = (snapshot: Snapshot) =>
  compile(snapshot)
    .files.filter((file) => file.path.startsWith('api/') && !file.path.startsWith('api/auth/'))
    .map((file) => file.content)
    .join('\n');

describe('choosing, as opposed to stopping', () => {
  const branch = (then: string[] = [], otherwise: string[] = []) =>
    step('nd_branch', 'branch', { condition: 'isTrue', then, else: otherwise });

  it('emits an if and an else', () => {
    const code = routeCode(withSteps([branch()], ['nd_branch']));
    expect(code).toContain('if (');
    expect(code).toContain('} else {');
  });

  /** An empty arm is a real answer: "otherwise carry on" needs no placeholder step to say so. */
  it('lets an arm be empty rather than demanding a placeholder', () => {
    const code = routeCode(withSteps([branch()], ['nd_branch']));
    expect(code).toContain('nothing this way');
  });

  it('runs the steps in the arm that was taken', () => {
    const inner = step('nd_upper', 'compute', { op: 'uppercase' });
    const code = routeCode(withSteps([branch(['nd_upper']), inner], ['nd_branch']));
    expect(code).toContain('toUpperCase()');
  });

  /**
   * A Gate and a Branch have to agree about what counts as true, or "is checked" means two things
   * two nodes apart. They read one test.
   */
  it('tests the same way a Gate does', () => {
    const code = routeCode(withSteps([branch()], ['nd_branch']));
    expect(code).toContain('const subject: unknown =');
  });
});

describe('doing something to each of a list', () => {
  const forEach = (body: string[], limit?: number) =>
    step('nd_each', 'forEach', { body, ...(limit === undefined ? {} : { limit }) });

  const inner = step('nd_trim', 'compute', { op: 'trim' });

  it('walks the list and runs the body once per item', () => {
    const code = routeCode(withSteps([forEach(['nd_trim']), inner], ['nd_each']));
    expect(code).toContain('for (const item of');
    expect(code).toContain('.trim()');
  });

  /**
   * The line that keeps this a data operation rather than control flow. There is no condition to
   * loop on and no way to loop forever.
   */
  it('is capped, and cannot be uncapped', () => {
    const asked = routeCode(withSteps([forEach(['nd_trim'], 100000), inner], ['nd_each']));
    // Whatever was asked for, the ceiling holds.
    expect(asked).toContain('.slice(0, 500)');
    expect(asked).not.toContain('100000');
  });

  it('honours a smaller cap than the ceiling', () => {
    const code = routeCode(withSteps([forEach(['nd_trim'], 10), inner], ['nd_each']));
    expect(code).toContain('.slice(0, 10)');
  });

  /**
   * A run over five hundred rows that dies on the third and reports nothing is worse than no run
   * at all. Each item is attempted on its own, and what comes out is how many worked and which
   * did not.
   */
  it('keeps going when one row fails, and says which ones did not', () => {
    const code = routeCode(withSteps([forEach(['nd_trim']), inner], ['nd_each']));
    expect(code).toContain('catch (error)');
    expect(code).toContain('failed.push');
    expect(code).toContain('done, failed');
  });

  it('says so when it would walk a list and do nothing to it', () => {
    expect(() => compile(withSteps([forEach([])], ['nd_each']))).toThrow(CompileError);
    expect(() => compile(withSteps([forEach([])], ['nd_each']))).toThrow(/no steps/);
  });
});

describe('both belong on the server', () => {
  /**
   * A branch chooses between database writes and tool calls; a For each does five hundred of them.
   * Neither is refused for want of a request body, so no wire lifts it — the body is the reason.
   */
  it('refuses a branch outside an API route', () => {
    const base = supabaseSnapshot();
    const loose: Snapshot = {
      ...base,
      nodes: { ...base.nodes, nd_loose: step('nd_loose', 'branch', { condition: 'isTrue' }) },
      components: {
        ...base.components,
        cp_row_text: {
          ...base.components.cp_row_text!,
          props: {
            content: { kind: 'bound', source: { nodeId: 'nd_loose', portId: 'pt_result' } },
          },
        },
      },
    };
    expect(() => compile(loose)).toThrow(/inside an API route/);
  });
});

describe('a step inside a branch arm is still inside the route', () => {
  /**
   * The collectors that decide "does this run on the server" only looked at a route's own body.
   * A database write in a branch arm would have been refused as browser work — a nested container
   * is still inside whatever holds it.
   */
  it('lets a database step live in an arm without being called browser work', () => {
    const base = supabaseSnapshot();
    const dbNode = Object.values(base.nodes).find((node) => node.category === 'db')!;
    const route = Object.values(base.nodes).find((node) => node.category === 'api')!;

    // Move the existing database step out of the body and into a branch arm.
    const branchNode = step('nd_branch', 'branch', { condition: 'isTrue', then: [dbNode.id] });
    const body = (((route.config ?? {}) as { body?: string[] }).body ?? []).filter(
      (id) => id !== dbNode.id,
    );

    const nested: Snapshot = {
      ...base,
      nodes: {
        ...base.nodes,
        nd_branch: branchNode,
        [route.id]: {
          ...route,
          config: { ...(route.config as object), body: [...body, 'nd_branch'] },
        },
      },
    };

    expect(() => compile(nested)).not.toThrow();
  });
});
