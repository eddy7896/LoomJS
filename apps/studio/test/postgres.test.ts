import { afterEach, describe, expect, it, vi } from 'vitest';
import { __resetStore, getState } from '../src/state/store';
import {
  addQueryStep,
  canRunSql,
  connectPostgres,
  connectedTables,
  connectionUrl,
  setQuerySql,
} from '../src/state/connectors';
import { addGraphNode } from '../src/state/graph';

/**
 * Connecting to a database from a studio that runs in a browser.
 *
 * The browser cannot open a database socket, so the read happens on loom's dev server — and the
 * connection string is the whole credential, password included. These cover the seam that keeps
 * the schema visible and the string out of everything that gets saved, shared or reloaded.
 */

const ROWS = [
  {
    table_name: 'notes',
    column_name: 'id',
    data_type: 'bigint',
    is_nullable: 'NO',
    column_default: "nextval('notes_id_seq')",
    is_primary: true,
  },
  {
    table_name: 'notes',
    column_name: 'title',
    data_type: 'text',
    is_nullable: 'NO',
    column_default: null,
    is_primary: false,
  },
];

const STRING = 'postgresql://app:hunter2@db.example.com:5432/app';

/** Every call the studio made, so a test can say what did *not* happen too. */
function record(answer: (url: string, init?: RequestInit) => unknown) {
  const calls: { url: string; body: string }[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: String(init?.body ?? '') });
    return new Response(JSON.stringify(answer(url, init)), { status: 200 });
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('connecting to a database', () => {
  it('reads the schema through the dev server and keeps it in the document', async () => {
    __resetStore();
    const calls = record((url) => (url.includes('introspect-sql') ? { ok: true, rows: ROWS } : {}));

    const result = await connectPostgres({ connectionString: STRING, schema: 'public' });
    expect(result.ok).toBe(true);

    const snapshot = getState().snapshot;
    expect(Object.values(snapshot.connectors)[0]?.moduleId).toBe('postgres');
    expect(connectedTables(snapshot).map((table) => table.name)).toEqual(['notes']);
    expect(connectionUrl(snapshot)).toBe('public schema');

    // The schema name travelled as a parameter, not as part of the query.
    const introspect = calls.find((call) => call.url.includes('introspect-sql'))!;
    expect(JSON.parse(introspect.body).schema).toBe('public');
  });

  it('never writes the connection string into anything the browser keeps', async () => {
    __resetStore();
    record((url) => (url.includes('introspect-sql') ? { ok: true, rows: ROWS } : {}));
    await connectPostgres({ connectionString: STRING, schema: 'public' });

    // Not in local storage, and not in the document — a saved or shared project cannot leak it.
    expect(JSON.stringify(localStorage)).not.toContain('hunter2');
    expect(JSON.stringify(getState().snapshot)).not.toContain('hunter2');
  });

  it('hands the string to the dev server, which is the only place it lives', async () => {
    __resetStore();
    const calls = record((url) => (url.includes('introspect-sql') ? { ok: true, rows: ROWS } : {}));
    await connectPostgres({ connectionString: STRING, schema: 'public' });

    const env = calls.find((call) => call.url === '/__loom/env');
    expect(JSON.parse(env!.body).env).toEqual({ DATABASE_URL: STRING });
  });

  it('connects with nothing typed when the dev server already holds one', async () => {
    __resetStore();
    const calls = record((url) => (url.includes('introspect-sql') ? { ok: true, rows: ROWS } : {}));

    expect((await connectPostgres({ connectionString: '' })).ok).toBe(true);
    // Nothing to store, so nothing is stored: the server used what it had.
    expect(calls.some((call) => call.url === '/__loom/env')).toBe(false);
    expect(JSON.parse(calls[0]!.body).schema).toBe('public');
  });

  it('refuses a string that is not one, before opening anything', async () => {
    __resetStore();
    const calls = record(() => ({ ok: true, rows: ROWS }));

    const result = await connectPostgres({ connectionString: 'db.example.com' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/starts with postgres:\/\//);
    expect(calls).toEqual([]);
  });

  it('shows what the database said and stays disconnected', async () => {
    __resetStore();
    record(() => ({ ok: false, error: 'password authentication failed for user "app"' }));

    const result = await connectPostgres({ connectionString: STRING });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/password authentication failed/);
    expect(Object.keys(getState().snapshot.connectors)).toEqual([]);
  });

  it('says so when the schema is empty rather than connecting to nothing', async () => {
    __resetStore();
    record(() => ({ ok: true, rows: [] }));

    const result = await connectPostgres({ connectionString: STRING });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/holds no tables/);
  });

  it('re-reading a schema replaces it rather than adding a second connection', async () => {
    __resetStore();
    record(() => ({ ok: true, rows: ROWS }));
    await connectPostgres({ connectionString: STRING });
    await connectPostgres({ connectionString: STRING, schema: 'billing' });

    expect(Object.keys(getState().snapshot.connectors)).toHaveLength(1);
    expect(connectionUrl(getState().snapshot)).toBe('billing schema');
  });
});

describe('a statement the designer writes', () => {
  /** A connected project with one API route, which is where server work is allowed to live. */
  async function connectedRoute(): Promise<{ route: string; query: string }> {
    __resetStore();
    record(() => ({ ok: true, rows: ROWS }));
    await connectPostgres({ connectionString: STRING });
    const route = addGraphNode('api', 'route');
    const query = addQueryStep(route)!;
    return { route, query };
  }

  it('is offered only where a statement can actually be run', async () => {
    __resetStore();
    expect(canRunSql(getState().snapshot)).toBe(false);
    record(() => ({ ok: true, rows: ROWS }));
    await connectPostgres({ connectionString: STRING });
    expect(canRunSql(getState().snapshot)).toBe(true);
  });

  it('turns every name it asks for into an input on the step', async () => {
    const { query } = await connectedRoute();
    setQuerySql(query, 'SELECT * FROM notes WHERE title = :title AND id > :since');

    const node = getState().snapshot.nodes[query]!;
    expect(node.ports.filter((port) => port.direction === 'in').map((port) => port.name)).toEqual([
      'title',
      'since',
    ]);
  });

  it('takes an input away again when the name stops being asked for', async () => {
    const { query } = await connectedRoute();
    setQuerySql(query, 'SELECT * FROM notes WHERE id > :since');
    setQuerySql(query, 'SELECT * FROM notes');

    const node = getState().snapshot.nodes[query]!;
    expect(node.ports.filter((port) => port.direction === 'in')).toEqual([]);
  });

  it('retypes the route that holds it, so the request advertises what it needs', async () => {
    const { route, query } = await connectedRoute();
    setQuerySql(query, 'SELECT * FROM notes WHERE title = :title');

    const api = getState().snapshot.nodes[route]!;
    expect(api.ports.some((port) => port.name === 'title')).toBe(true);
  });

  it('keeps whether it answers with one row or all of them', async () => {
    const { query } = await connectedRoute();
    setQuerySql(query, 'SELECT * FROM notes WHERE id = :id', 'one');
    expect((getState().snapshot.nodes[query]!.config as { returns?: string }).returns).toBe('one');

    // Editing the text afterwards does not quietly reset that choice.
    setQuerySql(query, 'SELECT * FROM notes WHERE id = :id LIMIT 1');
    expect((getState().snapshot.nodes[query]!.config as { returns?: string }).returns).toBe('one');
  });
});
