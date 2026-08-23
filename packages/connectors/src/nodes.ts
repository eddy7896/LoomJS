import type { Node, Port, TypeRef } from '@loom/ir';
import type { ColumnSchema, TableSchema } from './module';

/**
 * Typed per-table nodes — the differentiating half of M4. A DB node's ports are the table's real
 * columns with their real types, baked into the document at creation time from the cached
 * introspection, so the compiler and the canvas never need a live connection
 * (`docs/specs/connector-credentials.md`).
 */

/**
 * The four things you can do to a table (P4). `update` and `delete` need a **row identity**, which
 * is the primary key from introspection — not a concept a designer has to supply.
 */
export type DbOperation =
  | 'select'
  | 'insert'
  | 'update'
  | 'delete'
  | 'count'
  | 'upsert'
  | 'aggregate';

/**
 * The three operations added in D3, and why each one is a node rather than a query someone writes.
 *
 * `count` because "how many" is a number on a screen, and getting it by reading every row and
 * measuring the list is both slow and wrong past the limit. `upsert` because "save this" is one
 * button whether or not the row exists, and doing it as read-then-branch-then-write is three
 * nodes and a race. `aggregate` because a total is the other number that ends up on a screen.
 */
export const AGGREGATE_FNS = ['sum', 'avg', 'min', 'max'] as const;
export type AggregateFn = (typeof AGGREGATE_FNS)[number];

/**
 * How a filter's comparison value arrives.
 *
 * `value` is a literal chosen in the inspector — "status is open". `input` makes the comparison an
 * **input port** on the node, so it becomes a route input the browser supplies at call time; that
 * is what a search box is, and it is why search needs no separate machinery.
 */
export type FilterSource = 'value' | 'input';

export const FILTER_OPS = {
  equals: { label: 'is', postgrest: 'eq' },
  notEquals: { label: 'is not', postgrest: 'neq' },
  greaterThan: { label: 'is more than', postgrest: 'gt' },
  lessThan: { label: 'is less than', postgrest: 'lt' },
  contains: { label: 'contains', postgrest: 'ilike' },
} as const satisfies Record<string, { label: string; postgrest: string }>;

export type FilterOp = keyof typeof FILTER_OPS;

export interface DbFilter {
  column: string;
  operator: FilterOp;
  source: FilterSource;
  /** Used when `source` is `value`. */
  value?: string;
}

export interface DbNodeConfig {
  connectorId: string;
  table: string;
  operation: DbOperation;
  /** Read options (`docs/06-glossary.md`: Query = read with filter/sort/limit). */
  limit?: number;
  orderBy?: string;
  descending?: boolean;
  /** Narrowing on a read. Empty means every row the limit allows. */
  filters?: DbFilter[];
  /** Aggregate options: which column, and what to do to it. */
  column?: string;
  fn?: AggregateFn;
}

/** The column that identifies a row. Update and delete are impossible without one. */
export function primaryKeyOf(table: TableSchema): ColumnSchema | undefined {
  return table.columns.find((column) => column.primaryKey);
}

/** The port a filter's comparison value arrives on, when it is supplied at call time. */
export const filterPortId = (column: string): string => `pt_where_${column}`;

/** The port carrying the row identity for an update or a delete. */
export const ID_PORT = 'pt_id';

/**
 * The inspector fields a database node shows. A read is a **query**, so how many rows and in what
 * order are part of it — that is also loom's answer to "where is the loop": you narrow the query
 * and a List renders one row at a time (`04-hallucination-check.md`: loops are never nodes).
 */
export function dbNodeFields(
  operation: DbOperation,
  table?: TableSchema,
): readonly {
  key: string;
  label: string;
  control: 'text' | 'number' | 'boolean' | 'select';
  default: string | number | boolean;
  options?: readonly string[];
}[] {
  if (operation === 'aggregate') {
    // Only the columns worth doing arithmetic to: offering `sum` on a name is an error the
    // database would report at run time, from a dropdown that suggested it.
    const numeric = (table?.columns ?? [])
      .filter((column) => column.type.kind === 'number')
      .map((column) => column.name);
    return [
      { key: 'fn', label: 'Function', control: 'select', default: 'sum', options: AGGREGATE_FNS },
      {
        key: 'column',
        label: 'Column',
        control: 'select',
        default: numeric[0] ?? '',
        options: numeric,
      },
    ];
  }

  if (operation !== 'select') return [];
  return [
    { key: 'limit', label: 'Limit', control: 'number', default: 100 },
    { key: 'orderBy', label: 'Sort by', control: 'text', default: '' },
    { key: 'descending', label: 'Newest first', control: 'boolean', default: false },
  ];
}

const port = (
  id: string,
  name: string,
  direction: Port['direction'],
  type: TypeRef,
): Port => ({ id, name, direction, portKind: 'data', type });

/** The column id used for a port, kept stable so wires survive a re-introspect. */
export const columnPortId = (column: string): string => `pt_col_${column}`;

/** One input per writable column, typed exactly as the column is. */
function columnInputs(table: TableSchema, allOptional: boolean): Port[] {
  return table.columns
    .filter((column) => !column.generated)
    .map((column) =>
      port(
        columnPortId(column.name),
        column.name,
        'in',
        // A nullable column accepts a value or nothing; a required one does not. On an update
        // *everything* is optional: changing one field is the common case, and demanding the rest
        // would make an edit form re-send data it never showed.
        !allOptional && column.required ? column.type : { kind: 'optional', of: column.type },
      ),
    );
}

export function dbNodePorts(
  table: TableSchema,
  operation: DbOperation,
  filters: readonly DbFilter[] = [],
): Port[] {
  /** A filter supplied at call time is a port here, and a route input one level up. */
  const supplied = (): Port[] =>
    filters
      .filter((filter) => filter.source === 'input')
      .map((filter) => {
        const column = table.columns.find((candidate) => candidate.name === filter.column);
        return port(filterPortId(filter.column), filter.column, 'in', {
          kind: 'optional',
          of: column?.type ?? { kind: 'text' },
        });
      });

  if (operation === 'count') {
    return [...supplied(), port('pt_count', 'count', 'out', { kind: 'number' })];
  }

  if (operation === 'aggregate') {
    // Optional, because a total over no rows is not zero — `min` of nothing has no answer, and
    // answering 0 would be a number on a screen that means something else.
    return [
      ...supplied(),
      port('pt_value', 'value', 'out', { kind: 'optional', of: { kind: 'number' } }),
    ];
  }

  if (operation === 'select') {
    // A select yields rows; per-column typing shows up when a row is read downstream.
    return [
      ...supplied(),
      port('pt_rows', 'rows', 'out', { kind: 'list', of: { kind: 'record' } }),
      port('pt_count', 'count', 'out', { kind: 'number' }),
    ];
  }

  const key = primaryKeyOf(table);
  const identity =
    operation === 'update' || operation === 'delete'
      ? [port(ID_PORT, key?.name ?? 'id', 'in', key?.type ?? { kind: 'text' })]
      : // An upsert takes the key as a *column*: supplied, it decides which row is written;
        // left out, the database makes one, and the same node covers both.
        operation === 'upsert' && key
        ? [port(columnPortId(key.name), key.name, 'in', { kind: 'optional', of: key.type })]
        : [];

  if (operation === 'delete') {
    return [...identity, port('pt_row', 'row', 'out', { kind: 'record' })];
  }

  return [
    ...identity,
    ...columnInputs(table, operation === 'update' || operation === 'upsert'),
    port('pt_row', 'row', 'out', { kind: 'record' }),
  ];
}

const OPERATION_LABELS: Record<DbOperation, string> = {
  select: 'Read',
  insert: 'Insert',
  update: 'Update',
  delete: 'Delete',
  count: 'Count',
  upsert: 'Save',
  aggregate: 'Total',
};

/**
 * A statement the designer wrote themselves (`docs/13-inspector.md`).
 *
 * The escape hatch for data, and the same bargain the Code node makes for logic: the vocabulary
 * stays small because there is a way out of it. A query names its inputs with `:name`, and every
 * one of them travels as a **parameter** — a builder that pasted a typed value into SQL would be
 * shipping an injection to everyone who used it.
 *
 * Only SQL connectors offer it. Supabase is reached over HTTP through PostgREST, which has no
 * statement to run, and pretending otherwise would be a node that compiles for one connection and
 * refuses for another with no way to see why in advance.
 */
export interface QueryNodeConfig {
  connectorId: string;
  sql: string;
  /** Whether the step yields the rows or the first of them. */
  returns?: 'many' | 'one';
}

/** The `:names` a statement asks for, in the order they first appear. */
export function queryParamNames(sql: string): string[] {
  const names: string[] = [];
  for (const match of sql.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)) {
    if (!names.includes(match[1]!)) names.push(match[1]!);
  }
  return names;
}

/** A query's ports: one input per name it asks for, and the rows it answers with. */
export function queryNodePorts(sql: string): Port[] {
  return [
    ...queryParamNames(sql).map((name) => port(`pt_p_${name}`, name, 'in', { kind: 'any' })),
    port('pt_result', 'rows', 'out', { kind: 'list', of: { kind: 'record' } }),
  ];
}

export function createQueryNode(
  id: string,
  position: { x: number; y: number },
  connectorId: string,
): Node {
  const config: QueryNodeConfig = { connectorId, sql: 'SELECT * FROM ', returns: 'many' };
  return {
    id,
    category: 'db',
    kind: 'query',
    name: 'Query',
    ports: queryNodePorts(config.sql),
    position,
    config,
  };
}

export function createDbNode(
  id: string,
  position: { x: number; y: number },
  connectorId: string,
  table: TableSchema,
  operation: DbOperation,
): Node {
  const config: DbNodeConfig = { connectorId, table: table.name, operation, filters: [] };
  return {
    id,
    category: 'db',
    kind: operation,
    name: `${OPERATION_LABELS[operation]} ${table.name}`,
    ports: dbNodePorts(table, operation, config.filters),
    position,
    config,
  };
}

/** Columns a designer must supply for an insert to be valid. */
export function requiredColumns(table: TableSchema): string[] {
  return table.columns.filter((column) => column.required && !column.generated).map((c) => c.name);
}
