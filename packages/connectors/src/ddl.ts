import type { TypeRef } from '@loom/ir';
import { ConnectorError, type ColumnSchema, type TableSchema } from './module';

/**
 * Schema authoring (`docs/15-schema.md`).
 *
 * DDL cannot take parameters — a table name is not a placeholder — so this is the second place in
 * loom where typed text becomes part of a statement, and it is fenced the same way the aggregate
 * function name is: identifiers are checked against a pattern and then quoted, types come from a
 * closed map, and a default value is checked against its own column's type before it is written.
 *
 * Nothing here ever reaches the emitted app. A schema change is a design-time act performed by
 * the studio through its dev server; the repo the user owns gets migrations, never a `CREATE
 * TABLE` that runs on request.
 */

/** The types a designer can give a column, in the words the panel uses. */
export const COLUMN_TYPES = {
  text: { label: 'Text', sql: 'text', kind: 'text' },
  wholeNumber: { label: 'Number (whole)', sql: 'integer', kind: 'number' },
  decimal: { label: 'Number (decimal)', sql: 'double precision', kind: 'number' },
  boolean: { label: 'Yes / no', sql: 'boolean', kind: 'boolean' },
  timestamp: { label: 'Date and time', sql: 'timestamptz', kind: 'date' },
  structured: { label: 'Structured', sql: 'jsonb', kind: 'record' },
} as const satisfies Record<string, { label: string; sql: string; kind: TypeRef['kind'] }>;

export type ColumnType = keyof typeof COLUMN_TYPES;

/**
 * Why `integer` and `double precision` rather than `bigint` and `numeric`.
 *
 * node-postgres hands both of those back as **strings**, to avoid losing precision JavaScript
 * cannot hold (verified in `pg-types`: int8 is parsed by `parseBigInteger`, which returns the
 * string, and numeric has no parser registered at all). A key typed `bigserial` would therefore
 * arrive as text and type every port downstream as text — a mismatch that surfaces three screens
 * later as a comparison that never matches.
 */
export const NUMBER_NOTE =
  'Whole numbers are stored as integer and decimals as double precision, because those are the ' +
  'two the database driver hands back as numbers rather than as text.';

/** How a new table identifies its rows. */
export const KEY_STYLES = {
  uuid: {
    label: 'Random id',
    sql: 'uuid',
    default: 'gen_random_uuid()',
    kind: 'text' as const,
  },
  counter: {
    label: 'Counting number',
    sql: 'integer',
    default: undefined,
    kind: 'number' as const,
  },
} as const;

export type KeyStyle = keyof typeof KEY_STYLES;

export interface ColumnSpec {
  name: string;
  type: ColumnType;
  /** A row cannot be written without it. */
  required?: boolean;
  /** No two rows may share it. */
  unique?: boolean;
  /** What the database writes when nothing is supplied. Checked against the type. */
  defaultValue?: string;
}

export interface TableSpec {
  name: string;
  key: KeyStyle;
  /** The columns beyond the key, in the order they were added. */
  columns: ColumnSpec[];
}

/**
 * An identifier, checked and quoted.
 *
 * The pattern is the same one emission uses, deliberately: a name loom cannot address later is a
 * name loom should refuse to create now, rather than making a column that only a database console
 * can ever reach.
 */
export function identifier(name: string): string {
  const value = name.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new ConnectorError(
      `"${name}" cannot be used as a name. Start with a letter, and use letters, numbers and ` +
        `underscores — no spaces, dashes or punctuation.`,
    );
  }
  if (value.length > 63) {
    // Postgres truncates at 63 bytes, and a silently truncated name is a name that does not
    // match what the panel shows.
    throw new ConnectorError(`"${name}" is too long. Names stop at 63 characters.`);
  }
  return `"${value}"`;
}

/** A quoted string literal — the doubling is what keeps a quote inside a default from ending it. */
const quoted = (value: string): string => `'${value.split("'").join("''")}'`;

/**
 * A default value, written as a literal of its column's type.
 *
 * This is the only value in loom that is not a parameter, because a default is part of the
 * table's definition rather than part of a query. So it is checked *as its type* first: a number
 * has to parse as one, a yes/no has to be one of two words, structured data has to be JSON.
 */
export function literal(type: ColumnType, raw: string): string {
  const value = raw.trim();
  if (!value) throw new ConnectorError('A default needs a value, or no default at all.');

  if (type === 'wholeNumber' || type === 'decimal') {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      throw new ConnectorError(`"${raw}" is not a number, so it cannot be a number's default.`);
    }
    if (type === 'wholeNumber' && !Number.isInteger(number)) {
      throw new ConnectorError(`"${raw}" is not a whole number.`);
    }
    return String(number);
  }

  if (type === 'boolean') {
    const lowered = value.toLowerCase();
    if (lowered !== 'true' && lowered !== 'false') {
      throw new ConnectorError('A yes/no column defaults to true or false.');
    }
    return lowered;
  }

  if (type === 'timestamp') {
    // "Now" is the default anyone actually wants; anything else has to be a real moment.
    if (/^(now|now\(\)|current_timestamp)$/i.test(value)) return 'now()';
    if (Number.isNaN(Date.parse(value))) {
      throw new ConnectorError(
        `"${raw}" is not a date loom can read. Write "now", or a date like 2026-01-31.`,
      );
    }
    return `${quoted(value)}::timestamptz`;
  }

  if (type === 'structured') {
    try {
      JSON.parse(value);
    } catch {
      throw new ConnectorError(`"${raw}" is not valid JSON.`);
    }
    return `${quoted(value)}::jsonb`;
  }

  return quoted(value);
}

/** The definition of one column, as it appears inside a CREATE or an ADD COLUMN. */
function columnDefinition(column: ColumnSpec): string {
  const parts = [identifier(column.name), COLUMN_TYPES[column.type].sql];

  if (column.defaultValue !== undefined && column.defaultValue !== '') {
    parts.push(`default ${literal(column.type, column.defaultValue)}`);
  }
  if (column.required) parts.push('not null');
  if (column.unique) parts.push('unique');

  return parts.join(' ');
}

/**
 * Every change the panel can make.
 *
 * A typed description rather than a statement, so the thing crossing the wire to the dev server
 * is something that can be checked rather than something that has to be trusted.
 */
export type SchemaChange =
  | { kind: 'createTable'; table: TableSpec }
  | { kind: 'addColumn'; table: string; column: ColumnSpec }
  | { kind: 'renameColumn'; table: string; from: string; to: string }
  | { kind: 'retypeColumn'; table: string; column: string; to: ColumnType }
  | { kind: 'setRequired'; table: string; column: string; required: boolean }
  | { kind: 'setDefault'; table: string; column: string; type: ColumnType; value?: string }
  | { kind: 'setUnique'; table: string; column: string; unique: boolean }
  | { kind: 'renameTable'; from: string; to: string }
  | { kind: 'dropColumn'; table: string; column: string }
  | { kind: 'dropTable'; table: string };

/** True when applying this change destroys data that is already there. */
export function isDestructive(change: SchemaChange): boolean {
  return change.kind === 'dropColumn' || change.kind === 'dropTable';
}

/** What a destructive change asks the designer to type, so a mis-click cannot do it. */
export function confirmationFor(change: SchemaChange): string | undefined {
  if (change.kind === 'dropColumn') return change.column;
  if (change.kind === 'dropTable') return change.table;
  return undefined;
}

/** The name of the constraint that keeps a column unique — Postgres's own convention. */
const uniqueConstraint = (table: string, column: string): string =>
  identifier(`${table}_${column}_key`);

/**
 * The statements one change becomes.
 *
 * A list rather than one string, because some changes are two statements and because sending them
 * separately keeps the endpoint able to refuse anything that is not a single statement.
 */
export function planChange(change: SchemaChange): string[] {
  switch (change.kind) {
    case 'createTable': {
      const key = KEY_STYLES[change.table.key];
      if (!key) throw new ConnectorError('A new table needs a way to identify its rows.');

      const identity =
        change.table.key === 'counter'
          ? `"id" integer primary key generated always as identity`
          : `"id" ${key.sql} primary key default ${key.default}`;

      const columns = [identity, ...change.table.columns.map(columnDefinition)];
      return [`create table ${identifier(change.table.name)} (${columns.join(', ')})`];
    }

    case 'addColumn':
      return [
        `alter table ${identifier(change.table)} add column ${columnDefinition(change.column)}`,
      ];

    case 'renameColumn':
      return [
        `alter table ${identifier(change.table)} rename column ${identifier(change.from)} to ${identifier(change.to)}`,
      ];

    case 'retypeColumn':
      // The cast is explicit: without `using`, Postgres refuses anything but a widening, and with
      // it the database is the one that decides whether the values actually convert.
      return [
        `alter table ${identifier(change.table)} alter column ${identifier(change.column)} ` +
          `type ${COLUMN_TYPES[change.to].sql} using ${identifier(change.column)}::${COLUMN_TYPES[change.to].sql}`,
      ];

    case 'setRequired':
      return [
        `alter table ${identifier(change.table)} alter column ${identifier(change.column)} ` +
          `${change.required ? 'set not null' : 'drop not null'}`,
      ];

    case 'setDefault':
      return [
        change.value === undefined || change.value === ''
          ? `alter table ${identifier(change.table)} alter column ${identifier(change.column)} drop default`
          : `alter table ${identifier(change.table)} alter column ${identifier(change.column)} ` +
            `set default ${literal(change.type, change.value)}`,
      ];

    case 'setUnique':
      return [
        change.unique
          ? `alter table ${identifier(change.table)} add constraint ` +
            `${uniqueConstraint(change.table, change.column)} unique (${identifier(change.column)})`
          : `alter table ${identifier(change.table)} drop constraint ` +
            `${uniqueConstraint(change.table, change.column)}`,
      ];

    case 'renameTable':
      return [`alter table ${identifier(change.from)} rename to ${identifier(change.to)}`];

    case 'dropColumn':
      return [`alter table ${identifier(change.table)} drop column ${identifier(change.column)}`];

    case 'dropTable':
      // No `cascade`: a table something else depends on should fail loudly rather than take the
      // dependent thing with it.
      return [`drop table ${identifier(change.table)}`];
  }
}

/**
 * What the dev server will run, checked again at the far end.
 *
 * The statements are built in the browser, so the endpoint that runs them does not get to assume
 * they were built by this file. One statement, one recognised verb, no trailing second statement
 * smuggled in behind a semicolon.
 */
export const DDL_VERBS = ['create table', 'alter table', 'drop table', 'create index', 'drop index'];

export function checkStatement(statement: string): void {
  const text = statement.trim();
  if (!DDL_VERBS.some((verb) => text.toLowerCase().startsWith(verb))) {
    throw new ConnectorError('That is not a schema change loom knows how to make.');
  }
  // A semicolon inside a quoted default is fine; one that ends this statement is not.
  const withoutLiterals = text.replace(/'(?:[^']|'')*'/g, "''");
  if (withoutLiterals.includes(';')) {
    throw new ConnectorError('A schema change is one statement.');
  }
}

/** What a table looks like to the rest of loom once a change lands, before a re-read confirms it. */
export function columnFromSpec(column: ColumnSpec): ColumnSchema {
  return {
    name: column.name,
    type: { kind: COLUMN_TYPES[column.type].kind } as TypeRef,
    required: Boolean(column.required) && !column.defaultValue,
    primaryKey: false,
    generated: Boolean(column.defaultValue),
  };
}

/** The loom type a column type carries, for a shape loom keeps itself (Firestore). */
export function typeOfColumn(type: ColumnType): TypeRef {
  return { kind: COLUMN_TYPES[type].kind } as TypeRef;
}

/** An empty table, as the panel starts it. */
export function blankTable(name = ''): TableSpec {
  return { name, key: 'uuid', columns: [] };
}

/** True when this table already has a column by that name — the check the panel makes first. */
export function hasColumn(table: TableSchema | undefined, name: string): boolean {
  return Boolean(table?.columns.some((column) => column.name === name.trim()));
}
