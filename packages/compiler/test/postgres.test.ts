import { describe, expect, it } from 'vitest';
import { applyOps, type Op, type Snapshot } from '@loom/ir';
import { createQueryNode, parseColumnRows, queryNodePorts } from '@loom/connectors';
import { compile } from '../src/index';
import { NOTES_TABLE, postgresSnapshot, supabaseSnapshot } from './fixtures';

/**
 * The Postgres connector (`docs/specs/connector-credentials.md`).
 *
 * A database node says the same thing whichever connection is under it, so the test is that the
 * *same graph* emits a REST call against Supabase and a statement against Postgres — and that
 * every value in that statement travels as a parameter rather than as text.
 */

const fileAt = (snapshot: Snapshot, path: string): string => {
  const file = compile(snapshot).files.find((entry) => entry.path === path);
  if (!file) throw new Error(`no ${path} emitted`);
  return file.content;
};

function onPostgres(extra: Op[] = []): Snapshot {
  const swapped = postgresSnapshot();
  return extra.length > 0 ? applyOps(swapped, extra) : swapped;
}

describe('reading', () => {
  const api = fileAt(onPostgres(), 'api/notes.ts');

  it('opens a pool once, not once per request', () => {
    // A function is reused between requests, and a fresh connection per invocation is how a
    // database's connection limit gets used up.
    expect(api).toContain("import { Pool } from 'pg'");
    expect(api).toContain('const pool = new Pool({ connectionString: process.env.DATABASE_URL');
    expect(api).toContain('max: 1');
  });

  it('reads the credential by name, and never carries the value', () => {
    expect(api).toContain('process.env.DATABASE_URL');
    expect(api).not.toMatch(/postgres:\/\/[^'"]*:[^'"]*@/);
  });

  it('selects from the quoted table, with a limit', () => {
    expect(api).toContain('"SELECT * FROM \\"notes\\""');
    expect(api).toContain('LIMIT 100');
  });
});

describe('writing', () => {
  it('inserts only the columns that were supplied, and returns the row it made', () => {
    const api = fileAt(onPostgres(), 'api/createnote.ts');
    // The identifier is quoted for the database and escaped for the file it lands in.
    expect(api).toContain('INSERT INTO \\"notes\\"');
    expect(api).toContain('RETURNING *');
    // The column list is built at run time from what the form actually sent.
    expect(api).toContain('Object.keys(row).filter((column) => row[column] !== undefined)');
  });

  it('names every value with a placeholder rather than pasting it in', () => {
    const api = fileAt(onPostgres(), 'api/createnote.ts');
    expect(api).toContain('slot(index + 1)');
    expect(api).toContain("const slot = (index: number): string => '$' + index");
  });
});

describe('a filter a designer typed', () => {
  const filtered = onPostgres([
    {
      type: 'setNodeConfig',
      nodeId: 'nd_select',
      config: {
        connectorId: 'cn_supabase',
        table: 'notes',
        operation: 'select',
        filters: [{ column: 'title', operator: 'contains', source: 'value', value: "'; DROP TABLE notes; --" }],
      },
    },
  ]);

  it('travels as a parameter, so a statement cannot be written by typing into a box', () => {
    const api = fileAt(filtered, 'api/notes.ts');
    expect(api).toContain('\\"title\\" ILIKE $1');
    // The dangerous text is a *value* in the list, never part of the statement.
    expect(api).toContain('DROP TABLE');
    expect(api).not.toContain('SELECT * FROM "notes" WHERE "title" ILIKE \'');
  });
});

describe('a statement the designer wrote', () => {
  const withQuery = (sql: string): Snapshot =>
    onPostgres([
      {
        type: 'setNodeConfig',
        nodeId: 'nd_read',
        config: { method: 'POST', path: 'notes', body: [] },
      },
      { type: 'removeNode', nodeId: 'nd_select' },
      {
        type: 'addNode',
        node: {
          ...createQueryNode('nd_q', { x: 0, y: 0 }, 'cn_supabase'),
          config: { connectorId: 'cn_supabase', sql, returns: 'many' },
          ports: queryNodePorts(sql),
        },
      },
      {
        type: 'setNodeConfig',
        nodeId: 'nd_read',
        config: { method: 'POST', path: 'notes', body: ['nd_q'] },
      },
    ]);

  it('turns every :name into a placeholder, in the order they appear', () => {
    const api = fileAt(
      withQuery('SELECT * FROM notes WHERE title = :title AND id > :since'),
      'api/notes.ts',
    );
    expect(api).toContain('SELECT * FROM notes WHERE title = $1 AND id > $2');
    expect(api).toContain('input["title"], input["since"]');
  });

  it('asks for one port per name it names', () => {
    const ports = queryNodePorts('SELECT * FROM notes WHERE title = :title AND id > :since');
    expect(ports.filter((port) => port.direction === 'in').map((port) => port.name)).toEqual([
      'title',
      'since',
    ]);
  });

  it('refuses a query on a connection that has no statements to run', () => {
    const base = supabaseSnapshot();
    const overRest = applyOps(base, [
      {
        type: 'setNodeConfig',
        nodeId: 'nd_read',
        config: { method: 'POST', path: 'notes', body: [] },
      },
      { type: 'removeNode', nodeId: 'nd_select' },
      {
        type: 'addNode',
        node: {
          ...createQueryNode('nd_q', { x: 0, y: 0 }, 'cn_supabase'),
          config: { connectorId: 'cn_supabase', sql: 'SELECT 1', returns: 'many' },
        },
      },
      {
        type: 'setNodeConfig',
        nodeId: 'nd_read',
        config: { method: 'POST', path: 'notes', body: ['nd_q'] },
      },
    ]);
    expect(() => compile(overRest)).toThrow(/reached over HTTP/);
  });
});

describe('what the project installs', () => {
  it('carries the driver it opens and not the client it never calls', () => {
    const pkg = fileAt(onPostgres(), 'package.json');
    expect(pkg).toContain('"pg"');
    expect(pkg).not.toContain('@supabase/postgrest-js');
  });

  it('asks the deployment for one name', () => {
    expect(fileAt(onPostgres(), '.env.example')).toBe('DATABASE_URL=\n');
  });

  it('leaves a Supabase project exactly as it was', () => {
    const pkg = fileAt(supabaseSnapshot(), 'package.json');
    expect(pkg).toContain('@supabase/postgrest-js');
    expect(pkg).not.toContain('"pg"');
  });
});

describe('reading a schema out of information_schema', () => {
  it('gathers rows into tables, keys and required columns', () => {
    const tables = parseColumnRows([
      { table_name: 'notes', column_name: 'id', data_type: 'bigint', is_nullable: 'NO', column_default: "nextval('notes_id_seq')", is_primary: true },
      { table_name: 'notes', column_name: 'title', data_type: 'text', is_nullable: 'NO', column_default: null },
      { table_name: 'notes', column_name: 'body', data_type: 'text', is_nullable: 'YES', column_default: null },
      { table_name: 'authors', column_name: 'name', data_type: 'character varying', is_nullable: 'NO', column_default: null },
    ]);

    expect(tables.map((table) => table.name)).toEqual(['authors', 'notes']);
    const notes = tables.find((table) => table.name === 'notes')!;
    expect(notes.columns.find((column) => column.name === 'id')).toMatchObject({
      primaryKey: true,
      // A key the database fills in is never asked for on insert.
      generated: true,
      required: false,
    });
    expect(notes.columns.find((column) => column.name === 'title')).toMatchObject({
      required: true,
      type: { kind: 'text' },
    });
    expect(notes.columns.find((column) => column.name === 'body')?.required).toBe(false);
  });

  it('says so when the schema is empty rather than showing an empty list', () => {
    expect(() => parseColumnRows([])).toThrow(/holds no tables/);
  });

  it('leaves a type it does not know as unknown, rather than guessing', () => {
    const [table] = parseColumnRows([
      { table_name: 't', column_name: 'shape', data_type: 'geometry', is_nullable: 'YES' },
    ]);
    expect(table!.columns[0]!.type).toEqual({ kind: 'unknown' });
  });
});

describe('the same graph, either way round', () => {
  it('emits a request against Supabase and a statement against Postgres', () => {
    expect(fileAt(supabaseSnapshot(), 'api/notes.ts')).toContain('PostgrestClient');
    expect(fileAt(onPostgres(), 'api/notes.ts')).toContain('SELECT * FROM');
    // And the table itself is unchanged: the vocabulary did not grow when the connector did.
    expect(NOTES_TABLE.columns.map((column) => column.name)).toContain('title');
  });
});
