import {
  COMPUTE_OPS,
  gateMessage,
  type GateConfig,
  type OperandConfig,
  type ValidationField,
} from '@loom/components';
import { FILTER_OPS, type DbFilter, type DbNodeConfig, type FilterOp } from '@loom/connectors';
import type { Node, Snapshot } from '@loom/ir';
import { dialectOf, isDocumentStore, moduleFor } from '@loom/connectors';
import { CompileError, type EmittedFile } from '../types';
import { firestorePrelude, firestoreStep } from './firestore';
import { ORG_ID_VAR, isScoped, scopeFilter } from './tenancy';
import { toolPrelude, toolStep, toolTimeout, usesFormEncoding } from './tools';
import { queryStep, sqlStep } from './sql';
import type { PipelinePlan } from './pipeline';

/**
 * Server emission: an API route node becomes one Vercel serverless function. The nodes inside
 * its body run here and nowhere else — the container boundary is the network boundary
 * (`docs/specs/binding-trigger-runtime.md`).
 *
 * The handler is written against plain `node:http` types, which is what the Vercel Node runtime
 * hands it, so the same file runs unchanged in the Preview's dev middleware and on Vercel.
 */

/**
 * A database step. It runs here and only here: the service-role key is server-scoped, and the
 * container boundary is the boundary it may not cross (`docs/specs/connector-credentials.md`).
 * The key is read from the environment **by name** — the compiler never emits a secret.
 */
/**
 * The narrowing clauses of a read, as PostgREST calls.
 *
 * A `value` filter compares against a literal chosen in the inspector. An `input` filter compares
 * against something the caller supplied — which is all a search box is: the value the person typed
 * travels the same road a form field does, and arrives keyed by column name.
 */
function emitFilters(node: Node, filters: readonly DbFilter[]): string {
  return filters
    .map((filter) => {
      const op = FILTER_OPS[filter.operator as FilterOp];
      if (!op) {
        throw new CompileError(
          `Filter on "${filter.column}" uses an unknown comparison "${filter.operator}".`,
          node.id,
        );
      }
      if (!filter.column) {
        throw new CompileError('A filter has no column chosen.', node.id);
      }

      const column = JSON.stringify(filter.column);
      if (filter.source === 'value') {
        const literal = String(filter.value ?? '');
        // `contains` is a wildcard match; the others compare the value as given.
        const argument =
          filter.operator === 'contains' ? JSON.stringify(`%${literal}%`) : JSON.stringify(literal);
        return `    query = query.${op.postgrest}(${column}, ${argument});`;
      }

      // Supplied at call time. An empty box must mean "no narrowing" rather than "match nothing",
      // or a search field would blank the list before anyone had typed in it.
      const read = `input[${column}]`;
      const argument =
        filter.operator === 'contains' ? `"%" + String(${read}) + "%"` : `${read} as never`;
      return `    if (${read} !== undefined && ${read} !== null && ${read} !== "") {
      query = query.${op.postgrest}(${column}, ${argument});
    }`;
    })
    .join('\n');
}

/** The connector a database node runs against, and the dialect it speaks. */
function connectorFor(node: Node, snapshot: Snapshot): { moduleId: string } {
  const config = (node.config ?? {}) as Partial<DbNodeConfig>;
  const connector = config.connectorId ? snapshot.connectors[config.connectorId] : undefined;
  if (!connector) {
    throw new CompileError('Database node is not attached to a connection.', node.id);
  }
  if (!moduleFor(connector.moduleId)) {
    throw new CompileError(`Unsupported connector "${connector.moduleId}".`, node.id);
  }
  return connector;
}

function emitDbStep(node: Node, snapshot: Snapshot): string {
  /**
   * Rows belonging to an organisation are narrowed to the one asking (O1).
   *
   * Done **here, on the server**, where the org came from the membership table rather than from
   * the request — a filter the browser could choose is a filter the browser could drop.
   */
  const tenancy = snapshot.tenancy;
  const config = (node.config ?? {}) as Partial<DbNodeConfig>;
  const connector = connectorFor(node, snapshot);

  // A statement, or a request — the node says the same thing either way.
  const dialect = dialectOf(connector.moduleId);
  if (node.kind === 'query') {
    if (!dialect) {
      throw new CompileError(
        `A query is written in SQL, and "${connector.moduleId}" does not run statements. Use ` +
          `the read, insert, update and delete nodes with that connection.`,
        node.id,
      );
    }
    return queryStep(node, dialect);
  }

  const table = String(config.table ?? '');
  if (!table) throw new CompileError('Database node has no table selected.', node.id);

  if (isDocumentStore(connector.moduleId)) return firestoreStep(node, table);

  if (dialect) {
    return sqlStep(node, dialect, table, primaryKeyName(node, snapshot, table));
  }

  const name = JSON.stringify(table);
  const key = JSON.stringify(primaryKeyName(node, snapshot, table));

  /**
   * A write has to land on a row in the caller's organisation, not merely on a row with the right
   * id (O1).
   *
   * Without it an id is enough, and one scraped or guessed from anywhere lets a caller change or
   * remove another organisation's row. Narrowing the read and leaving the write open is half a
   * boundary, which is not one.
   */
  const scopeEq =
    tenancy && isScoped(tenancy, table)
      ? `
      .eq(${JSON.stringify(tenancy.tenantColumn)}, ${ORG_ID_VAR})`
      : '';
  const scopeGuard =
    tenancy && isScoped(tenancy, table)
      ? `
    if (!${ORG_ID_VAR}) throw new Error('You are not in an organisation.');`
      : '';

  if (config.operation === 'insert') {
    /**
     * A new row lands in the organisation that made it, stamped here rather than sent up.
     *
     * Taking it from the request would let a client file a row into somebody else's organisation,
     * which is the same class of hole as reading theirs.
     */
    const stamp =
      tenancy && isScoped(tenancy, table)
        ? `
    if (!${ORG_ID_VAR}) throw new Error('You are not in an organisation.');
    row[${JSON.stringify(tenancy.tenantColumn)}] = ${ORG_ID_VAR};`
        : '';

    return `  {
    const row = (value ?? {}) as Record<string, unknown>;${stamp}
    const { data, error } = await supabase.from(${name}).insert(row).select().single();
    if (error) throw new Error(error.message);
    value = data;
  }`;
  }

  if (config.operation === 'upsert') {
    // PostgREST resolves the clash on the primary key itself, so this is the same one call the
    // SQL side makes — insert, or update the row that was already there.
    return `  {
    const row = (value ?? {}) as Record<string, unknown>;
    const { data, error } = await supabase.from(${name}).upsert(row).select().single();
    if (error) throw new Error(error.message);
    value = data;
  }`;
  }

  if (config.operation === 'update') {
    // The identity is pulled out and the rest is the patch; sending the key back as a column
    // would ask the database to rewrite the row it is being used to find.
    return `  {
    const input = (value ?? {}) as Record<string, unknown>;
    const id = input[${key}];
    if (id === undefined || id === null || id === "") {
      throw new Error("Update needs the row it is changing.");
    }${scopeGuard}
    const patch: Record<string, unknown> = {};
    for (const [column, entry] of Object.entries(input)) {
      // Undefined means "not shown on this form", which is different from "set it to null".
      if (column !== ${key} && entry !== undefined) patch[column] = entry;
    }
    const { data, error } = await supabase
      .from(${name})
      .update(patch)
      .eq(${key}, id)${scopeEq}
      .select()
      .single();
    if (error) throw new Error(error.message);
    value = data;
  }`;
  }

  if (config.operation === 'delete') {
    return `  {
    const input = (value ?? {}) as Record<string, unknown>;
    const id = input[${key}];
    if (id === undefined || id === null || id === "") {
      throw new Error("Delete needs the row it is removing.");
    }${scopeGuard}
    const { data, error } = await supabase
      .from(${name})
      .delete()
      .eq(${key}, id)${scopeEq}
      .select()
      .single();
    if (error) throw new Error(error.message);
    value = data;
  }`;
  }

  if (config.operation === 'aggregate') {
    // PostgREST can do this only where the server has been set up for it, and a node that
    // compiles against one project and fails against the next is worse than one that says so.
    throw new CompileError(
      'A total is worked out by the database, and this connection is reached over HTTP. Connect ' +
        'to the database directly to use it, or read the rows and total them on the screen.',
      node.id,
    );
  }

  const limit = Number(config.limit ?? 100);
  const orderBy = String(config.orderBy ?? '').trim();
  // Sorting and limiting belong to the query, not to a loop the designer would have to write.
  const order = orderBy
    ? `
      .order(${JSON.stringify(orderBy)}, { ascending: ${config.descending ? 'false' : 'true'} })`
    : '';

  const filters = config.filters ?? [];
  /**
   * The designer's own filters, then the organisation's (O1).
   *
   * Last, and unconditionally: a scope that a `filters.length` check could skip is a scope that
   * disappears the moment somebody removes their own filter.
   */
  const scope = tenancy && isScoped(tenancy, table) ? scopeFilter(tenancy) : '';
  const narrowing = (filters.length > 0 ? `\n${emitFilters(node, filters)}` : '') + scope;
  const input = filters.some((filter) => filter.source === 'input')
    ? '    const input = (value ?? {}) as Record<string, unknown>;\n'
    : '';

  if (config.operation === 'count') {
    // `head: true` asks for the number without the rows: PostgREST answers it in the
    // Content-Range header, so counting a large table costs one small response.
    return `  {
${input}    let query = supabase.from(${name}).select('*', { count: 'exact', head: true });${narrowing}
    const { count, error } = await query;
    if (error) throw new Error(error.message);
    value = count ?? 0;
  }`;
  }

  /**
   * What comes back with each row (Q1).
   *
   * PostgREST embeds a related resource by naming it in the select — `*,line_items(*)` — and
   * resolves the join from the foreign key itself. One level: the shape is `select=*,other(*)`
   * and never `other(deeper(*))`, because depth is where a query builder becomes a query language.
   */
  const include = (config.include ?? []).filter(Boolean);
  const selectList = include.length > 0 ? `*,${include.map((t) => `${t}(*)`).join(',')}` : '*';

  /**
   * A page of rows, and how many there are altogether (Q2).
   *
   * `count: 'exact'` asks PostgREST for the size of the **whole** result, which comes back in the
   * Content-Range header rather than as rows — so "page 3 of 418" costs nothing extra to know.
   * `range` is inclusive at both ends, which is why the end is `+ size - 1` and not `+ size`.
   *
   * The alternative — fetch everything and slice — is a memory problem with a page control on it,
   * and it is what a hundred-thousand-row table makes fatal.
   */
  const size = Number.isFinite(limit) ? limit : 100;

  return `  {
${input}    // Which page was asked for. Absent is the first, and a nonsense one is the first too:
    // a negative offset is a request nobody meant and an error nobody can act on.
    const requested = Number((value as { page?: unknown } | null)?.page ?? 0);
    const page = Number.isFinite(requested) && requested > 0 ? Math.trunc(requested) : 0;
    const from = page * ${size};

    let query = supabase
      .from(${name})
      .select(${JSON.stringify(selectList)}, { count: 'exact' })${order}
      .range(from, from + ${size} - 1);${narrowing}
    const { data, error, count: total } = await query;
    if (error) throw new Error(error.message);
    // Both, because they answer different questions: the rows on this page, and how many exist.
    value = { rows: data ?? [], total: total ?? 0, page };
  }`;
}

/**
 * The column that identifies a row, from the cached introspection.
 *
 * A table with no primary key cannot be updated or deleted from — there is no way to name one row
 * — and saying so here beats emitting a query that would rewrite the whole table.
 */
function primaryKeyName(node: Node, snapshot: Snapshot, table: string): string {
  const config = (node.config ?? {}) as Partial<DbNodeConfig>;
  // An upsert needs the real key too: it is the column the clash is resolved on.
  const needsKey =
    config.operation === 'update' || config.operation === 'delete' || config.operation === 'upsert';
  if (!needsKey) return 'id';

  const connector = config.connectorId ? snapshot.connectors[config.connectorId] : undefined;
  const schema = (
    connector?.config as
      | {
          schema?: {
            tables?: { name: string; columns?: { name: string; primaryKey?: boolean }[] }[];
          };
        }
      | undefined
  )?.schema;
  const found = schema?.tables?.find((candidate) => candidate.name === table);
  const key = found?.columns?.find((column) => column.primaryKey);

  if (!key) {
    throw new CompileError(
      `"${table}" has no primary key, so there is no way to say which row to change. ` +
        `Add one in the database and reconnect.`,
      node.id,
    );
  }
  return key.name;
}

/**
 * A Validate step. Checking runs on the server because that is the only place it cannot be
 * bypassed: the browser copy is a convenience, this one is the rule. It also coerces — an
 * `<input>` hands over strings, and a number column will not take one.
 */
function emitValidateStep(node: Node): string {
  const config = (node.config ?? {}) as { fields?: ValidationField[] };
  const fields = Array.isArray(config.fields) ? config.fields : [];
  if (fields.length === 0) {
    throw new CompileError('Validate node has no fields to check.', node.id);
  }

  const checks = fields.map((field) => {
    const key = JSON.stringify(field.name);
    const missing = field.required
      ? `    if (raw === undefined || raw === null || raw === '') {
      throw new Error(${JSON.stringify(`${field.name} is required.`)});
    }`
      : `    if (raw === undefined || raw === null || raw === '') { delete row[${key}]; }`;

    const coerce =
      field.type.kind === 'number'
        ? `    else {
      const parsed = Number(raw);
      if (Number.isNaN(parsed)) throw new Error(${JSON.stringify(`${field.name} must be a number.`)});
      row[${key}] = parsed;
    }`
        : field.type.kind === 'boolean'
          ? `    else { row[${key}] = raw === true || raw === 'true'; }`
          : `    else { row[${key}] = String(raw); }`;

    return `  {
    const raw = input[${key}];
${missing}
${coerce}
  }`;
  });

  return `  {
    const input = (value ?? {}) as Record<string, unknown>;
    const row: Record<string, unknown> = { ...input };
${checks.join('\n')}
    value = row;
  }`;
}

/**
 * A Gate. The condition holds or the request ends — the pipeline's one piece of control flow
 * (`docs/06-glossary.md`). It runs on the server for the same reason validation does: a check the
 * browser could skip is not a check.
 */
/**
 * The hard ceiling on a For each, whatever it was configured with (N2).
 *
 * A cap somebody can raise without limit is not a cap. Five hundred is well past what a serverless
 * request should be doing in one go, and a list longer than this is a job rather than a step —
 * which is what scheduled work (E3) is for.
 */
const FOR_EACH_CAP = 500;

/** Push an already-emitted step in by another level, so a nested body reads as nested. */
function indentBy(code: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return code
    .split('\n')
    .map((line) => (line ? pad + line : line))
    .join('\n');
}

/**
 * What counts as true, in one place.
 *
 * A Gate refuses when it does not hold and a Branch takes the other arm — different jobs, and the
 * *test* has to be the same one or "is checked" would mean two things two nodes apart.
 */
function conditionTest(node: Node, config: Partial<GateConfig>): { subject: string; test: string } {
  const condition = config.condition ?? 'isFilled';
  const field = String(config.field ?? '').trim();
  const comparand = JSON.stringify(String(config.value ?? ''));

  const subject = field
    ? `((value ?? {}) as Record<string, unknown>)[${JSON.stringify(field)}]`
    : 'value';

  const tests: Record<string, string> = {
    isFilled: `subject !== undefined && subject !== null && subject !== ''`,
    isEmpty: `subject === undefined || subject === null || subject === ''`,
    isTrue: `subject === true || subject === 'true'`,
    isFalse: `subject === false || subject === 'false' || subject === undefined || subject === null`,
    equals: `String(subject) === ${comparand}`,
    notEquals: `String(subject) !== ${comparand}`,
    greaterThan: `Number(subject) > Number(${comparand})`,
    lessThan: `Number(subject) < Number(${comparand})`,
  };

  const test = tests[condition];
  if (!test) {
    throw new CompileError(
      `"${node.name ?? node.kind}" has unknown condition "${condition}". Known: ` +
        `${Object.keys(tests).join(', ')}.`,
      node.id,
    );
  }

  return { subject, test };
}

function emitGateStep(node: Node): string {
  const config = (node.config ?? {}) as Partial<GateConfig>;
  const { subject, test } = conditionTest(node, config);

  return `  {
    const subject: unknown = ${subject};
    if (!(${test})) throw new Error(${JSON.stringify(gateMessage(config))});
  }`;
}

/**
 * Choosing between two paths (N2).
 *
 * An `if`/`else` around two lists of steps. Each arm reads and writes the same `value` the rest of
 * the route does, so a branch chains like any other step and whichever arm ran decides what comes
 * out of it.
 *
 * An empty arm is legal and means "do nothing this way", which is a real answer — "send a receipt
 * if it paid, and otherwise carry on" should not need a placeholder step to say so.
 */
function emitBranchStep(node: Node, snapshot: Snapshot): string {
  const config = (node.config ?? {}) as Partial<GateConfig> & { then?: string[]; else?: string[] };
  const { subject, test } = conditionTest(node, config);

  const arm = (ids: readonly string[]): string =>
    ids
      .map((id) => snapshot.nodes[id])
      .filter((step): step is Node => Boolean(step))
      .map((step) => indentBy(emitStep(step, snapshot), 2))
      .join('\n');

  const yes = arm(config.then ?? []);
  const no = arm(config.else ?? []);

  return `  {
    const subject: unknown = ${subject};
    if (${test}) {
${yes || '      // nothing this way'}
    } else {
${no || '      // nothing this way'}
    }
  }`;
}

/**
 * Doing something to each of a list (N2).
 *
 * Bounded by construction: it walks a list and stops at a cap. There is no condition to loop on
 * and no way to loop forever, which is what keeps it a data operation rather than control flow.
 *
 * **One row failing does not stop the rest.** A run over five hundred rows that dies on the third
 * and reports nothing is worse than no run at all, so each item is attempted on its own and what
 * comes out is how many worked and which did not, with the reason attached.
 *
 * The body reads `value` like every other step; inside the loop that `value` is the item, which is
 * why the arm is a block of its own.
 */
function emitForEachStep(node: Node, snapshot: Snapshot): string {
  const config = (node.config ?? {}) as { limit?: unknown; body?: string[] };

  const asked = Number(config.limit ?? FOR_EACH_CAP);
  const cap = Number.isFinite(asked)
    ? Math.min(Math.max(1, Math.trunc(asked)), FOR_EACH_CAP)
    : FOR_EACH_CAP;

  const body = (config.body ?? [])
    .map((id) => snapshot.nodes[id])
    .filter((step): step is Node => Boolean(step))
    .map((step) => indentBy(emitStep(step, snapshot), 4))
    .join('\n');

  if (!body) {
    throw new CompileError(
      `"${node.name ?? 'For each'}" has no steps, so it would walk the list and do nothing to it.`,
      node.id,
    );
  }

  return `  {
    const items = Array.isArray(value) ? (value as unknown[]) : [];
    const failed: Record<string, unknown>[] = [];
    let done = 0;

    // Capped, so a list that is longer than anyone expected cannot run away with the request.
    for (const item of items.slice(0, ${cap})) {
      try {
        // The body reads \`value\` like any other step; here it is the item.
        let value: unknown = item;
${body}
        done += 1;
      } catch (error) {
        // Kept, not thrown: the other rows are still worth doing, and which ones failed is the
        // thing whoever ran this actually needs.
        failed.push({
          item,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    value = { done, failed, skipped: Math.max(0, items.length - ${cap}) };
  }`;
}

/**
 * Operator steps (Math, Compare, Logic). Each reads named fields of the record flowing through,
 * computes one value, and writes it back into a named field — so the pipeline stays a single
 * value moving forward, which is what makes a route body readable top to bottom.
 */

/** The expression for one side of an operation. A blank left side means the whole value. */
function operandExpr(config: Partial<OperandConfig>, side: 'left' | 'right'): string {
  if (side === 'left') {
    const field = String(config.left ?? '').trim();
    return field ? `source[${JSON.stringify(field)}]` : 'value';
  }
  const raw = String(config.right ?? '').trim();
  return config.rightKind === 'field' ? `source[${JSON.stringify(raw)}]` : JSON.stringify(raw);
}

const NEWLINE = String.fromCharCode(10);

/**
 * Whether the step reads the incoming record at all. The emitted app builds with
 * `noUnusedLocals`, so a `source` nobody reads fails its own `tsc` — declaring it unconditionally
 * would turn "left blank, right a literal" into a broken build.
 */
function needsSource(config: Partial<OperandConfig>): boolean {
  return Boolean(
    String(config.left ?? '').trim() ||
    config.rightKind === 'field' ||
    String(config.into ?? '').trim(),
  );
}

const sourceLine = (config: Partial<OperandConfig>): string =>
  needsSource(config)
    ? `    const source = (value ?? {}) as Record<string, unknown>;${NEWLINE}`
    : '';

/** How the answer rejoins the pipeline: into a named field, or as the whole value. */
function writeBack(config: Partial<OperandConfig>): string {
  const into = String(config.into ?? '').trim();
  return into ? `value = { ...source, [${JSON.stringify(into)}]: answer };` : 'value = answer;';
}

const MATH_EXPRESSIONS: Record<string, string> = {
  add: 'left + right',
  subtract: 'left - right',
  multiply: 'left * right',
  divide: 'left / right',
  remainder: 'left % right',
  min: 'Math.min(left, right)',
  max: 'Math.max(left, right)',
};

function emitMathStep(node: Node): string {
  const config = (node.config ?? {}) as Partial<OperandConfig> & { operator?: string };
  const operator = config.operator ?? 'add';
  const expression = MATH_EXPRESSIONS[operator];
  if (!expression) {
    throw new CompileError(
      `Math has unknown operation "${operator}". Known: ${Object.keys(MATH_EXPRESSIONS).join(', ')}.`,
      node.id,
    );
  }

  const subject = String(config.left ?? '').trim() || 'the value';
  // Dividing by zero yields Infinity in JavaScript, which lands in a numeric column as a number
  // nobody meant. A named failure beats a plausible wrong answer.
  const guard =
    operator === 'divide' || operator === 'remainder'
      ? `
    if (right === 0) throw new Error(${JSON.stringify(`Cannot divide ${subject} by zero.`)});`
      : '';

  return `  {
${sourceLine(config)}    const left = Number(${operandExpr(config, 'left')});
    const right = Number(${operandExpr(config, 'right')});
    if (Number.isNaN(left) || Number.isNaN(right)) {
      throw new Error(${JSON.stringify(`${subject} and ${String(config.right ?? '').trim() || 'the value'} must both be numbers.`)});
    }${guard}
    const answer = ${expression};
    ${writeBack(config)}
  }`;
}

const COMPARE_EXPRESSIONS: Record<string, string> = {
  equals: 'String(left) === String(right)',
  notEquals: 'String(left) !== String(right)',
  greaterThan: 'Number(left) > Number(right)',
  lessThan: 'Number(left) < Number(right)',
  atLeast: 'Number(left) >= Number(right)',
  atMost: 'Number(left) <= Number(right)',
};

function emitCompareStep(node: Node): string {
  const config = (node.config ?? {}) as Partial<OperandConfig> & { operator?: string };
  const operator = config.operator ?? 'equals';
  const expression = COMPARE_EXPRESSIONS[operator];
  if (!expression) {
    throw new CompileError(
      `Compare has unknown condition "${operator}". Known: ${Object.keys(COMPARE_EXPRESSIONS).join(', ')}.`,
      node.id,
    );
  }

  // Equality compares as text so a form's "3" matches a column's 3; ordering compares as numbers,
  // because "10" < "9" is true as text and false as arithmetic.
  return `  {
${sourceLine(config)}    const left: unknown = ${operandExpr(config, 'left')};
    const right: unknown = ${operandExpr(config, 'right')};
    const answer = ${expression};
    ${writeBack(config)}
  }`;
}

function emitLogicStep(node: Node): string {
  const config = (node.config ?? {}) as Partial<OperandConfig> & { operator?: string };
  const operator = config.operator ?? 'and';
  if (operator !== 'and' && operator !== 'or') {
    throw new CompileError(`Logic has unknown operation "${operator}". Known: and, or.`, node.id);
  }

  // A checkbox arrives as a boolean; the same value read back from a form field arrives as the
  // string "true". Both mean checked.
  return `  {
${sourceLine(config)}    const truthy = (input: unknown): boolean => input === true || input === 'true';
    const left = truthy(${operandExpr(config, 'left')});
    const right = truthy(${operandExpr(config, 'right')});
    const answer = left ${operator === 'and' ? '&&' : '||'} right;
    ${writeBack(config)}
  }`;
}

/** One server-side step, as a statement operating on `value`. */
function emitStep(node: Node, snapshot: Snapshot): string {
  if (node.category === 'db') return emitDbStep(node, snapshot);
  // A tool call runs on the server for the same reason a database node does: the credential must
  // not reach a browser (`docs/22-api-connectors.md`).
  if (node.category === 'tool') return toolStep(node, snapshot);
  if (node.kind === 'validate') return emitValidateStep(node);
  if (node.kind === 'gate') return emitGateStep(node);
  // Containers: their bodies are steps like any other, walked here (N2).
  if (node.kind === 'branch') return emitBranchStep(node, snapshot);
  if (node.kind === 'forEach') return emitForEachStep(node, snapshot);
  if (node.kind === 'math') return emitMathStep(node);
  if (node.kind === 'compare') return emitCompareStep(node);
  if (node.kind === 'logic') return emitLogicStep(node);

  const config = (node.config ?? {}) as { op?: string; source?: string };

  if (node.kind === 'compute') {
    const op = String(config.op ?? '');
    switch (op) {
      case 'uppercase':
        return '  value = String(value).toUpperCase();';
      case 'lowercase':
        return '  value = String(value).toLowerCase();';
      case 'trim':
        return '  value = String(value).trim();';
      case 'toDate':
        // An empty box is not a date, and `new Date("")` is an Invalid Date that serialises to
        // null and lands in the column as one — so nothing is a nicer answer than nonsense.
        return `  {
    const text = String(value ?? '').trim();
    const when = text ? new Date(text) : undefined;
    value = when && !Number.isNaN(when.getTime()) ? when.toISOString() : null;
  }`;
      case 'length':
        return '  value = String(value).length;';
      case 'double':
        return '  value = Number(value) * 2;';
      case 'negate':
        return '  value = -Number(value);';
      case 'isEmpty':
        return `  value = value === undefined || value === null || String(value).trim() === '';`;
      case 'not':
        return '  value = !(value === true || value === "true");';
      default:
        throw new CompileError(
          `Compute node has unknown operation "${op}". Known: ${Object.keys(COMPUTE_OPS).join(', ')}.`,
          node.id,
        );
    }
  }

  if (node.kind === 'code') {
    const source = String(config.source ?? '').trim();
    if (source.length === 0) {
      throw new CompileError('Code node has an empty body.', node.id);
    }
    // The escape hatch (guardrail 7): the designer's own statements, run over `value`.
    return `  value = await (async (input: unknown) => {
${source
  .split('\n')
  .map((line) => `    ${line}`)
  .join('\n')}
  })(value);`;
  }

  throw new CompileError(
    `Node kind "${node.category}:${node.kind}" cannot run inside an API route.`,
    node.id,
  );
}

export function emitApiFunction(plan: PipelinePlan, snapshot: Snapshot, auth = false): EmittedFile {
  const steps = plan.body.map((node) => emitStep(node, snapshot));
  const routeName = plan.routePath.replace('/api/', '');
  const usesDb = plan.body.some((node) => node.category === 'db');

  /** Does anything in this route touch a table whose rows belong to an organisation? (O1) */
  const scopesAnything = plan.body.some(
    (node) =>
      node.category === 'db' &&
      isScoped(snapshot.tenancy, String((node.config as { table?: string })?.table ?? '')),
  );
  const sqlNode = plan.body.find(
    (node) => node.category === 'db' && dialectOf(connectorFor(node, snapshot).moduleId),
  );
  const documentNode = plan.body.find(
    (node) => node.category === 'db' && isDocumentStore(connectorFor(node, snapshot).moduleId),
  );

  // A serverless route talks REST, so it takes Supabase's REST client rather than the full
  // supabase-js: the umbrella package builds a realtime client on import, which needs Node 22's
  // native WebSocket and is dead weight in a stateless function. Same query API either way.
  //
  // **Who the client is depends on whether the app has users.** Without them, the service-role
  // key is the only identity there is. With them, the caller's own token goes on the request and
  // row-level security decides what comes back — the service-role key is not used here at all,
  // because it bypasses exactly the rules that keep one person's rows theirs
  // (`docs/specs/app-auth.md`).
  /**
   * A SQL connector opens a real connection, so it takes a **pool held at module scope** — the
   * function is reused between requests and a fresh connection per invocation is how a database's
   * connection limit gets exhausted. `max: 1` because each instance serves one request at a time;
   * the pooling that matters happens in front of the database (Supavisor, PgBouncer, Neon), which
   * is why the credential asks for the pooled connection string.
   */
  /**
   * MySQL's driver, and the two helpers its writes need.
   *
   * `mysql2/promise` speaks the same pooled shape as `pg`, and `?` is its placeholder — every
   * value still travels as a parameter. `write` hands back the result header, which is where the
   * generated key lives when the row did not carry one.
   */
  const mysqlPrelude = ((): string => {
    const body = steps.join('\n');
    const parts = [
      `import mysql from 'mysql2/promise';

// The connection string is read by NAME from the environment; the value never enters the
// document, the snapshot, or this file (docs/05-guardrails.md #1).
const pool = mysql.createPool({ uri: process.env.DATABASE_URL ?? '', connectionLimit: 1 });
`,
    ];

    if (body.includes('slot(')) {
      parts.push(`/** MySQL names every parameter the same way; the value still travels beside it. */
const slot = (_index: number): string => '?';
`);
    }
    if (body.includes('quote(')) {
      parts.push(`const quote = (name: string): string => '\`' + name.replace(/\`/g, '\`\`') + '\`';
`);
    }
    if (body.includes('many(') || body.includes('one(')) {
      parts.push(`async function many(statement: string, values: unknown[]): Promise<unknown[]> {
  const [rows] = await pool.query(statement, values);
  return rows as unknown[];
}
`);
    }
    if (body.includes('one(')) {
      parts.push(`async function one(statement: string, values: unknown[]): Promise<unknown> {
  const rows = await many(statement, values);
  if (rows.length === 0) throw new Error('That row was not found.');
  return rows[0];
}
`);
    }
    if (body.includes('write(')) {
      parts.push(`async function write(
  statement: string,
  values: unknown[],
): Promise<{ insertId: number }> {
  const [result] = await pool.query(statement, values);
  return result as { insertId: number };
}
`);
    }

    return parts.join('\n');
  })();

  const sqlPrelude = ((): string => {
    // The emitted app builds with `noUnusedLocals`, so a helper this route never calls is a
    // compile error rather than dead weight. Each one is written only if a step reached for it.
    const body = steps.join('\n');
    const wantsOne = body.includes('one(');
    const parts = [
      `import { Pool } from 'pg';

// The connection string is read by NAME from the environment; the value never enters the
// document, the snapshot, or this file (docs/05-guardrails.md #1).
const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? '', max: 1 });
`,
    ];

    if (body.includes('slot(')) {
      parts.push(`/** \`$1, $2, …\` — every value travels as a parameter, never inside the statement. */
const slot = (index: number): string => '$' + index;
`);
    }
    if (body.includes('quote(')) {
      // Column names come from the row a form sent, so they are quoted the way Postgres quotes
      // an identifier — doubling any quote inside rather than trusting the name.
      parts.push(`const quote = (name: string): string => '"' + name.replace(/"/g, '""') + '"';
`);
    }
    if (wantsOne || body.includes('many(')) {
      parts.push(`async function many(statement: string, values: unknown[]): Promise<unknown[]> {
  const result = await pool.query(statement, values);
  return result.rows;
}
`);
    }
    if (wantsOne) {
      parts.push(`async function one(statement: string, values: unknown[]): Promise<unknown> {
  const rows = await many(statement, values);
  if (rows.length === 0) throw new Error('That row was not found.');
  return rows[0];
}
`);
    }
    return parts.join('\n');
  })();

  const mysqlNode = plan.body.find(
    (node) =>
      node.category === 'db' && dialectOf(connectorFor(node, snapshot).moduleId) === 'mysql',
  );

  const toolNodes = plan.body.filter((node) => node.category === 'tool');
  // The form encoder is emitted only where something takes form encoding: an unused helper is a
  // build failure in the emitted app, which builds with `noUnusedLocals`.
  const toolLines =
    toolNodes.length > 0
      ? toolPrelude(toolTimeout(snapshot, plan.body), usesFormEncoding(snapshot, plan.body))
      : '';

  const dbPrelude = !usesDb
    ? ''
    : documentNode
      ? firestorePrelude(steps)
      : mysqlNode
        ? mysqlPrelude
        : sqlNode
          ? sqlPrelude
          : auth
            ? `import { PostgrestClient } from '@supabase/postgrest-js';
import { accessTokenFor } from '../src/server/auth';
${scopesAnything ? "import { orgFor } from '../src/server/org';\n" : ''}`
            : `import { PostgrestClient } from '@supabase/postgrest-js';

// Credentials are read by NAME from the environment; the value never enters the document,
// the snapshot, or this file (docs/05-guardrails.md #1).
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const supabase = new PostgrestClient(\`\${process.env.SUPABASE_URL ?? ''}/rest/v1\`, {
  headers: { apikey: serviceKey, Authorization: \`Bearer \${serviceKey}\` },
});
`;

  // With users, the client is built per request, because the identity on it is per request.
  const dbHandlerPrelude =
    usesDb && auth
      ? `    // Answered as whoever is asking; signed out, that is the anon role, and row-level
    // security decides either way.
    const token = await accessTokenFor(req, res);
    const anonKey = process.env.SUPABASE_ANON_KEY ?? '';
    const supabase = new PostgrestClient(\`\${process.env.SUPABASE_URL ?? ''}/rest/v1\`, {
      headers: { apikey: anonKey, Authorization: \`Bearer \${token ?? anonKey}\` },
    });
${
  scopesAnything
    ? `
    // Which organisation is asking (O1). Resolved from the membership table with this request's
    // own session — never taken from the request itself, which the caller controls.
    const ${ORG_ID_VAR} = (await orgFor(req, res))?.id ?? null;
`
    : ''
}
`
      : '';

  return {
    path: `api/${routeName}.ts`,
    content: `// Generated by @loom/compiler from API route "${plan.node.name ?? plan.node.id}" (${plan.node.id}).
// Runs on the server only. Everything in this file is inside the API node's body.
import type { IncomingMessage, ServerResponse } from 'node:http';
${dbPrelude}${toolLines}
async function readInput(req: IncomingMessage): Promise<unknown> {
  if (req.method === 'GET') {
    const url = new URL(req.url ?? '/', 'http://localhost');
    return url.searchParams.get('input');
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return null;

  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    return (JSON.parse(raw) as { input?: unknown }).input ?? null;
  } catch {
    return raw;
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader('content-type', 'application/json');

  try {
${dbHandlerPrelude}    let value: unknown = await readInput(req);

${steps.join('\n')}

    res.statusCode = 200;
    res.end(JSON.stringify({ result: value }));
  } catch (error) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
}
`,
  };
}

/**
 * A dev-only Vite plugin for the emitted app so the Preview serves the same handler files Vercel
 * will run. Emitted into the app's own vite.config.ts; Vercel never sees it.
 */
export const DEV_API_PLUGIN = `
/**
 * Dev-only: serve api/*.ts through the same handler signature Vercel uses, so the Preview runs
 * the real server code rather than a stub.
 */
function loomDevApi(): Plugin {
  return {
    name: 'loom:dev-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        if (!url.startsWith('/api/')) return next();
        const name = url.slice('/api/'.length).split('?')[0];
        void (async () => {
          try {
            const module = await server.ssrLoadModule('/api/' + name + '.ts');
            await (module.default as (req: unknown, res: unknown) => Promise<void>)(req, res);
          } catch (error) {
            res.statusCode = 500;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ error: (error as Error).message }));
          }
        })();
      });
    },
  };
}
`;
