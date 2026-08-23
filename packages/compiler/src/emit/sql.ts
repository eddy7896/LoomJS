import { FILTER_OPS, type DbFilter, type DbNodeConfig, type FilterOp } from '@loom/connectors';
import type { Node } from '@loom/ir';
import { CompileError } from '../types';

/**
 * SQL emission (`docs/specs/connector-credentials.md`).
 *
 * A database node says the same thing whichever connector is under it — read these rows, insert
 * this one — and this turns that into a statement. Two dialects differ in almost nothing that
 * matters here: how a placeholder is written, and how a name is quoted.
 *
 * **Every value is a parameter.** Not one identifier or literal is pasted into the statement from
 * a designer's input, because a builder that concatenated a filter value into SQL would be
 * shipping an injection to everyone who used it. Table and column names come from the *cached
 * introspection*, never from typed text, and are checked against it before they are quoted.
 */

export type Dialect = 'postgres' | 'mysql';

/** `$1, $2, …` in Postgres; `?` in MySQL. */
export const placeholder = (dialect: Dialect, index: number): string =>
  dialect === 'postgres' ? `$${index}` : '?';

/**
 * An identifier, quoted for the dialect.
 *
 * It is checked first: anything that is not a plain name is a name that did not come from
 * introspection, and the compiler refuses rather than escaping it and hoping.
 */
export function quote(dialect: Dialect, name: string, node: Node): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new CompileError(
      `"${name}" is not a name this connector can address. Table and column names come from the ` +
        `schema loom read when you connected.`,
      node.id,
    );
  }
  return dialect === 'postgres' ? `"${name}"` : `\`${name}\``;
}

interface Query {
  /** The statement, with placeholders where values go. */
  text: string;
  /** The expressions, in order, that fill those placeholders. */
  values: string[];
}

/** The `WHERE` clauses of a read, and the values they compare against. */
function where(
  dialect: Dialect,
  node: Node,
  filters: readonly DbFilter[],
  from: number,
): { clauses: string[]; values: string[]; conditional: string[] } {
  const clauses: string[] = [];
  const values: string[] = [];
  const conditional: string[] = [];
  let index = from;

  for (const filter of filters) {
    const op = FILTER_OPS[filter.operator as FilterOp];
    if (!op) {
      throw new CompileError(
        `Filter on "${filter.column}" uses an unknown comparison "${filter.operator}".`,
        node.id,
      );
    }
    if (!filter.column) throw new CompileError('A filter has no column chosen.', node.id);

    const column = quote(dialect, filter.column, node);
    const compare = SQL_OPS[filter.operator as FilterOp];
    const slot = placeholder(dialect, index);

    if (filter.source === 'value') {
      const literal = String(filter.value ?? '');
      clauses.push(`${column} ${compare} ${slot}`);
      values.push(JSON.stringify(filter.operator === 'contains' ? `%${literal}%` : literal));
      index += 1;
      continue;
    }

    // Supplied at call time. An empty box narrows nothing rather than matching nothing, so the
    // clause itself is conditional — which is why a read builds its statement rather than
    // holding a constant one.
    const read = `input[${JSON.stringify(filter.column)}]`;
    conditional.push(
      `    if (${read} !== undefined && ${read} !== null && ${read} !== "") {\n` +
        `      clauses.push(\`${column} ${compare} \${slot(values.length + 1)}\`);\n` +
        `      values.push(${
          filter.operator === 'contains' ? `"%" + String(${read}) + "%"` : read
        });\n` +
        `    }`,
    );
  }

  return { clauses, values, conditional };
}

/** loom's comparisons, in SQL. `contains` is a case-insensitive wildcard in both dialects. */
const SQL_OPS: Record<FilterOp, string> = {
  equals: '=',
  notEquals: '<>',
  greaterThan: '>',
  lessThan: '<',
  contains: 'ILIKE',
};

/** The statement one database node runs, as lines of the emitted function's body. */
export function sqlStep(node: Node, dialect: Dialect, table: string, key: string): string {
  const config = (node.config ?? {}) as Partial<DbNodeConfig>;
  const name = quote(dialect, table, node);
  const id = quote(dialect, key, node);
  const contains = dialect === 'mysql' ? 'LIKE' : 'ILIKE';
  /**
   * A fragment of the statement, as a **JS string literal**.
   *
   * A quoted identifier carries the quote characters the emitted language also uses, so pasting
   * one into a double-quoted string closes it early — which is a file that does not compile
   * rather than a query that misbehaves, but only because the identifier was checked first.
   */
  const text = (fragment: string): string => JSON.stringify(fragment);

  if (config.operation === 'insert') {
    return `  {
    const row = (value ?? {}) as Record<string, unknown>;
    const columns = Object.keys(row).filter((column) => row[column] !== undefined);
    const statement =
      ${text(`INSERT INTO ${name} (`)} +
      columns.map((column) => quote(column)).join(", ") +
      ") VALUES (" +
      columns.map((_, index) => slot(index + 1)).join(", ") +
      ") RETURNING *";
    value = await one(statement, columns.map((column) => row[column]));
  }`;
  }

  if (config.operation === 'update') {
    return `  {
    const input = (value ?? {}) as Record<string, unknown>;
    const id = input[${JSON.stringify(key)}];
    if (id === undefined || id === null || id === "") {
      throw new Error("Update needs the row it is changing.");
    }
    // Undefined means "not shown on this form", which is different from "set it to null".
    const columns = Object.keys(input).filter(
      (column) => column !== ${JSON.stringify(key)} && input[column] !== undefined,
    );
    if (columns.length === 0) throw new Error("Update has nothing to change.");
    const statement =
      ${text(`UPDATE ${name} SET `)} +
      columns.map((column, index) => quote(column) + " = " + slot(index + 1)).join(", ") +
      ${text(` WHERE ${id} = `)} + slot(columns.length + 1) +
      " RETURNING *";
    value = await one(statement, [...columns.map((column) => input[column]), id]);
  }`;
  }

  if (config.operation === 'delete') {
    return `  {
    const input = (value ?? {}) as Record<string, unknown>;
    const id = input[${JSON.stringify(key)}];
    if (id === undefined || id === null || id === "") {
      throw new Error("Delete needs the row it is removing.");
    }
    value = await one(${text(`DELETE FROM ${name} WHERE ${id} = `)} + slot(1) + " RETURNING *", [id]);
  }`;
  }

  // A read: order, limit and whatever narrowing the designer wired.
  const filters = config.filters ?? [];
  const fixed = where(dialect, node, filters, 1);
  const limit = Number(config.limit ?? 100);
  const orderBy = String(config.orderBy ?? '').trim();
  const order = orderBy
    ? ` + ${JSON.stringify(
        ` ORDER BY ${quote(dialect, orderBy, node)} ${config.descending ? 'DESC' : 'ASC'}`,
      )}`
    : '';

  const seed = fixed.clauses.length
    ? `[${fixed.clauses.map((clause) => JSON.stringify(clause)).join(', ')}]`
    : '[]';
  const seedValues = fixed.values.length ? `[${fixed.values.join(', ')}]` : '[]';
  const input = filters.some((filter) => filter.source === 'input')
    ? '    const input = (value ?? {}) as Record<string, unknown>;\n'
    : '';

  return `  {
${input}    const clauses: string[] = ${seed};
    const values: unknown[] = ${seedValues};
${fixed.conditional.join('\n')}
    const statement =
      ${text(`SELECT * FROM ${name}`)} +
      (clauses.length > 0 ? " WHERE " + clauses.join(" AND ") : "")${order} +
      " LIMIT ${Number.isFinite(limit) ? limit : 100}";
    value = await many(statement, values);
  }`.replace(/ILIKE/g, contains);
}

/** A statement the designer wrote, with the inputs it names supplied as parameters. */
export function queryStep(node: Node, dialect: Dialect): string {
  const config = (node.config ?? {}) as { sql?: string; params?: string[]; returns?: string };
  const sql = String(config.sql ?? '').trim();
  if (!sql) throw new CompileError('Query node has no statement to run.', node.id);

  // Named holes, filled from the value flowing through: `:title` becomes a parameter, never text
  // pasted into the statement. That is the whole reason this node can exist at all.
  const names: string[] = [];
  const text = sql.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, name: string) => {
    names.push(name);
    return placeholder(dialect, names.length);
  });

  const values = names.map((name) => `input[${JSON.stringify(name)}]`).join(', ');
  const runner = config.returns === 'one' ? 'one' : 'many';

  return `  {
    const input = (value ?? {}) as Record<string, unknown>;
    value = await ${runner}(${JSON.stringify(text)}, [${values}]);
  }`;
}

/** The names a query asks for, which become its input ports. */
export function queryParams(sql: string): string[] {
  const names = new Set<string>();
  for (const match of sql.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)) names.add(match[1]!);
  return [...names];
}

export type { Query };
