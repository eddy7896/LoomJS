import type { Node, Port, TypeRef } from '@loom/ir';
import type { TableSchema } from './module';

/**
 * Typed per-table nodes — the differentiating half of M4. A DB node's ports are the table's real
 * columns with their real types, baked into the document at creation time from the cached
 * introspection, so the compiler and the canvas never need a live connection
 * (`docs/specs/connector-credentials.md`).
 */

export interface DbNodeConfig {
  connectorId: string;
  table: string;
  /** `select` reads rows; `insert` writes one. */
  operation: 'select' | 'insert';
  /** Read options (`docs/06-glossary.md`: Query = read with filter/sort/limit). */
  limit?: number;
  orderBy?: string;
  descending?: boolean;
}

/**
 * The inspector fields a database node shows. A read is a **query**, so how many rows and in what
 * order are part of it — that is also loom's answer to "where is the loop": you narrow the query
 * and a List renders one row at a time (`04-hallucination-check.md`: loops are never nodes).
 */
export function dbNodeFields(operation: DbNodeConfig['operation']): readonly {
  key: string;
  label: string;
  control: 'text' | 'number' | 'boolean';
  default: string | number | boolean;
}[] {
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

export function dbNodePorts(table: TableSchema, operation: DbNodeConfig['operation']): Port[] {
  if (operation === 'select') {
    // A select yields rows; per-column typing shows up when a row is read downstream.
    return [
      port('pt_rows', 'rows', 'out', { kind: 'list', of: { kind: 'record' } }),
      port('pt_count', 'count', 'out', { kind: 'number' }),
    ];
  }

  // An insert takes one input per writable column, typed exactly as the column is.
  const inputs = table.columns
    .filter((column) => !column.generated)
    .map((column) =>
      port(
        columnPortId(column.name),
        column.name,
        'in',
        // A nullable column accepts a value or nothing; a required one does not.
        column.required ? column.type : { kind: 'optional', of: column.type },
      ),
    );

  return [...inputs, port('pt_row', 'row', 'out', { kind: 'record' })];
}

export function createDbNode(
  id: string,
  position: { x: number; y: number },
  connectorId: string,
  table: TableSchema,
  operation: DbNodeConfig['operation'],
): Node {
  const config: DbNodeConfig = { connectorId, table: table.name, operation };
  return {
    id,
    category: 'db',
    kind: operation,
    name: `${operation === 'select' ? 'Read' : 'Insert'} ${table.name}`,
    ports: dbNodePorts(table, operation),
    position,
    config,
  };
}

/** Columns a designer must supply for an insert to be valid. */
export function requiredColumns(table: TableSchema): string[] {
  return table.columns.filter((column) => column.required && !column.generated).map((c) => c.name);
}
