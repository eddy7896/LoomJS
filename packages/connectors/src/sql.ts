import type { TypeRef } from '@loom/ir';
import { ConnectorError, type ColumnSchema, type ModuleManifest, type TableSchema } from './module';

/**
 * The SQL connectors — Postgres and MySQL (`docs/specs/connector-credentials.md`).
 *
 * These are the same shape as Supabase from the graph's point of view: tables with typed columns,
 * a primary key, and the four operations. What differs is only how the app *reaches* them, and
 * that difference lives in the compiler's emission, not in the vocabulary a designer works with.
 *
 * **A connection string is a credential**, and a whole one: it carries the password in the middle
 * of it. So it is named, never stored, and never leaves the server — the same rule the service
 * role key follows, and the reason introspection runs on loom's dev server rather than in the
 * browser, which could not open a database socket anyway.
 */

export const POSTGRES_MANIFEST: ModuleManifest = {
  id: 'postgres',
  label: 'Postgres',
  kind: 'connector',
  config: [
    {
      key: 'schema',
      label: 'Schema',
      placeholder: 'public',
    },
  ],
  credentials: [
    {
      name: 'DATABASE_URL',
      label: 'Connection string',
      scope: 'server',
      // Verified against Vercel's and Neon's guidance: a function that opens a direct connection
      // per invocation exhausts a database's connection limit under any real traffic.
      hint: 'Use the pooled connection string (Supavisor, PgBouncer or Neon), not the direct one.',
    },
  ],
};

export const MYSQL_MANIFEST: ModuleManifest = {
  id: 'mysql',
  label: 'MySQL',
  kind: 'connector',
  config: [{ key: 'schema', label: 'Database', placeholder: 'app' }],
  credentials: [
    {
      name: 'DATABASE_URL',
      label: 'Connection string',
      scope: 'server',
      hint: 'mysql://user:password@host:3306/database — a pooled endpoint where one exists.',
    },
  ],
};

/**
 * Postgres and MySQL both describe themselves in `information_schema`, in nearly the same words.
 * One query, one parser, two dialects — the differences are the quoting and the type names.
 */
export const INTROSPECT_SQL = {
  postgres: `
    SELECT c.table_name, c.column_name, c.data_type, c.is_nullable, c.column_default,
           (pk.column_name IS NOT NULL) AS is_primary
    FROM information_schema.columns c
    LEFT JOIN (
      SELECT kcu.table_name, kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = $1
    ) pk ON pk.table_name = c.table_name AND pk.column_name = c.column_name
    WHERE c.table_schema = $1
    ORDER BY c.table_name, c.ordinal_position
  `,
  mysql: `
    SELECT table_name, column_name, data_type, is_nullable, column_default,
           (column_key = 'PRI') AS is_primary
    FROM information_schema.columns
    WHERE table_schema = ?
    ORDER BY table_name, ordinal_position
  `,
} as const;

/**
 * What else a schema knows about its columns: what points where, and what is indexed (D6).
 *
 * Separate queries rather than more joins on the first: a column that is both a foreign key and
 * part of two indexes would multiply the rows of the main query, and a schema read that reports a
 * column three times is worse than one that runs three statements.
 */
export const INTROSPECT_RELATIONS = {
  postgres: `
    SELECT tc.table_name, kcu.column_name,
           ccu.table_name AS target_table, ccu.column_name AS target_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1
  `,
  mysql: `
    SELECT table_name, column_name,
           referenced_table_name AS target_table, referenced_column_name AS target_column
    FROM information_schema.key_column_usage
    WHERE table_schema = ? AND referenced_table_name IS NOT NULL
  `,
} as const;

/**
 * Indexes, and whether each one keeps its column unique.
 *
 * Only the **first** column of an index is reported. An index on (a, b) does not help a query
 * that filters on b alone, so calling b indexed would be telling a designer their search is fast
 * when it is not.
 */
export const INTROSPECT_INDEXES = {
  postgres: `
    SELECT t.relname AS table_name, a.attname AS column_name, ix.indisunique AS is_unique
    FROM pg_class t
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_index ix ON t.oid = ix.indrelid
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ix.indkey[0]
    WHERE n.nspname = $1 AND t.relkind = 'r'
  `,
  mysql: `
    SELECT table_name, column_name, (non_unique = 0) AS is_unique
    FROM information_schema.statistics
    WHERE table_schema = ? AND seq_in_index = 1
  `,
} as const;

/** A foreign key, as the query above reports it. */
export interface RelationRow {
  table_name?: string;
  column_name?: string;
  target_table?: string;
  target_column?: string;
}

/** An index, as the query above reports it. */
export interface IndexRow {
  table_name?: string;
  column_name?: string;
  is_unique?: boolean | number | string;
}

/** One row of the query above, however the driver spells its column names. */
export interface ColumnRow {
  table_name?: string;
  column_name?: string;
  data_type?: string;
  is_nullable?: string;
  column_default?: unknown;
  is_primary?: boolean | number | string;
}

/**
 * SQL type -> loom's visible vocabulary (`docs/specs/type-registry.md`).
 *
 * Anything unlisted becomes `unknown`, which is inert until someone narrows it — the same choice
 * the Supabase parser makes, and for the same reason: a plausible guess that type-checks and then
 * fails at runtime is worse than a type that admits it does not know.
 */
const SQL_TYPES: Record<string, TypeRef['kind']> = {
  // Postgres
  text: 'text',
  'character varying': 'text',
  character: 'text',
  uuid: 'text',
  name: 'text',
  citext: 'text',
  smallint: 'number',
  integer: 'number',
  bigint: 'number',
  numeric: 'number',
  decimal: 'number',
  real: 'number',
  'double precision': 'number',
  boolean: 'boolean',
  date: 'date',
  'timestamp with time zone': 'date',
  'timestamp without time zone': 'date',
  json: 'record',
  jsonb: 'record',
  // MySQL
  varchar: 'text',
  char: 'text',
  tinytext: 'text',
  mediumtext: 'text',
  longtext: 'text',
  int: 'number',
  tinyint: 'number',
  mediumint: 'number',
  float: 'number',
  double: 'number',
  datetime: 'date',
  timestamp: 'date',
};

export function sqlColumnType(dataType: string): TypeRef {
  const kind = SQL_TYPES[dataType.toLowerCase().trim()];
  return kind ? ({ kind } as TypeRef) : { kind: 'unknown' };
}

const truthy = (value: unknown): boolean =>
  value === true || value === 1 || value === '1' || value === 't' || value === 'YES';

/** The rows of `INTROSPECT_SQL`, gathered into the tables a designer sees. */
export function parseColumnRows(
  rows: readonly ColumnRow[],
  relations: readonly RelationRow[] = [],
  indexes: readonly IndexRow[] = [],
): TableSchema[] {
  if (rows.length === 0) {
    throw new ConnectorError(
      'Connected, but that schema holds no tables this user can see. Check the schema name and its grants.',
    );
  }

  const tables = new Map<string, ColumnSchema[]>();

  for (const row of rows) {
    const table = String(row.table_name ?? '').trim();
    const name = String(row.column_name ?? '').trim();
    if (!table || !name) continue;

    // A column the database fills in — a default, or an identity/serial key — is never asked for
    // on insert. That is the same rule as everywhere else: do not make someone type an id.
    const generated =
      row.column_default !== null && row.column_default !== undefined && row.column_default !== '';

    const column: ColumnSchema = {
      name,
      type: sqlColumnType(String(row.data_type ?? '')),
      required: String(row.is_nullable ?? 'YES').toUpperCase() === 'NO' && !generated,
      primaryKey: truthy(row.is_primary),
      generated,
    };

    const existing = tables.get(table);
    if (existing) existing.push(column);
    else tables.set(table, [column]);
  }

  // What points where, and what is indexed. Both are facts about a column that a designer needs
  // before they can be asked to choose one — a relation makes a picker possible, and an index is
  // the difference between a search and a table scan.
  const at = (row: { table_name?: string; column_name?: string }): string =>
    `${String(row.table_name ?? '')}.${String(row.column_name ?? '')}`;

  const pointsAt = new Map<string, { table: string; column: string }>();
  for (const relation of relations) {
    const target = String(relation.target_table ?? '');
    const column = String(relation.target_column ?? '');
    if (target && column) pointsAt.set(at(relation), { table: target, column });
  }

  const indexed = new Set<string>();
  const uniques = new Set<string>();
  for (const index of indexes) {
    indexed.add(at(index));
    if (truthy(index.is_unique)) uniques.add(at(index));
  }

  return [...tables]
    .map(([name, columns]) => ({
      name,
      columns: columns.map((column) => {
        const key = `${name}.${column.name}`;
        const reference = pointsAt.get(key);
        return {
          ...column,
          ...(reference ? { references: reference } : {}),
          ...(indexed.has(key) ? { indexed: true } : {}),
          ...(uniques.has(key) && !column.primaryKey ? { unique: true } : {}),
        };
      }),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** What a connection string has to look like before it is worth opening a socket for. */
export function checkConnectionString(url: string, dialect: 'postgres' | 'mysql'): void {
  const value = url.trim();
  if (!value) throw new ConnectorError('A connection string is required.');

  const prefixes =
    dialect === 'postgres' ? ['postgres://', 'postgresql://'] : ['mysql://', 'mariadb://'];
  if (!prefixes.some((prefix) => value.toLowerCase().startsWith(prefix))) {
    throw new ConnectorError(`A ${dialect} connection string starts with ${prefixes[0]}.`);
  }
}
