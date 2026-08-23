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
  | { kind: 'dropTable'; table: string }
  | {
      kind: 'addRelation';
      table: string;
      column: string;
      target: string;
      targetColumn: string;
      onDelete: OnDelete;
    }
  | { kind: 'dropRelation'; table: string; column: string }
  | { kind: 'addIndex'; table: string; column: string }
  | { kind: 'dropIndex'; table: string; column: string };

/**
 * What happens to this row when the row it points at is deleted.
 *
 * There is no safe default, so the choice is made explicitly and in words: `restrict` refuses the
 * delete while anything still points at it, `cascade` deletes this row too, and `setNull` leaves
 * the row and forgets what it pointed at.
 */
export const ON_DELETE = {
  restrict: { label: "Don't allow it", sql: 'restrict' },
  cascade: { label: 'Delete this row too', sql: 'cascade' },
  setNull: { label: 'Leave it, and forget the link', sql: 'set null' },
} as const;

export type OnDelete = keyof typeof ON_DELETE;

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

/**
 * Constraint and index names, following Postgres's own conventions.
 *
 * Built rather than looked up, so dropping one finds the same name that creating it used. A
 * relation or index made by hand under a different name is not one this panel can remove — which
 * is why the error a drop returns is the database's own, rather than a claim that it worked.
 */
const uniqueConstraint = (table: string, column: string): string =>
  identifier(`${table}_${column}_key`);

const foreignKeyConstraint = (table: string, column: string): string =>
  identifier(`${table}_${column}_fkey`);

const indexName = (table: string, column: string): string => identifier(`${table}_${column}_idx`);

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

    case 'addRelation': {
      const rule = ON_DELETE[change.onDelete];
      if (!rule) throw new ConnectorError('A relation needs to say what a delete does.');
      return [
        `alter table ${identifier(change.table)} add constraint ` +
          `${foreignKeyConstraint(change.table, change.column)} foreign key (${identifier(change.column)}) ` +
          `references ${identifier(change.target)} (${identifier(change.targetColumn)}) ` +
          `on delete ${rule.sql}`,
      ];
    }

    case 'dropRelation':
      return [
        `alter table ${identifier(change.table)} drop constraint ` +
          `${foreignKeyConstraint(change.table, change.column)}`,
      ];

    case 'addIndex':
      return [
        `create index ${indexName(change.table, change.column)} ` +
          `on ${identifier(change.table)} (${identifier(change.column)})`,
      ];

    case 'dropIndex':
      return [`drop index ${indexName(change.table, change.column)}`];
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

/**
 * Whether these two columns can be linked at all.
 *
 * The database refuses a foreign key between mismatched types, and its message is about operator
 * classes. This is the same refusal in words a designer can act on, made before anything is sent.
 */
export function checkRelation(from: ColumnSchema, to: ColumnSchema): void {
  if (!to.primaryKey && !to.unique) {
    throw new ConnectorError(
      `A link has to point at a column that identifies one row. "${to.name}" is not the key of ` +
        `its table and is not unique, so more than one row could match.`,
    );
  }
  if (from.type.kind !== to.type.kind) {
    throw new ConnectorError(
      `"${from.name}" holds ${from.type.kind} and "${to.name}" holds ${to.type.kind}. A link has ` +
        `to hold the same kind of value as the key it points at.`,
    );
  }
}

/** True when this table already has a column by that name — the check the panel makes first. */
export function hasColumn(table: TableSchema | undefined, name: string): boolean {
  return Boolean(table?.columns.some((column) => column.name === name.trim()));
}

/**
 * What a change did, in the words the panel used.
 *
 * It becomes the migration's description and its filename, so someone reading the repo six months
 * later sees "add column body to notes" rather than a hash — and so a diff of the migrations
 * folder reads as a history of the design rather than of the database.
 */
export function describeChange(change: SchemaChange): string {
  switch (change.kind) {
    case 'createTable':
      return `create table ${change.table.name}`;
    case 'addColumn':
      return `add column ${change.column.name} to ${change.table}`;
    case 'renameColumn':
      return `rename ${change.table}.${change.from} to ${change.to}`;
    case 'retypeColumn':
      return `change ${change.table}.${change.column} to ${COLUMN_TYPES[change.to].label}`;
    case 'setRequired':
      return `${change.required ? 'require' : 'stop requiring'} ${change.table}.${change.column}`;
    case 'setDefault':
      return change.value
        ? `default ${change.table}.${change.column} to ${change.value}`
        : `remove the default on ${change.table}.${change.column}`;
    case 'setUnique':
      return `${change.unique ? 'require' : 'stop requiring'} unique ${change.table}.${change.column}`;
    case 'renameTable':
      return `rename table ${change.from} to ${change.to}`;
    case 'dropColumn':
      return `drop column ${change.column} from ${change.table}`;
    case 'dropTable':
      return `drop table ${change.table}`;
    case 'addRelation':
      return `link ${change.table}.${change.column} to ${change.target}`;
    case 'dropRelation':
      return `unlink ${change.table}.${change.column}`;
    case 'addIndex':
      return `index ${change.table}.${change.column}`;
    case 'dropIndex':
      return `remove the index on ${change.table}.${change.column}`;
  }
}

/**
 * Rows to put in a table so a screen has something to render (D7).
 *
 * A blank table makes every screen look broken while it is being designed, and typing five rows
 * by hand to find that out is worse. These are **parameterised** like every other value loom
 * sends: the statement carries placeholders, the values travel beside it.
 */
export function seedStatement(
  table: string,
  columns: readonly string[],
  rows: readonly Record<string, unknown>[],
): { text: string; values: unknown[] } {
  if (columns.length === 0) throw new ConnectorError('There is nothing to fill in.');
  if (rows.length === 0) throw new ConnectorError('There are no rows to add.');

  const values: unknown[] = [];
  const tuples = rows.map((row) => {
    const slots = columns.map((column) => {
      values.push(row[column] ?? null);
      return `$${values.length}`;
    });
    return `(${slots.join(', ')})`;
  });

  return {
    text:
      `insert into ${identifier(table)} (${columns.map(identifier).join(', ')}) ` +
      `values ${tuples.join(', ')}`,
    values,
  };
}

/**
 * A plausible row, from what the columns say they hold.
 *
 * Plausible rather than random: "Sample text 1" tells a designer which row they are looking at on
 * screen, where "x7fk2" tells them nothing. A generated column is skipped — the database is
 * already filling it in.
 */
export function sampleRow(columns: readonly ColumnSchema[], index: number): Record<string, unknown> {
  const row: Record<string, unknown> = {};

  for (const column of columns) {
    if (column.primaryKey || column.generated) continue;
    // A column pointing at another table needs a real key from it, which this cannot invent.
    if (column.references) continue;

    switch (column.type.kind) {
      case 'number':
        row[column.name] = index;
        break;
      case 'boolean':
        row[column.name] = index % 2 === 0;
        break;
      case 'date':
        row[column.name] = new Date().toISOString();
        break;
      case 'record':
      case 'list':
        row[column.name] = column.type.kind === 'list' ? [] : {};
        break;
      default:
        row[column.name] = `${column.name} ${index}`;
    }
  }

  return row;
}
