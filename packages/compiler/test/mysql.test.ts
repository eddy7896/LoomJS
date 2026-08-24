import { describe, expect, it } from 'vitest';
import { applyOps, type Snapshot } from '@loom/ir';
import { createDbNode, type DbOperation } from '@loom/connectors';
import { compile } from '../src/index';
import { NOTES_TABLE, mysqlSnapshot } from './fixtures';

/**
 * MySQL (D5, `docs/14-data.md`).
 *
 * It waited because it has no `RETURNING`: an insert could not answer with the row it wrote, and
 * a connector that reads but silently mangles writes is worse than one that is not there. These
 * are about that gap being closed honestly — the row comes back because it is read back.
 */

function withOperation(operation: DbOperation, config: Record<string, unknown> = {}): Snapshot {
  const node = createDbNode('nd_op', { x: 0, y: 0 }, 'cn_supabase', NOTES_TABLE, operation);
  return applyOps(mysqlSnapshot(), [
    { type: 'removeNode', nodeId: 'nd_select' },
    { type: 'addNode', node: { ...node, config: { ...node.config, ...config } } },
    {
      type: 'setNodeConfig',
      nodeId: 'nd_read',
      config: { method: 'GET', path: 'notes', body: ['nd_op'] },
    },
  ]);
}

const api = (snapshot: Snapshot): string => {
  const file = compile(snapshot).files.find((entry) => entry.path === 'api/notes.ts');
  if (!file) throw new Error('no api/notes.ts emitted');
  return file.content;
};

describe('reading', () => {
  const code = api(mysqlSnapshot());

  it('opens a pool once, with the driver MySQL speaks', () => {
    expect(code).toContain("import mysql from 'mysql2/promise'");
    expect(code).toContain('mysql.createPool({ uri: process.env.DATABASE_URL');
    expect(code).toContain('connectionLimit: 1');
  });

  it('uses the placeholder MySQL uses, and still sends every value beside it', () => {
    // The helpers are emitted per route, so this is asked of a route that actually writes.
    const writing = api(withOperation('insert'));
    expect(writing).toContain("const slot = (_index: number): string => '?'");
    expect(writing).not.toContain("'$' + index");
  });

  it('matches text the way MySQL does', () => {
    // No ILIKE here; LIKE is already case-insensitive under the usual collations.
    expect(code).not.toContain('ILIKE');
  });
});

describe('writing, without RETURNING', () => {
  it('reads the inserted row back by the key the database made', () => {
    const code = api(withOperation('insert'));
    expect(code).toContain('INSERT INTO');
    expect(code).not.toContain('RETURNING *');
    // Supplied key, or the generated one the driver reports.
    expect(code).toContain('row["id"] ?? written.insertId');
    expect(code).toContain('SELECT * FROM');
  });

  it('reads the updated row back too, so the node answers with the row', () => {
    const code = api(withOperation('update'));
    expect(code).toContain('UPDATE');
    expect(code).not.toContain('RETURNING *');
    expect(code).toContain('SELECT * FROM');
  });

  it('reads a row before deleting it, because afterwards there is nothing to answer with', () => {
    const code = api(withOperation('delete'));
    expect(code.indexOf('SELECT * FROM')).toBeLessThan(code.indexOf('DELETE FROM'));
  });

  it('saves with the clause MySQL has for it', () => {
    const code = api(withOperation('upsert'));
    expect(code).toContain('ON DUPLICATE KEY UPDATE');
    expect(code).toContain('VALUES(');
  });
});

describe('what the project installs', () => {
  it('carries the MySQL driver and not the Postgres one', () => {
    const pkg = compile(mysqlSnapshot()).files.find((file) => file.path === 'package.json')!;
    expect(pkg.content).toContain('mysql2');
    expect(pkg.content).not.toContain('"pg"');
  });
});
