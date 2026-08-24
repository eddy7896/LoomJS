import { describe, expect, it } from 'vitest';
import { applyOps, type Op, type Snapshot } from '@loom/ir';
import { createDbNode, dbNodePorts, type DbOperation } from '@loom/connectors';
import { compile } from '../src/index';
import { NOTES_TABLE, postgresSnapshot, supabaseSnapshot } from './fixtures';

/**
 * Count, Save and Total (D3, `docs/14-data.md`).
 *
 * Three things a screen asks for that the first four nodes could not say: how many, write it
 * whether or not it is there, and what does it come to. Each one is checked against **both**
 * connectors, because the claim that a node says the same thing whichever connection is under it
 * is only worth anything if it keeps being true as nodes are added.
 */

/** The fixture's read step, replaced by one doing something else to the same table. */
function withOperation(
  base: Snapshot,
  operation: DbOperation,
  config: Record<string, unknown> = {},
): Snapshot {
  const node = createDbNode('nd_op', { x: 0, y: 0 }, 'cn_supabase', NOTES_TABLE, operation);
  const ops: Op[] = [
    { type: 'removeNode', nodeId: 'nd_select' },
    { type: 'addNode', node: { ...node, config: { ...node.config, ...config } } },
    {
      type: 'setNodeConfig',
      nodeId: 'nd_read',
      config: { method: 'GET', path: 'notes', body: ['nd_op'] },
    },
  ];
  return applyOps(base, ops);
}

/** The route the replaced step lives in — the fixture emits more than one. */
const api = (snapshot: Snapshot): string => {
  const file = compile(snapshot).files.find((entry) => entry.path === 'api/notes.ts');
  if (!file) throw new Error('no api/notes.ts emitted');
  return file.content;
};

describe('counting rows', () => {
  it('asks the database for the number, over SQL', () => {
    const code = api(withOperation(postgresSnapshot(), 'count'));
    expect(code).toContain('SELECT COUNT(*) AS count FROM');
    // Never by reading the rows and measuring: past the limit that answers a different question.
    expect(code).not.toContain('SELECT * FROM');
  });

  it('asks for the number without the rows, over HTTP', () => {
    const code = api(withOperation(supabaseSnapshot(), 'count'));
    expect(code).toContain("{ count: 'exact', head: true }");
    expect(code).toContain('value = count ?? 0;');
  });

  it('narrows the count the same way a read narrows', () => {
    const filtered = withOperation(postgresSnapshot(), 'count', {
      filters: [{ column: 'title', operator: 'contains', source: 'value', value: 'draft' }],
    });
    const code = api(filtered);
    expect(code).toContain('COUNT(*)');
    expect(code).toContain('ILIKE $1');
    expect(code).toContain('"%draft%"');
  });

  it('answers with a number', () => {
    const ports = dbNodePorts(NOTES_TABLE, 'count');
    expect(ports.map((port) => [port.name, port.type.kind])).toEqual([['count', 'number']]);
  });
});

describe('saving a row whether or not it is there', () => {
  it('resolves the clash on the key, over SQL', () => {
    const code = api(withOperation(postgresSnapshot(), 'upsert'));
    expect(code).toContain('ON CONFLICT (\\"id\\") DO UPDATE SET');
    expect(code).toContain('RETURNING *');
    // Every value is still a parameter, and the columns are still the ones actually sent.
    expect(code).toContain('slot(index + 1)');
    expect(code).toContain('Object.keys(row).filter((column) => row[column] !== undefined)');
  });

  it('writes the row as it stands when only the key was sent', () => {
    // `DO UPDATE SET` with nothing to set is invalid SQL, and `DO NOTHING` returns no row — so
    // the key is written to itself, which returns the row and changes nothing.
    const code = api(withOperation(postgresSnapshot(), 'upsert'));
    expect(code).toContain('changed.length > 0 ? changed : ["id"]');
  });

  it('is one call over HTTP too', () => {
    const code = api(withOperation(supabaseSnapshot(), 'upsert'));
    expect(code).toContain('.upsert(row).select().single()');
  });

  it('takes the key as an optional column, not as an identity', () => {
    const ports = dbNodePorts(NOTES_TABLE, 'upsert').filter((port) => port.direction === 'in');
    const id = ports.find((port) => port.name === 'id');
    expect(id?.type.kind).toBe('optional');
    // And every other column is optional too: saving is patching when the row exists.
    expect(ports.every((port) => port.type.kind === 'optional')).toBe(true);
  });
});

describe('totalling a column', () => {
  it('works it out in the database', () => {
    const code = api(withOperation(postgresSnapshot(), 'aggregate', { fn: 'sum', column: 'id' }));
    expect(code).toContain('SELECT SUM(\\"id\\") AS value FROM');
  });

  it('answers with nothing rather than zero when there are no rows', () => {
    const code = api(withOperation(postgresSnapshot(), 'aggregate', { fn: 'min', column: 'id' }));
    expect(code).toContain('answer === null || answer === undefined ? null : Number(answer)');

    const ports = dbNodePorts(NOTES_TABLE, 'aggregate');
    expect(ports.find((port) => port.name === 'value')?.type.kind).toBe('optional');
  });

  it('refuses a function that is not one of the four', () => {
    expect(() =>
      compile(withOperation(postgresSnapshot(), 'aggregate', { fn: 'version()', column: 'id' })),
    ).toThrow(/not something this step can work out/);
  });

  it('refuses a column that did not come from the schema', () => {
    expect(() =>
      compile(
        withOperation(postgresSnapshot(), 'aggregate', { fn: 'sum', column: 'id); DROP TABLE' }),
      ),
    ).toThrow(/not a name this connector can address/);
  });

  it('says what to do instead on a connection reached over HTTP', () => {
    expect(() =>
      compile(withOperation(supabaseSnapshot(), 'aggregate', { fn: 'sum', column: 'id' })),
    ).toThrow(/Connect to the database directly/);
  });
});
