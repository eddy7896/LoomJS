import { newConnectorId, newMigrationId, newNodeId, type Id, type Snapshot } from '@loom/ir';
import {
  managementFields,
  parseAuthSettings,
  projectRef,
  checkConnectionString,
  checkServiceAccount,
  columnFromSpec,
  createDbNode,
  createQueryNode,
  dbNodePorts,
  describeChange,
  isDocumentStore,
  parseColumnRows,
  parseSampledDocs,
  planChange,
  queryNodePorts,
  sampleRow,
  seedStatement,
  speaksSql,
  supabaseConnector,
  type ColumnRow,
  type ColumnSpec,
  type IndexRow,
  type RelationRow,
  type SampledDoc,
  type SchemaChange,
  type DbFilter,
  type DbNodeConfig,
  type DbOperation,
  type IntrospectionResult,
  type TableSchema,
} from '@loom/connectors';
import { apiPortsFromBody } from '@loom/components';
import { dispatch, getState, select } from './store';

/**
 * Connections, and the env bucket that backs them.
 *
 * **No secret ever enters the document** (`docs/specs/connector-credentials.md`). The snapshot
 * gets the project URL and the cached schema — neither is secret — plus a `credentialRef` name.
 * The values live here, in the browser, and are handed to the Preview's dev server to inject by
 * name. They are never serialised into the snapshot, so saving or sharing a project cannot leak
 * one.
 */

const STORAGE_KEY = 'loom.env';

export interface EnvBucket {
  [name: string]: string;
}

function readBucket(): EnvBucket {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as EnvBucket;
  } catch {
    return {};
  }
}

function writeBucket(bucket: EnvBucket): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bucket));
  } catch {
    /* a browser with storage disabled still works for one session */
  }
}

export function envNames(): string[] {
  return Object.keys(readBucket()).sort();
}

/** True when a value exists — the studio never reads a stored value back out to the UI. */
export function hasEnv(name: string): boolean {
  return Boolean(readBucket()[name]);
}

export function setEnv(values: EnvBucket): void {
  const bucket = { ...readBucket(), ...values };
  writeBucket(bucket);
  void pushEnvToPreview(bucket);
}

/** Hand the bucket to the dev server, which injects it into the Preview by name. */
export async function pushEnvToPreview(bucket: EnvBucket = readBucket()): Promise<void> {
  try {
    await fetch('/__loom/env', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ env: bucket }),
    });
  } catch {
    /* the Preview simply stays unconfigured */
  }
}

/**
 * Hand a credential to the dev server **without** keeping a copy here.
 *
 * The env bucket above is a convenience for values a designer would otherwise retype; a
 * connection string is not one of those, because it carries the password to the whole database in
 * the middle of it. It goes to the server, the server holds it, and a reload asks the server
 * whether it still does rather than reading it back out of this browser
 * (`docs/specs/connector-credentials.md`).
 */
async function sendToServer(values: EnvBucket): Promise<void> {
  await fetch('/__loom/env', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ env: values }),
  });
}

export interface ConnectInput {
  url: string;
  anonKey: string;
  serviceKey: string;
}

export interface ServerEnv {
  /** Every SUPABASE_* name the dev server holds, from `.env.local` or from this studio. */
  names: string[];
  /** Values for client-scoped credentials only — a service role key never leaves the server. */
  values: Record<string, string>;
}

/** What the dev server already holds, so a designer with a `.env.local` need type nothing. */
export async function readServerEnv(): Promise<ServerEnv> {
  try {
    const response = await fetch('/__loom/env');
    return (await response.json()) as ServerEnv;
  } catch {
    return { names: [], values: {} };
  }
}

/**
 * How the studio reads a project's schema.
 *
 * A hosted Supabase project serves its OpenAPI document **only to the service role key**, which
 * may never enter a browser. So: try the call directly (a self-hosted project, or a stub, answers
 * the anon key), and if the project refuses the key, ask the dev server to make the same call
 * with the key it holds. Only the document comes back — names are not secret, the key is
 * (`docs/specs/connector-credentials.md`).
 */
export const introspectFetch: typeof fetch = async (input, init) => {
  const endpoint = typeof input === 'string' ? input : String((input as Request).url ?? input);

  let direct: Response | undefined;
  try {
    direct = await fetch(input, init);
  } catch {
    // A browser cannot reach it: CORS, DNS, or the project is down. The dev server may still.
  }

  if (direct && direct.status !== 401 && direct.status !== 403) return direct;

  const projectUrl = endpoint.replace(/\/rest\/v1\/?$/, '');
  // The key that was just refused is not worth sending again; the server uses its own.
  const relayed = await fetch('/__loom/introspect', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: projectUrl }),
  });

  const payload = (await relayed.json()) as {
    ok?: boolean;
    status?: number;
    body?: string;
    error?: string;
  };

  if (!payload.ok) {
    // Prefer the project's own refusal over the relay's, when there was one.
    if (direct) return direct;
    throw new Error(payload.error ?? 'The dev server could not read the schema.');
  }

  return new Response(payload.body ?? '', {
    status: payload.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
};

export interface ConnectResult {
  ok: boolean;
  error?: string;
  connectorId?: string;
  tables?: TableSchema[];
}

/**
 * Connecting *is* validating: the schema read is the proof that the URL and key work, so a typo
 * surfaces here rather than at the first query.
 */
export async function connectSupabase(input: ConnectInput): Promise<ConnectResult> {
  let introspection: IntrospectionResult;
  try {
    introspection = await supabaseConnector.introspect(
      { url: input.url },
      {
        SUPABASE_ANON_KEY: input.anonKey,
        SUPABASE_SERVICE_ROLE_KEY: input.serviceKey,
      },
      introspectFetch,
    );
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }

  // The values go to the bucket; only the URL and the (non-secret) schema go to the document.
  // An empty key means "keep whatever the server already has" — that is how a `.env.local`
  // service role key stays server-side while the studio still connects.
  setEnv({
    SUPABASE_URL: input.url,
    ...(input.anonKey ? { SUPABASE_ANON_KEY: input.anonKey } : {}),
    ...(input.serviceKey ? { SUPABASE_SERVICE_ROLE_KEY: input.serviceKey } : {}),
  });

  const existing = Object.values(getState().snapshot.connectors).find(
    (connector) => connector.moduleId === 'supabase',
  );

  const connectorId = existing?.id ?? newConnectorId();
  const config = { url: input.url, schema: introspection };

  if (existing) {
    dispatch({ type: 'setConnectorConfig', connectorId, config });
  } else {
    dispatch({
      type: 'addConnector',
      connector: { id: connectorId, moduleId: 'supabase', config, credentialRef: 'default' },
    });
  }

  return { ok: true, connectorId, tables: introspection.tables };
}

export interface PostgresInput {
  /** Empty means "use the DATABASE_URL the dev server already holds". */
  connectionString: string;
  schema?: string;
}

/**
 * Connect straight to a database.
 *
 * A browser cannot open a database socket, so the read happens on loom's dev server and only the
 * schema comes back. Connecting *is* validating here too: if the string is wrong, or the user it
 * names cannot see the schema, that surfaces now rather than at the first query.
 */
export async function connectPostgres(input: PostgresInput): Promise<ConnectResult> {
  const schema = (input.schema ?? '').trim() || 'public';
  const connectionString = input.connectionString.trim();

  if (connectionString) {
    try {
      checkConnectionString(connectionString, 'postgres');
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }

  let tables: TableSchema[];
  try {
    const response = await fetch('/__loom/introspect-sql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ connectionString, schema }),
    });
    const payload = (await response.json()) as {
      ok?: boolean;
      rows?: ColumnRow[];
      relations?: RelationRow[];
      indexes?: IndexRow[];
      error?: string;
    };
    if (!payload.ok) return { ok: false, error: payload.error ?? 'Could not read the schema.' };
    tables = parseColumnRows(payload.rows ?? [], payload.relations ?? [], payload.indexes ?? []);
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }

  // The string goes to the server and nowhere else; the document gets the schema name and the
  // cached schema, neither of which is secret.
  if (connectionString) await sendToServer({ DATABASE_URL: connectionString });

  const existing = Object.values(getState().snapshot.connectors).find(
    (connector) => connector.moduleId === 'postgres',
  );
  const connectorId = existing?.id ?? newConnectorId();
  const config = { schema: { tables }, schemaName: schema };

  if (existing) {
    dispatch({ type: 'setConnectorConfig', connectorId, config });
  } else {
    dispatch({
      type: 'addConnector',
      connector: { id: connectorId, moduleId: 'postgres', config, credentialRef: 'default' },
    });
  }

  return { ok: true, connectorId, tables };
}

export interface FirestoreInput {
  /** The whole key file. Empty means "use the one the dev server already holds". */
  serviceAccount: string;
}

/**
 * Connect to a Firestore project.
 *
 * There is no schema to read, so connecting *samples* documents: the dev server lists the
 * collections and reads the first few of each, and what comes back is the fields those documents
 * happened to carry. That is the honest description of a schemaless store, and the panel says how
 * many documents it looked at rather than implying it found a schema.
 */
export async function connectFirestore(input: FirestoreInput): Promise<ConnectResult> {
  const serviceAccount = input.serviceAccount.trim();
  let projectId = '';

  if (serviceAccount) {
    try {
      projectId = checkServiceAccount(serviceAccount).projectId;
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }

  let tables: TableSchema[];
  try {
    const response = await fetch('/__loom/introspect-firestore', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ serviceAccount }),
    });
    const payload = (await response.json()) as {
      ok?: boolean;
      docs?: SampledDoc[];
      projectId?: string;
      error?: string;
    };
    if (!payload.ok) return { ok: false, error: payload.error ?? 'Could not read the project.' };
    tables = parseSampledDocs(payload.docs ?? []);
    projectId = projectId || String(payload.projectId ?? '');
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }

  // The key holds a private key, so it goes to the server and nowhere else. What the document
  // keeps is the project id and the sampled shape, neither of which is secret.
  if (serviceAccount) await sendToServer({ FIREBASE_SERVICE_ACCOUNT: serviceAccount });

  const existing = Object.values(getState().snapshot.connectors).find(
    (connector) => connector.moduleId === 'firestore',
  );
  const connectorId = existing?.id ?? newConnectorId();
  const config = { schema: { tables }, projectId };

  if (existing) {
    dispatch({ type: 'setConnectorConfig', connectorId, config });
  } else {
    dispatch({
      type: 'addConnector',
      connector: { id: connectorId, moduleId: 'firestore', config, credentialRef: 'default' },
    });
  }

  return { ok: true, connectorId, tables };
}

export function supabaseConnection(snapshot: Snapshot) {
  return Object.values(snapshot.connectors).find((c) => c.moduleId === 'supabase');
}

/**
 * The connection a project is working against.
 *
 * One at a time, deliberately: a database node names its connector, so two connections would be
 * a picker on every node and a way to wire a read from one into a write to the other. That is a
 * decision to make on purpose rather than to fall into.
 */
export function connection(snapshot: Snapshot) {
  return Object.values(snapshot.connectors)[0];
}

export function connectedTables(snapshot: Snapshot): TableSchema[] {
  const config = (connection(snapshot)?.config ?? {}) as { schema?: IntrospectionResult };
  return config.schema?.tables ?? [];
}

/** What to show as the connection: a project URL, or the schema a database connection read. */
export function connectionUrl(snapshot: Snapshot): string | undefined {
  const connector = connection(snapshot);
  if (!connector) return undefined;
  const config = (connector.config ?? {}) as {
    url?: string;
    schemaName?: string;
    projectId?: string;
  };
  if (config.url) return config.url;
  return connector.moduleId === 'firestore'
    ? (config.projectId ?? 'Firestore project')
    : `${config.schemaName ?? 'public'} schema`;
}

export function disconnect(): void {
  const connector = connection(getState().snapshot);
  if (connector) dispatch({ type: 'removeConnector', connectorId: connector.id });
}

/**
 * Add a database step to an API route. Database work only ever runs on the server, so it lands
 * inside the route's body — the compiler refuses it anywhere else.
 */
export function addDbStep(
  apiNodeId: Id,
  tableName: string,
  operation: DbOperation,
): Id | undefined {
  const snapshot = getState().snapshot;
  const api = snapshot.nodes[apiNodeId];
  const connector = connection(snapshot);
  const table = connectedTables(snapshot).find((candidate) => candidate.name === tableName);
  if (!api || api.category !== 'api' || !connector || !table) return undefined;

  const node = createDbNode(
    newNodeId(),
    { x: api.position.x, y: api.position.y + 160 },
    connector.id,
    table,
    operation,
  );
  dispatch({ type: 'addNode', node });

  const config = (api.config ?? {}) as { body?: Id[]; path?: string; method?: string };
  const body = [...(config.body ?? []), node.id];

  // The route's ports come from its body, so adding a step retypes the container in the same op
  // batch: an insert's columns become the route's inputs, ready to wire a form into.
  const bodyNodes = body
    .map((id) => (id === node.id ? node : getState().snapshot.nodes[id]))
    .filter((step): step is NonNullable<typeof step> => Boolean(step));

  dispatch({
    type: 'setNodeConfig',
    nodeId: apiNodeId,
    config: {
      ...config,
      body,
      path: config.path && config.path !== 'run' ? config.path : `${operation}${table.name}`,
    },
    ports: apiPortsFromBody(bodyNodes),
  });

  select({ kind: 'node', id: node.id });
  return node.id;
}

/** True when the attached connection can run a statement, rather than only a request. */
export function canRunSql(snapshot: Snapshot): boolean {
  const connector = connection(snapshot);
  return Boolean(connector && speaksSql(connector.moduleId));
}

/**
 * Add a statement the designer writes themselves.
 *
 * The four table nodes cover what most screens need and cover it safely; a join, a group-by or a
 * window function is where they stop. Rather than growing the vocabulary until it is SQL with
 * dropdowns, this node *is* SQL — with the one rule kept: a `:name` is a parameter, never text
 * spliced into the statement.
 */
export function addQueryStep(apiNodeId: Id): Id | undefined {
  const snapshot = getState().snapshot;
  const api = snapshot.nodes[apiNodeId];
  const connector = connection(snapshot);
  if (!api || api.category !== 'api' || !connector || !speaksSql(connector.moduleId)) {
    return undefined;
  }

  const node = createQueryNode(
    newNodeId(),
    { x: api.position.x, y: api.position.y + 160 },
    connector.id,
  );
  dispatch({ type: 'addNode', node });

  const config = (api.config ?? {}) as { body?: Id[]; path?: string; method?: string };
  dispatch({
    type: 'setNodeConfig',
    nodeId: apiNodeId,
    config: { ...config, body: [...(config.body ?? []), node.id] },
  });

  select({ kind: 'node', id: node.id });
  retypeRoute(apiNodeId);
  return node.id;
}

/**
 * Edit a statement.
 *
 * The names it asks for *are* its input ports, so typing `:since` into the text adds a port and
 * deleting it takes one away — and the route that holds the step is retyped in the same breath,
 * because its inputs are its body's shape.
 */
export function setQuerySql(nodeId: Id, sql: string, returns?: 'one' | 'many'): void {
  const snapshot = getState().snapshot;
  const node = snapshot.nodes[nodeId];
  if (!node || node.category !== 'db' || node.kind !== 'query') return;

  const config = { ...((node.config ?? {}) as Record<string, unknown>), sql, returns:
    returns ?? ((node.config ?? {}) as { returns?: string }).returns ?? 'many' };

  dispatch({ type: 'setNodeConfig', nodeId, config, ports: queryNodePorts(sql) });

  const route = routeContaining(getState().snapshot, nodeId);
  if (route) retypeRoute(route);
}

/**
 * Retype an API route from the steps in its body.
 *
 * The route's ports *are* its body's shape — an insert's columns, an update's identity, a read's
 * supplied filters — so anything that changes a step has to travel with the container in the same
 * op batch, or the route would advertise inputs that no longer exist.
 */
function retypeRoute(apiNodeId: Id): void {
  const snapshot = getState().snapshot;
  const api = snapshot.nodes[apiNodeId];
  if (!api || api.category !== 'api') return;

  const config = (api.config ?? {}) as { body?: Id[] };
  const bodyNodes = (config.body ?? [])
    .map((id) => snapshot.nodes[id])
    .filter((step): step is NonNullable<typeof step> => Boolean(step));

  dispatch({
    type: 'setNodeConfig',
    nodeId: apiNodeId,
    config: api.config as Record<string, unknown>,
    ports: apiPortsFromBody(bodyNodes),
  });
}

/** The API route whose body holds `nodeId`, if any. */
export function routeContaining(snapshot: Snapshot, nodeId: Id): Id | undefined {
  for (const node of Object.values(snapshot.nodes)) {
    if (node.category !== 'api') continue;
    if (((node.config ?? {}) as { body?: Id[] }).body?.includes(nodeId)) return node.id;
  }
  return undefined;
}

/**
 * Change a read's narrowing. A filter that reads its value from an input adds a port, which
 * becomes a route input — so the container is retyped in the same breath.
 */
export function setDbFilters(nodeId: Id, filters: DbFilter[]): void {
  const snapshot = getState().snapshot;
  const node = snapshot.nodes[nodeId];
  if (!node || node.category !== 'db') return;

  const config = { ...((node.config ?? {}) as DbNodeConfig), filters };
  const table = connectedTables(snapshot).find((candidate) => candidate.name === config.table);
  if (!table) return;

  dispatch({
    type: 'setNodeConfig',
    nodeId,
    config: config as unknown as Record<string, unknown>,
    ports: dbNodePorts(table, config.operation, filters),
  });

  const route = routeContaining(getState().snapshot, nodeId);
  if (route) retypeRoute(route);
}

/**
 * Make a schema change (`docs/15-schema.md`).
 *
 * The statements are built here, where the checks live, and run on the dev server — a browser
 * cannot open a database connection, and DDL is not something to trust a round trip about. What
 * comes back is whether it worked; what happens next is a re-read, because the cached schema is
 * now wrong.
 */
export async function applySchemaChange(change: SchemaChange): Promise<{ ok: boolean; error?: string }> {
  const connector = connection(getState().snapshot);
  if (!connector) return { ok: false, error: 'No connection to change.' };

  // A document store has no schema to alter: the shape is loom's own, so it is edited in the
  // document rather than sent anywhere.
  if (isDocumentStore(connector.moduleId)) return applyToShape(change);

  let statements: string[];
  try {
    statements = planChange(change);
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }

  try {
    const response = await fetch('/__loom/apply-schema', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ statements }),
    });
    const payload = (await response.json()) as { ok?: boolean; error?: string };
    if (!payload.ok) return { ok: false, error: payload.error ?? 'The change did not apply.' };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }

  // What ran, recorded so the repo can carry it. A migration describes what *was* applied, so
  // it is written only once the database has accepted it (`docs/15-schema.md`).
  const existing = getState().snapshot.migrations ?? [];
  dispatch({
    type: 'recordMigration',
    migration: {
      id: newMigrationId(),
      index: existing.length + 1,
      description: describeChange(change),
      appliedAt: new Date().toISOString(),
      statements,
    },
  });

  await refreshSchema();
  return { ok: true };
}

/**
 * Put some rows in a table, so a screen has something to render (D7).
 *
 * A blank table makes every screen look broken while it is being designed, and typing five rows
 * by hand to find that out is worse. The values are parameters, like every other value loom sends
 * to a database — the rows are generated here, but nothing about them becomes SQL text.
 */
export async function seedTable(
  tableName: string,
  count = 5,
): Promise<{ ok: boolean; error?: string }> {
  const snapshot = getState().snapshot;
  const connector = connection(snapshot);
  if (!connector) return { ok: false, error: 'No connection to fill.' };
  if (isDocumentStore(connector.moduleId)) {
    return {
      ok: false,
      error: 'Sample rows are written by the database connection, and Firestore has none here yet.',
    };
  }

  const table = connectedTables(snapshot).find((candidate) => candidate.name === tableName);
  if (!table) return { ok: false, error: `There is no table called ${tableName}.` };

  const rows = Array.from({ length: count }, (_, index) => sampleRow(table.columns, index + 1));
  const columns = Object.keys(rows[0] ?? {});
  if (columns.length === 0) {
    return {
      ok: false,
      error:
        'Every column here is filled in by the database or points at another table, so there is ' +
        'nothing for loom to make up.',
    };
  }

  let statement: { text: string; values: unknown[] };
  try {
    statement = seedStatement(tableName, columns, rows);
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }

  try {
    const response = await fetch('/__loom/seed', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(statement),
    });
    const payload = (await response.json()) as { ok?: boolean; error?: string };
    if (!payload.ok) return { ok: false, error: payload.error ?? 'The rows were not added.' };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }

  return { ok: true };
}

/**
 * The same change, against a shape loom keeps itself.
 *
 * Firestore has no DDL, and writing a placeholder document to "create" a collection would be loom
 * putting junk in someone's database. So the shape is a record of what the designer says a
 * collection holds — real enough to type ports and build forms from, and honest that the database
 * enforces none of it.
 */
function applyToShape(change: SchemaChange): { ok: boolean; error?: string } {
  const connector = connection(getState().snapshot);
  if (!connector) return { ok: false, error: 'No connection to change.' };

  const config = (connector.config ?? {}) as { schema?: { tables?: TableSchema[] } };
  const tables = [...(config.schema?.tables ?? [])];
  const indexOf = (name: string): number => tables.findIndex((table) => table.name === name);

  const edit = (name: string, change: (table: TableSchema) => TableSchema): void => {
    const at = indexOf(name);
    if (at >= 0) tables[at] = change(tables[at]!);
  };

  switch (change.kind) {
    case 'createTable':
      if (indexOf(change.table.name) >= 0) {
        return { ok: false, error: `There is already a collection called ${change.table.name}.` };
      }
      tables.push({
        name: change.table.name,
        columns: [
          { name: 'id', type: { kind: 'text' }, required: false, primaryKey: true, generated: true },
          ...change.table.columns.map(columnFromSpec),
        ],
      });
      break;

    case 'addColumn':
      edit(change.table, (table) => ({
        ...table,
        columns: [...table.columns, columnFromSpec(change.column)],
      }));
      break;

    case 'renameColumn':
      edit(change.table, (table) => ({
        ...table,
        columns: table.columns.map((column) =>
          column.name === change.from ? { ...column, name: change.to } : column,
        ),
      }));
      break;

    case 'dropColumn':
      edit(change.table, (table) => ({
        ...table,
        columns: table.columns.filter((column) => column.name !== change.column),
      }));
      break;

    case 'renameTable':
      edit(change.from, (table) => ({ ...table, name: change.to }));
      break;

    case 'dropTable': {
      const at = indexOf(change.table);
      if (at >= 0) tables.splice(at, 1);
      break;
    }

    default:
      // Types, defaults, requirements and uniqueness are rules a database enforces, and this one
      // does not. Saying so beats keeping a flag that means nothing.
      return {
        ok: false,
        error: 'Firestore stores whatever a document holds, so that is not something loom can set.',
      };
  }

  dispatch({
    type: 'setConnectorConfig',
    connectorId: connector.id,
    config: { ...(connector.config as Record<string, unknown>), schema: { tables } },
  });
  retypeAgainstSchema();
  return { ok: true };
}

/** Read the schema again, and retype everything standing on it. */
export async function refreshSchema(): Promise<void> {
  const connector = connection(getState().snapshot);
  if (!connector) return;

  const config = (connector.config ?? {}) as { schemaName?: string };
  if (connector.moduleId === 'postgres') {
    await connectPostgres({ connectionString: '', schema: config.schemaName });
  } else if (connector.moduleId === 'supabase') {
    const url = connectionUrl(getState().snapshot) ?? '';
    await connectSupabase({ url, anonKey: '', serviceKey: '' });
  }

  retypeAgainstSchema();
}

/**
 * Bring every database node back in line with the schema.
 *
 * A column that no longer exists must not survive as a port: the emitted code would reference a
 * column the database does not have, which is a failed write at best and a silent one at worst.
 * Routes are retyped with their steps, because a route's inputs *are* its body's shape.
 */
export function retypeAgainstSchema(): void {
  const snapshot = getState().snapshot;

  for (const node of Object.values(snapshot.nodes)) {
    if (node.category !== 'db' || node.kind === 'query') continue;
    const config = (node.config ?? {}) as Partial<DbNodeConfig>;
    const table = connectedTables(snapshot).find((candidate) => candidate.name === config.table);
    if (!table) continue;

    dispatch({
      type: 'setNodeConfig',
      nodeId: node.id,
      config: config as unknown as Record<string, unknown>,
      ports: dbNodePorts(table, (config.operation ?? node.kind) as DbOperation, config.filters ?? []),
    });
  }

  for (const node of Object.values(getState().snapshot.nodes)) {
    if (node.category === 'api') retypeRoute(node.id);
  }
}

/** The columns of the table a database node reads or writes, for the inspector to offer. */
export function columnsOf(snapshot: Snapshot, nodeId: Id): TableSchema['columns'] {
  const node = snapshot.nodes[nodeId];
  const config = (node?.config ?? {}) as Partial<DbNodeConfig>;
  const table = connectedTables(snapshot).find((candidate) => candidate.name === config.table);
  return table?.columns ?? [];
}

/**
 * How this project can change its schema (`docs/15-schema.md`).
 *
 * `sql` means DDL over a real connection. `shape` means Firestore, where loom keeps the shape and
 * the database enforces none of it. `needs-connection-string` is the Supabase case: PostgREST
 * cannot run DDL, so schema editing waits for the project's Postgres URL rather than pretending
 * the buttons will work.
 */
export type SchemaEditing = 'sql' | 'shape' | 'needs-connection-string' | 'none';

export function schemaEditing(snapshot: Snapshot, serverNames: readonly string[]): SchemaEditing {
  const connector = connection(snapshot);
  if (!connector) return 'none';
  if (isDocumentStore(connector.moduleId)) return 'shape';
  if (connector.moduleId === 'postgres') return 'sql';
  return serverNames.includes('DATABASE_URL') ? 'sql' : 'needs-connection-string';
}

/**
 * Setting a sign-in provider up (A3, `docs/20-provider-setup.md`).
 *
 * A button that signs in with Google needs a client id and a secret somewhere. Which "somewhere"
 * depends on how this project's auth is run, and loom does not pretend the three cases are one.
 */

/** Which providers the connected project actually has turned on, as it reports them. */
export async function readAuthProviders(): Promise<Record<string, boolean>> {
  const snapshot = getState().snapshot;
  const connector = Object.values(snapshot.connectors).find(
    (candidate) => candidate.moduleId === 'supabase',
  );
  const url = ((connector?.config ?? {}) as { url?: string }).url ?? '';
  if (!url) return {};

  try {
    const response = await fetch('/__loom/auth-settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const payload = (await response.json()) as { ok?: boolean; settings?: unknown };
    return payload.ok ? parseAuthSettings(payload.settings) : {};
  } catch {
    // A project that cannot be reached is not a project with no providers, so the panel says
    // "could not check" rather than drawing every one of them as off.
    return {};
  }
}

/**
 * Turn a provider on in the connected Supabase project.
 *
 * The id and secret go browser → dev server → Supabase and are stored nowhere along the way. They
 * are never put in the env bucket, because they are not this app's credentials: they belong to the
 * auth server, and loom is only the messenger.
 */
export async function enableProvider(input: {
  provider: string;
  clientId: string;
  secret: string;
}): Promise<{ ok: boolean; error?: string }> {
  const snapshot = getState().snapshot;
  const connector = Object.values(snapshot.connectors).find(
    (candidate) => candidate.moduleId === 'supabase',
  );
  const url = ((connector?.config ?? {}) as { url?: string }).url ?? '';
  const ref = projectRef(url);
  if (!ref) {
    return {
      ok: false,
      error: 'This is not a hosted Supabase project, so there is no project setting to change.',
    };
  }

  const fields = managementFields(input.provider);
  try {
    const response = await fetch('/__loom/auth-provider', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ref,
        fields: {
          [fields.enabled]: true,
          [fields.clientId]: input.clientId.trim(),
          [fields.secret]: input.secret.trim(),
        },
      }),
    });
    const payload = (await response.json()) as { ok?: boolean; error?: string };
    return payload.ok ? { ok: true } : { ok: false, error: payload.error ?? 'It was not accepted.' };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

/** Whether this project runs its own auth server, which changes where the secrets belong. */
export function selfHostedAuth(snapshot: Snapshot): boolean {
  const connector = Object.values(snapshot.connectors).find(
    (candidate) => candidate.moduleId === 'supabase',
  );
  return Boolean(((connector?.config ?? {}) as { selfHostedAuth?: boolean }).selfHostedAuth);
}

export function setSelfHostedAuth(value: boolean): void {
  const snapshot = getState().snapshot;
  const connector = Object.values(snapshot.connectors).find(
    (candidate) => candidate.moduleId === 'supabase',
  );
  if (!connector) return;

  dispatch({
    type: 'setConnectorConfig',
    connectorId: connector.id,
    config: { ...(connector.config as Record<string, unknown>), selfHostedAuth: value },
  });
}
