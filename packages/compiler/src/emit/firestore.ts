import { DOCUMENT_ID, type DbFilter, type DbNodeConfig, type FilterOp } from '@loom/connectors';
import type { Node } from '@loom/ir';
import { CompileError } from '../types';

/**
 * Firestore emission (`docs/14-data.md`).
 *
 * The same four-and-three operations, against a document store. What differs from SQL is not the
 * shape of the node but what the database is *able* to do, and the two gaps are refused here
 * rather than papered over:
 *
 * - **`contains`** has no equivalent in a Firestore query. Faking it means reading the whole
 *   collection into the function and filtering there — a search box that quietly costs a full
 *   collection read every keystroke — so it is a compile error that says what to do instead.
 * - **`min` and `max`** are not Firestore aggregates. It has `count`, `sum` and `average`.
 *
 * The document id is the row's identity and is *not* a field inside the document, so it is added
 * on the way out and stripped on the way in. Writing it as a field would create a second id that
 * disagrees with the first the moment a document is copied.
 */

/** loom's comparisons, as Firestore query operators. `contains` is deliberately absent. */
const FIRESTORE_OPS: Record<Exclude<FilterOp, 'contains'>, string> = {
  equals: '==',
  notEquals: '!=',
  greaterThan: '>',
  lessThan: '<',
};

/** A field name Firestore can address. A path with dots reaches into a map, which is not this. */
function field(name: string, node: Node): string {
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name)) {
    throw new CompileError(
      `"${name}" is not a field name this connector can address. Field names come from the ` +
        `documents loom read when you connected.`,
      node.id,
    );
  }
  return JSON.stringify(name);
}

function operatorFor(filter: DbFilter, node: Node): string {
  if (filter.operator === 'contains') {
    throw new CompileError(
      'Firestore has no "contains" search, and reading every document to filter in the app would ' +
        'cost a full collection read each time. Store a lowercase field to match exactly, or use ' +
        'a search service alongside it.',
      node.id,
    );
  }
  const operator = FIRESTORE_OPS[filter.operator as Exclude<FilterOp, 'contains'>];
  if (!operator) {
    throw new CompileError(
      `Filter on "${filter.column}" uses an unknown comparison "${filter.operator}".`,
      node.id,
    );
  }
  return operator;
}

/** The narrowing lines of a read: fixed comparisons, and the ones supplied at call time. */
function narrowing(node: Node, filters: readonly DbFilter[]): { lines: string[]; usesInput: boolean } {
  const lines: string[] = [];
  let usesInput = false;

  for (const filter of filters) {
    if (!filter.column) throw new CompileError('A filter has no column chosen.', node.id);
    const operator = operatorFor(filter, node);
    const name = field(filter.column, node);

    if (filter.source === 'value') {
      lines.push(`    query = query.where(${name}, ${JSON.stringify(operator)}, ${JSON.stringify(String(filter.value ?? ''))});`);
      continue;
    }

    // Supplied at call time: an empty box narrows nothing rather than matching nothing.
    usesInput = true;
    const read = `input[${JSON.stringify(filter.column)}]`;
    lines.push(
      `    if (${read} !== undefined && ${read} !== null && ${read} !== "") {\n` +
        `      query = query.where(${name}, ${JSON.stringify(operator)}, ${read});\n` +
        `    }`,
    );
  }

  return { lines, usesInput };
}

/** What one database node does to a collection, as lines of the emitted function's body. */
export function firestoreStep(node: Node, collection: string): string {
  const config = (node.config ?? {}) as Partial<DbNodeConfig>;
  const name = field(collection, node);
  const key = JSON.stringify(DOCUMENT_ID);

  if (config.operation === 'insert') {
    return `  {
    const { ${DOCUMENT_ID}: _ignored, ...fields } = (value ?? {}) as Record<string, unknown>;
    const created = await db.collection(${name}).add(fields);
    value = { ${DOCUMENT_ID}: created.id, ...fields };
  }`;
  }

  if (config.operation === 'upsert') {
    // With an id, the document is merged into; without one, Firestore makes the id — which is
    // the same "save this" either way, and the reason this is one node rather than a branch.
    return `  {
    const { ${DOCUMENT_ID}: id, ...fields } = (value ?? {}) as Record<string, unknown>;
    if (id === undefined || id === null || id === "") {
      const created = await db.collection(${name}).add(fields);
      value = { ${DOCUMENT_ID}: created.id, ...fields };
    } else {
      const doc = db.collection(${name}).doc(String(id));
      await doc.set(fields, { merge: true });
      const saved = await doc.get();
      value = { ${DOCUMENT_ID}: doc.id, ...saved.data() };
    }
  }`;
  }

  if (config.operation === 'update') {
    return `  {
    const { ${DOCUMENT_ID}: id, ...fields } = (value ?? {}) as Record<string, unknown>;
    if (id === undefined || id === null || id === "") {
      throw new Error("Update needs the row it is changing.");
    }
    // Undefined means "not shown on this form", which is different from "set it to null".
    const patch: Record<string, unknown> = {};
    for (const [name, entry] of Object.entries(fields)) {
      if (entry !== undefined) patch[name] = entry;
    }
    if (Object.keys(patch).length === 0) throw new Error("Update has nothing to change.");

    const doc = db.collection(${name}).doc(String(id));
    await doc.update(patch);
    const saved = await doc.get();
    value = { ${DOCUMENT_ID}: doc.id, ...saved.data() };
  }`;
  }

  if (config.operation === 'delete') {
    return `  {
    const input = (value ?? {}) as Record<string, unknown>;
    const id = input[${key}];
    if (id === undefined || id === null || id === "") {
      throw new Error("Delete needs the row it is removing.");
    }
    const doc = db.collection(${name}).doc(String(id));
    // Read before removing: the answer is the row that was deleted, as everywhere else.
    const saved = await doc.get();
    if (!saved.exists) throw new Error("That row was not found.");
    const removed = { ${DOCUMENT_ID}: doc.id, ...saved.data() };
    await doc.delete();
    value = removed;
  }`;
  }

  const filters = config.filters ?? [];
  const narrowed = narrowing(node, filters);
  const input = narrowed.usesInput
    ? '    const input = (value ?? {}) as Record<string, unknown>;\n'
    : '';
  const where = narrowed.lines.length > 0 ? `${narrowed.lines.join('\n')}\n` : '';
  const open = `${input}    let query: FirebaseFirestore.Query = db.collection(${name});\n${where}`;

  if (config.operation === 'count') {
    return `  {
${open}    const counted = await query.count().get();
    value = counted.data().count;
  }`;
  }

  if (config.operation === 'aggregate') {
    const fn = String(config.fn ?? 'sum').toLowerCase();
    // Verified against Firestore's aggregation-queries documentation: count, sum and average.
    if (fn !== 'sum' && fn !== 'avg') {
      throw new CompileError(
        `Firestore can total and average a field, but it has no "${fn}". Read the rows and work ` +
          `it out on the screen, or keep the value you need in a document as it changes.`,
        node.id,
      );
    }
    const column = String(config.column ?? '').trim();
    if (!column) throw new CompileError('Total has no field chosen.', node.id);

    const aggregate = fn === 'sum' ? 'sum' : 'average';
    return `  {
${open}    const totalled = await query
      .aggregate({ value: AggregateField.${aggregate}(${field(column, node)}) })
      .get();
    value = totalled.data().value;
  }`;
  }

  const limit = Number(config.limit ?? 100);
  const orderBy = String(config.orderBy ?? '').trim();
  const order = orderBy
    ? `    query = query.orderBy(${field(orderBy, node)}, ${config.descending ? '"desc"' : '"asc"'});\n`
    : '';

  return `  {
${open}${order}    const found = await query.limit(${Number.isFinite(limit) ? limit : 100}).get();
    value = found.docs.map((doc) => ({ ${DOCUMENT_ID}: doc.id, ...doc.data() }));
  }`;
}

/**
 * The lines a route needs before any Firestore step runs.
 *
 * The app is initialised **once per module**, not once per request: a serverless function is
 * reused, and `initializeApp` throws on the second call. `getApps()` is what makes that safe
 * across a hot reload as well as across invocations.
 */
export function firestorePrelude(steps: readonly string[]): string {
  const body = steps.join('\n');
  const aggregates = body.includes('AggregateField.');

  return `import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { ${aggregates ? 'AggregateField, ' : ''}getFirestore } from 'firebase-admin/firestore';

// The service account is read by NAME from the environment; the key never enters the document,
// the snapshot, or this file (docs/05-guardrails.md #1).
const key = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT ?? '{}') as Record<string, string>;

// Once per module: a function is reused between requests, and initializeApp throws on a second
// call. The key file names its fields with underscores; a private key that travelled through an
// environment variable usually arrives with its newlines written out, so they are put back.
const app =
  getApps()[0] ??
  initializeApp({
    credential: cert({
      projectId: key.project_id ?? key.projectId ?? '',
      clientEmail: key.client_email ?? key.clientEmail ?? '',
      privateKey: (key.private_key ?? key.privateKey ?? '').replace(/\\\\n/g, '\\n'),
    }),
  });
const db = getFirestore(app);
`;
}
