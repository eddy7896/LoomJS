import { afterEach, describe, expect, it, vi } from 'vitest';
import { __resetStore, getState } from '../src/state/store';
import {
  addDbStep,
  applySchemaChange,
  connectFirestore,
  connectPostgres,
  connectedTables,
  schemaEditing,
} from '../src/state/connectors';
import { addGraphNode } from '../src/state/graph';

/**
 * Making the data structure (`docs/15-schema.md`).
 *
 * Two things worth holding onto here. A schema change is DDL, which takes no parameters, so what
 * crosses to the dev server is checked before it is sent. And a change makes the cached schema
 * wrong, so what happens *after* it lands matters as much: a column that no longer exists must
 * not survive as a port that emits code referencing it.
 */

const ROW = (table: string, column: string, type: string, primary = false) => ({
  table_name: table,
  column_name: column,
  data_type: type,
  is_nullable: 'YES',
  column_default: primary ? 'nextval()' : null,
  is_primary: primary,
});

/** The schema as the database reports it — changed between calls, as a real one would be. */
let rows = [ROW('notes', 'id', 'bigint', true), ROW('notes', 'title', 'text')];

interface Call {
  url: string;
  body: string;
}

function record(): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: String(init?.body ?? '') });

    if (url.includes('apply-schema')) return new Response(JSON.stringify({ ok: true }));
    if (url.includes('introspect-sql')) return new Response(JSON.stringify({ ok: true, rows }));
    return new Response(JSON.stringify({ ok: true }));
  });
  return calls;
}

async function connected(): Promise<Call[]> {
  __resetStore();
  rows = [ROW('notes', 'id', 'bigint', true), ROW('notes', 'title', 'text')];
  const calls = record();
  await connectPostgres({ connectionString: 'postgresql://app:pw@db:5432/app' });
  calls.length = 0;
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('what can change a schema at all', () => {
  it('needs a connection that runs statements, and says so when there is not one', async () => {
    __resetStore();
    expect(schemaEditing(getState().snapshot, [])).toBe('none');

    await connected();
    expect(schemaEditing(getState().snapshot, [])).toBe('sql');
  });

  it('asks a Supabase project for its connection string rather than offering dead buttons', () => {
    __resetStore();
    // PostgREST cannot run DDL, so the answer depends on what the dev server holds.
    const snapshot = { ...getState().snapshot };
    snapshot.connectors = {
      cn: { id: 'cn', moduleId: 'supabase', config: {}, credentialRef: 'default' },
    };
    expect(schemaEditing(snapshot, [])).toBe('needs-connection-string');
    expect(schemaEditing(snapshot, ['DATABASE_URL'])).toBe('sql');
  });
});

describe('making a table', () => {
  it('sends one statement, built where the checks are', async () => {
    const calls = await connected();

    const result = await applySchemaChange({
      kind: 'createTable',
      table: { name: 'tasks', key: 'uuid', columns: [{ name: 'label', type: 'text', required: true }] },
    });
    expect(result.ok).toBe(true);

    const applied = calls.find((call) => call.url.includes('apply-schema'))!;
    expect(JSON.parse(applied.body).statements).toEqual([
      'create table "tasks" ("id" uuid primary key default gen_random_uuid(), "label" text not null)',
    ]);
  });

  it('refuses a name that is not one, before anything is sent', async () => {
    const calls = await connected();

    const result = await applySchemaChange({
      kind: 'createTable',
      table: { name: 'tasks; drop table notes', key: 'uuid', columns: [] },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/cannot be used as a name/);
    expect(calls.filter((call) => call.url.includes('apply-schema'))).toEqual([]);
  });

  it('reads the schema again afterwards, because the cached one is now wrong', async () => {
    const calls = await connected();
    rows = [...rows, ROW('tasks', 'id', 'uuid', true)];

    await applySchemaChange({
      kind: 'createTable',
      table: { name: 'tasks', key: 'uuid', columns: [] },
    });

    expect(calls.some((call) => call.url.includes('introspect-sql'))).toBe(true);
    expect(connectedTables(getState().snapshot).map((table) => table.name)).toEqual([
      'notes',
      'tasks',
    ]);
  });
});

describe('after a column changes', () => {
  it('a new column becomes an input on the step that writes the table', async () => {
    await connected();
    const route = addGraphNode('api', 'route');
    const step = addDbStep(route, 'notes', 'insert')!;

    rows = [...rows, ROW('notes', 'body', 'text')];
    await applySchemaChange({
      kind: 'addColumn',
      table: 'notes',
      column: { name: 'body', type: 'text' },
    });

    const ports = getState().snapshot.nodes[step]!.ports.map((port) => port.name);
    expect(ports).toContain('body');
  });

  it('a dropped column stops being a port, rather than emitting a write to nowhere', async () => {
    await connected();
    const route = addGraphNode('api', 'route');
    const step = addDbStep(route, 'notes', 'insert')!;
    expect(getState().snapshot.nodes[step]!.ports.map((port) => port.name)).toContain('title');

    rows = [ROW('notes', 'id', 'bigint', true)];
    await applySchemaChange({ kind: 'dropColumn', table: 'notes', column: 'title' });

    const ports = getState().snapshot.nodes[step]!.ports.map((port) => port.name);
    expect(ports).not.toContain('title');
    // And the route that holds the step is retyped with it: its inputs are its body's shape.
    expect(getState().snapshot.nodes[route]!.ports.map((port) => port.name)).not.toContain('title');
  });
});

describe('a shape loom keeps itself', () => {
  const KEY = JSON.stringify({
    type: 'service_account',
    project_id: 'demo',
    client_email: 'x@demo.iam.gserviceaccount.com',
    private_key: 'k',
  });

  async function onFirestore(): Promise<void> {
    __resetStore();
    vi.stubGlobal('fetch', async (input: RequestInfo) =>
      String(input).includes('introspect-firestore')
        ? new Response(
            JSON.stringify({
              ok: true,
              projectId: 'demo',
              docs: [{ collection: 'notes', id: 'a', fields: { title: 'One' } }],
            }),
          )
        : new Response(JSON.stringify({ ok: true })),
    );
    await connectFirestore({ serviceAccount: KEY });
  }

  it('adds a field without sending anything to a database that has no schema', async () => {
    await onFirestore();
    const sent: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo) => {
      sent.push(String(input));
      return new Response(JSON.stringify({ ok: true }));
    });

    expect(
      (await applySchemaChange({
        kind: 'addColumn',
        table: 'notes',
        column: { name: 'body', type: 'text' },
      })).ok,
    ).toBe(true);

    expect(sent).toEqual([]);
    expect(connectedTables(getState().snapshot)[0]!.columns.map((column) => column.name)).toEqual([
      'id',
      'title',
      'body',
    ]);
  });

  it('says plainly that a rule it cannot enforce is not one it will pretend to set', async () => {
    await onFirestore();
    const result = await applySchemaChange({
      kind: 'setRequired',
      table: 'notes',
      column: 'title',
      required: true,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/stores whatever a document holds/);
  });

  it('makes a collection in the shape, id and all', async () => {
    await onFirestore();
    await applySchemaChange({
      kind: 'createTable',
      table: { name: 'tasks', key: 'uuid', columns: [{ name: 'label', type: 'text' }] },
    });

    const tasks = connectedTables(getState().snapshot).find((table) => table.name === 'tasks')!;
    expect(tasks.columns.map((column) => column.name)).toEqual(['id', 'label']);
    expect(tasks.columns[0]!.primaryKey).toBe(true);
  });
});
