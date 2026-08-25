import { describe, expect, it } from 'vitest';
import { createDdlNode, createSchemaTableNode } from '@loom/connectors';
import { compile } from '../src/index';
import { CompileError } from '../src/types';
import { postgresSnapshot, supabaseSnapshot } from './fixtures';
import type { Node, Snapshot } from '@loom/ir';

/**
 * Schema as nodes (N4, `docs/V1-COMPLETION.md` §10).
 *
 * Two nodes that look similar and are not the same thing, which is the whole point of the tests
 * below: one describes a schema and emits **nothing**, and the other changes a schema while the
 * app is running and says what that costs.
 *
 * The design-time one is on the canvas because a schema is part of the design — drawing the shape
 * of the data beside the screens that read it is what a designer is already doing, and sending
 * them to a database console for it is the gap loom exists to close. It applies through exactly
 * the path the Data panel uses, so there is one way a schema changes rather than two that disagree.
 */

/** A table drawn on the canvas, sitting where a designer would leave it. */
function withDesignedTable(): Snapshot {
  const base = supabaseSnapshot();
  const connector = Object.values(base.connectors)[0]!;
  const node = createSchemaTableNode('nd_table', { x: 0, y: 0 }, connector.id, 'invoices');
  return { ...base, nodes: { ...base.nodes, nd_table: node } };
}

/** A runtime statement inside a route, on a connection that speaks SQL. */
function withDdl(config: Record<string, unknown> = {}): Snapshot {
  const base = postgresSnapshot();
  const connector = Object.values(base.connectors)[0]!;
  const route = Object.values(base.nodes).find((node) => node.category === 'api')!;
  const body = ((route.config ?? {}) as { body?: string[] }).body ?? [];

  const node: Node = {
    ...createDdlNode('nd_ddl', { x: 0, y: 0 }, connector.id),
    config: {
      connectorId: connector.id,
      statement: 'create table if not exists audit (id uuid primary key)',
      ...config,
    },
  };

  return {
    ...base,
    nodes: {
      ...base.nodes,
      nd_ddl: node,
      [route.id]: { ...route, config: { ...(route.config as object), body: [...body, 'nd_ddl'] } },
    },
  };
}

const allCode = (snapshot: Snapshot) =>
  compile(snapshot)
    .files.map((file) => file.content)
    .join('\n');

describe('a table drawn on the canvas', () => {
  /**
   * The claim that makes this safe: the app that ships has no idea the node existed. No runtime
   * code, no DDL in a route, nothing to go wrong in production.
   */
  it('emits nothing at all', () => {
    const code = allCode(withDesignedTable());
    expect(code).not.toContain('create table');
    expect(code).not.toContain('invoices');
  });

  it('compiles fine sitting on the canvas, outside any route', () => {
    // Database *work* must live in a route. A description is not work, and refusing it for not
    // being somewhere it must never be would be the rule misfiring.
    expect(() => compile(withDesignedTable())).not.toThrow();
  });

  /**
   * It has no ports, deliberately. Ports would invite somebody to wire it into a pipeline, which
   * is exactly the misunderstanding the design-time/runtime split exists to prevent.
   */
  it('has nothing to wire', () => {
    const node = createSchemaTableNode('nd_x', { x: 0, y: 0 }, 'cn_1');
    expect(node.ports).toEqual([]);
  });

  it('says so if somebody puts one in a route body', () => {
    const base = withDesignedTable();
    const route = Object.values(base.nodes).find((node) => node.category === 'api')!;
    const body = ((route.config ?? {}) as { body?: string[] }).body ?? [];

    const inBody: Snapshot = {
      ...base,
      nodes: {
        ...base.nodes,
        [route.id]: {
          ...route,
          config: { ...(route.config as object), body: [...body, 'nd_table'] },
        },
      },
    };

    expect(() => compile(inBody)).toThrow(/not a step a route runs/);
  });
});

describe('a statement that runs while the app is running', () => {
  /**
   * Not ceremony. This needs a database credential in production that can alter a schema, and a
   * project that ships one without anybody deciding to is a project that shipped it by accident.
   */
  it('is refused until somebody has accepted what it costs', () => {
    expect(() => compile(withDdl())).toThrow(CompileError);
    expect(() => compile(withDdl())).toThrow(/records no migration/);
  });

  it('emits once acknowledged', () => {
    const code = allCode(withDdl({ acknowledged: true }));
    expect(code).toContain('create table if not exists audit');
  });

  /**
   * The costs travel into the emitted code, because the person who meets this next is reading the
   * repo rather than the node that made it.
   */
  it('carries its warning into the code it emits', () => {
    const code = allCode(withDdl({ acknowledged: true }));
    expect(code).toContain('records no migration');
    expect(code).toContain('alter a schema');
  });

  it('refuses a statement that is empty', () => {
    expect(() => compile(withDdl({ acknowledged: true, statement: '  ' }))).toThrow(
      /no statement to run/,
    );
  });

  /** PostgREST cannot change a schema, so a connection that only speaks it cannot host this. */
  it('refuses a connection that does not run statements', () => {
    const base = supabaseSnapshot();
    const connector = Object.values(base.connectors)[0]!;
    const route = Object.values(base.nodes).find((node) => node.category === 'api')!;
    const body = ((route.config ?? {}) as { body?: string[] }).body ?? [];

    const overRest: Snapshot = {
      ...base,
      nodes: {
        ...base.nodes,
        nd_ddl: {
          ...createDdlNode('nd_ddl', { x: 0, y: 0 }, connector.id),
          config: {
            connectorId: connector.id,
            statement: 'create table x (id int)',
            acknowledged: true,
          },
        },
        [route.id]: {
          ...route,
          config: { ...(route.config as object), body: [...body, 'nd_ddl'] },
        },
      },
    };

    expect(() => compile(overRest)).toThrow(/speaks\s+SQL directly|cannot change a schema/);
  });
});
