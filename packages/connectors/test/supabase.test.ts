import { describe, expect, it } from 'vitest';
import {
  ConnectorError,
  columnPortId,
  dbNodePorts,
  parseOpenApi,
  requiredColumns,
  supabaseConnector,
} from '../src/index';

/**
 * A PostgREST OpenAPI 2.0 document of the shape Supabase serves at `GET /rest/v1/`. The parser is
 * written to be defensive about this shape (see the note in `supabase.ts`), so the fixture
 * deliberately mixes documented fields with a column that has neither a known `format` nor a
 * usable `type`.
 */
const OPENAPI = {
  swagger: '2.0',
  info: { title: 'standard public schema' },
  definitions: {
    notes: {
      required: ['id', 'title', 'created_at'],
      properties: {
        id: {
          format: 'bigint',
          type: 'integer',
          description: 'Note:\nThis is a Primary Key.<pk/>',
        },
        title: { format: 'text', type: 'string' },
        body: { format: 'text', type: 'string' },
        done: { format: 'boolean', type: 'boolean', default: false },
        rating: { format: 'numeric', type: 'number' },
        tags: { format: 'text[]', type: 'array' },
        status: { format: 'user_status', type: 'string', enum: ['draft', 'published'] },
        meta: { format: 'jsonb', type: 'object' },
        created_at: { format: 'timestamp with time zone', type: 'string', default: 'now()' },
        mystery: { format: 'tsvector' },
      },
    },
    empty_view: {},
  },
};

const columnsOf = (table: string) => {
  const found = parseOpenApi(OPENAPI).find((t) => t.name === table);
  if (!found) throw new Error(`no table ${table}`);
  return found;
};

describe('introspection: PostgREST OpenAPI -> loom types', () => {
  it('reads every exposed table', () => {
    expect(parseOpenApi(OPENAPI).map((t) => t.name)).toEqual(['notes']);
  });

  it('maps Postgres formats into the visible vocabulary', () => {
    const byName = Object.fromEntries(columnsOf('notes').columns.map((c) => [c.name, c.type]));
    expect(byName.id).toEqual({ kind: 'number' });
    expect(byName.title).toEqual({ kind: 'text' });
    expect(byName.done).toEqual({ kind: 'boolean' });
    expect(byName.rating).toEqual({ kind: 'number' });
    expect(byName.created_at).toEqual({ kind: 'date' });
    expect(byName.meta).toEqual({ kind: 'record' });
    expect(byName.tags).toEqual({ kind: 'list', of: { kind: 'text' } });
  });

  it('keeps a Postgres enum as an enum, not as free text', () => {
    const status = columnsOf('notes').columns.find((c) => c.name === 'status')!;
    expect(status.type).toEqual({ kind: 'enum', values: ['draft', 'published'] });
  });

  it('degrades an unrecognised type to unknown rather than guessing', () => {
    const mystery = columnsOf('notes').columns.find((c) => c.name === 'mystery')!;
    expect(mystery.type).toEqual({ kind: 'unknown' });
  });

  it('marks the primary key and treats database-filled columns as generated', () => {
    const columns = Object.fromEntries(columnsOf('notes').columns.map((c) => [c.name, c]));
    expect(columns.id!.primaryKey).toBe(true);
    expect(columns.id!.generated).toBe(true);
    expect(columns.created_at!.generated).toBe(true);
    expect(columns.done!.generated).toBe(true);
  });

  it('requires only the not-null columns the database will not fill in', () => {
    expect(requiredColumns(columnsOf('notes'))).toEqual(['title']);
  });

  it('skips a definition with no columns instead of emitting an empty table', () => {
    expect(parseOpenApi(OPENAPI).some((t) => t.name === 'empty_view')).toBe(false);
  });

  it('rejects a document that is not a PostgREST schema', () => {
    expect(() => parseOpenApi({ paths: {} })).toThrow(ConnectorError);
  });
});

describe('typed per-table nodes', () => {
  it('gives a select node rows and a count', () => {
    const ports = dbNodePorts(columnsOf('notes'), 'select');
    expect(ports.map((p) => p.name)).toEqual(['rows', 'count']);
    expect(ports[0]!.type).toEqual({ kind: 'list', of: { kind: 'record' } });
  });

  it('gives an insert node one input per writable column, typed as the column is', () => {
    const ports = dbNodePorts(columnsOf('notes'), 'insert');
    const names = ports.filter((p) => p.direction === 'in').map((p) => p.name);

    // Generated columns are never asked for.
    expect(names).not.toContain('id');
    expect(names).not.toContain('created_at');
    expect(names).toContain('title');

    const title = ports.find((p) => p.name === 'title')!;
    const body = ports.find((p) => p.name === 'body')!;
    expect(title.type).toEqual({ kind: 'text' });
    // A nullable column accepts a value or nothing.
    expect(body.type).toEqual({ kind: 'optional', of: { kind: 'text' } });
    expect(title.id).toBe(columnPortId('title'));
  });
});

describe('connecting is validating', () => {
  const config = { url: 'https://demo.supabase.co' };
  const key = { SUPABASE_ANON_KEY: 'anon-key' };

  const respondWith = (status: number, body: unknown): typeof fetch =>
    (async () =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;

  it('reads the schema from the project REST root', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push(url);
      expect((init.headers as Record<string, string>).apikey).toBe('anon-key');
      return new Response(JSON.stringify(OPENAPI), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await supabaseConnector.introspect(config, key, fetchImpl);
    expect(calls).toEqual(['https://demo.supabase.co/rest/v1/']);
    expect(result.tables.map((t) => t.name)).toEqual(['notes']);
    expect(Date.parse(result.introspectedAt)).not.toBeNaN();
  });

  it('needs a key', async () => {
    await expect(supabaseConnector.introspect(config, {})).rejects.toThrow(/key is required/);
  });

  it('rejects a URL that is not a URL', async () => {
    await expect(
      supabaseConnector.introspect({ url: 'demo.supabase.co' }, key, respondWith(200, OPENAPI)),
    ).rejects.toThrow(/must start with https/);
  });

  it('says so when the key is refused', async () => {
    await expect(
      supabaseConnector.introspect(config, key, respondWith(401, { message: 'nope' })),
    ).rejects.toThrow(/rejected that key/);
  });

  it('says so when the project exposes no tables to this key', async () => {
    await expect(
      supabaseConnector.introspect(config, key, respondWith(200, { definitions: {} })),
    ).rejects.toThrow(/no tables are exposed/);
  });

  it('says so when the answer is not JSON', async () => {
    await expect(
      supabaseConnector.introspect(config, key, respondWith(200, '<html>nope</html>')),
    ).rejects.toThrow(/did not return JSON/);
  });
});
