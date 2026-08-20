import { newConnectorId, newNodeId, type Id, type Snapshot } from '@loom/ir';
import {
  createDbNode,
  supabaseConnector,
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

export function supabaseConnection(snapshot: Snapshot) {
  return Object.values(snapshot.connectors).find((c) => c.moduleId === 'supabase');
}

export function connectedTables(snapshot: Snapshot): TableSchema[] {
  const connector = supabaseConnection(snapshot);
  const config = (connector?.config ?? {}) as { schema?: IntrospectionResult };
  return config.schema?.tables ?? [];
}

export function connectionUrl(snapshot: Snapshot): string | undefined {
  const config = (supabaseConnection(snapshot)?.config ?? {}) as { url?: string };
  return config.url;
}

export function disconnect(): void {
  const connector = supabaseConnection(getState().snapshot);
  if (connector) dispatch({ type: 'removeConnector', connectorId: connector.id });
}

/**
 * Add a database step to an API route. Database work only ever runs on the server, so it lands
 * inside the route's body — the compiler refuses it anywhere else.
 */
export function addDbStep(
  apiNodeId: Id,
  tableName: string,
  operation: 'select' | 'insert',
): Id | undefined {
  const snapshot = getState().snapshot;
  const api = snapshot.nodes[apiNodeId];
  const connector = supabaseConnection(snapshot);
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
