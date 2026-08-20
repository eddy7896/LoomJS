import type { TypeRef } from '@loom/ir';
import {
  ConnectorError,
  type ColumnSchema,
  type ConnectorAdapter,
  type ConnectorCredentials,
  type IntrospectionResult,
  type ModuleManifest,
  type TableSchema,
} from './module';

/**
 * The Supabase connector.
 *
 * **Introspection reads the PostgREST OpenAPI document** that every Supabase project serves at
 * `GET {url}/rest/v1/`. That is a deliberate choice over the Management API: `04-hallucination-
 * check.md` says the Management API and OAuth partner-program terms must not be assumed, and
 * manual-connection-with-validation has to remain the baseline. The OpenAPI route needs nothing
 * but the project URL and an API key the designer already has.
 *
 * PostgREST's document is OpenAPI 2.0 and its exact per-column key set is not fully specified in
 * public docs, so this parser is **defensive**: every field is optional, an unrecognised column
 * type degrades to a visibly untyped port rather than a guess, and a malformed document is a
 * connector error rather than a half-built schema.
 */

export const SUPABASE_MANIFEST: ModuleManifest = {
  id: 'supabase',
  label: 'Supabase',
  kind: 'connector',
  config: [
    {
      key: 'url',
      label: 'Project URL',
      placeholder: 'https://xxxxxxxx.supabase.co',
      required: true,
    },
  ],
  credentials: [
    {
      name: 'SUPABASE_ANON_KEY',
      label: 'Anon key',
      scope: 'client',
      hint: 'Safe in the browser; protected by row-level security.',
    },
    {
      name: 'SUPABASE_SERVICE_ROLE_KEY',
      label: 'Service role key',
      scope: 'server',
      hint: 'Bypasses row-level security. Never leaves the server.',
    },
  ],
};

/** The OpenAPI 2.0 shape we read, with everything optional (see the note above). */
interface OpenApiColumn {
  type?: string;
  format?: string;
  description?: string;
  maxLength?: number;
  enum?: string[];
  default?: unknown;
}

interface OpenApiDefinition {
  properties?: Record<string, OpenApiColumn>;
  required?: string[];
}

interface OpenApiDocument {
  definitions?: Record<string, OpenApiDefinition>;
  paths?: Record<string, unknown>;
}

/**
 * Postgres type (PostgREST reports it in `format`) -> loom's visible vocabulary
 * (`docs/specs/type-registry.md`). Anything unlisted becomes `unknown`, which is inert until
 * someone narrows it — better than a plausible guess that type-checks and then fails at runtime.
 */
const PG_TYPES: Record<string, TypeRef['kind']> = {
  text: 'text',
  varchar: 'text',
  'character varying': 'text',
  character: 'text',
  bpchar: 'text',
  uuid: 'text',
  name: 'text',
  citext: 'text',
  int2: 'number',
  int4: 'number',
  int8: 'number',
  smallint: 'number',
  integer: 'number',
  bigint: 'number',
  numeric: 'number',
  decimal: 'number',
  real: 'number',
  float4: 'number',
  float8: 'number',
  'double precision': 'number',
  bool: 'boolean',
  boolean: 'boolean',
  date: 'date',
  timestamp: 'date',
  timestamptz: 'date',
  'timestamp with time zone': 'date',
  'timestamp without time zone': 'date',
  json: 'record',
  jsonb: 'record',
};

export function columnType(column: OpenApiColumn): TypeRef {
  if (column.enum && column.enum.length > 0) return { kind: 'enum', values: column.enum };

  const format = (column.format ?? '').toLowerCase().trim();

  // A Postgres array type is reported as `type[]`, e.g. `text[]`.
  if (format.endsWith('[]')) {
    const inner = PG_TYPES[format.slice(0, -2)];
    return { kind: 'list', of: inner ? ({ kind: inner } as TypeRef) : { kind: 'unknown' } };
  }

  const mapped = PG_TYPES[format];
  if (mapped) return { kind: mapped } as TypeRef;

  // Fall back to the JSON-schema `type` before giving up.
  switch (column.type) {
    case 'string':
      return { kind: 'text' };
    case 'number':
    case 'integer':
      return { kind: 'number' };
    case 'boolean':
      return { kind: 'boolean' };
    case 'array':
      return { kind: 'list', of: { kind: 'unknown' } };
    case 'object':
      return { kind: 'record' };
    default:
      return { kind: 'unknown' };
  }
}

/** PostgREST marks keys inside the column description, e.g. `Note: This is a Primary Key<pk/>`. */
function isPrimaryKey(column: OpenApiColumn): boolean {
  return /<pk\/>/i.test(column.description ?? '');
}

function isGenerated(column: OpenApiColumn, primaryKey: boolean): boolean {
  // Anything with a default is filled in by the database if the designer says nothing.
  if (column.default !== undefined) return true;
  // An identity/serial primary key carries no default in the document but is still generated.
  // A text or uuid key with no default is the designer's to supply, so it stays writable.
  return primaryKey && PG_TYPES[(column.format ?? '').toLowerCase()] === 'number';
}

export function parseOpenApi(document: OpenApiDocument): TableSchema[] {
  const definitions = document.definitions;
  if (!definitions || typeof definitions !== 'object') {
    throw new ConnectorError(
      'The project did not return a PostgREST schema document. Check the project URL.',
    );
  }

  const tables: TableSchema[] = [];

  for (const [name, definition] of Object.entries(definitions).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const properties = definition?.properties;
    if (!properties) continue;

    const requiredNames = new Set(definition.required ?? []);
    const columns: ColumnSchema[] = Object.entries(properties).map(([columnName, column]) => {
      const primaryKey = isPrimaryKey(column);
      const generated = isGenerated(column, primaryKey);
      return {
        name: columnName,
        type: columnType(column),
        required: requiredNames.has(columnName) && !generated,
        primaryKey,
        generated,
      };
    });

    tables.push({ name, columns });
  }

  return tables;
}

function restUrl(config: Record<string, string>): string {
  const url = (config.url ?? '').trim().replace(/\/+$/, '');
  if (!url) throw new ConnectorError('A project URL is required.');
  if (!/^https?:\/\//i.test(url)) {
    throw new ConnectorError('The project URL must start with https://.');
  }
  return `${url}/rest/v1/`;
}

/**
 * Connecting *is* validating (`docs/specs/connector-credentials.md`): a typo surfaces here, at
 * the moment of entry, rather than at the first query.
 */
export const supabaseConnector: ConnectorAdapter = {
  manifest: SUPABASE_MANIFEST,

  async introspect(
    config: Record<string, string>,
    credentials: ConnectorCredentials,
    fetchImpl: typeof fetch = fetch,
  ): Promise<IntrospectionResult> {
    const key = credentials.SUPABASE_ANON_KEY || credentials.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) throw new ConnectorError('An anon key or service role key is required.');

    const endpoint = restUrl(config);

    let response: Response;
    try {
      response = await fetchImpl(endpoint, {
        headers: { apikey: key, authorization: `Bearer ${key}`, accept: 'application/json' },
      });
    } catch (error) {
      throw new ConnectorError(`Could not reach ${endpoint}: ${(error as Error).message}`);
    }

    if (response.status === 401 || response.status === 403) {
      throw new ConnectorError('The project rejected that key.');
    }
    if (!response.ok) {
      throw new ConnectorError(`The project answered ${response.status} for ${endpoint}.`);
    }

    let document: OpenApiDocument;
    try {
      document = (await response.json()) as OpenApiDocument;
    } catch {
      throw new ConnectorError('The project did not return JSON. Check the project URL.');
    }

    const tables = parseOpenApi(document);
    if (tables.length === 0) {
      throw new ConnectorError(
        'Connected, but no tables are exposed to this key. Check the schema and its permissions.',
      );
    }

    return { tables, introspectedAt: new Date().toISOString() };
  },
};
