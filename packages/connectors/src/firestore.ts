import type { TypeRef } from '@loom/ir';
import { ConnectorError, type ColumnSchema, type ModuleManifest, type TableSchema } from './module';

/**
 * The Firestore connector (`docs/14-data.md`).
 *
 * Firestore is a **document store**, and loom's vocabulary is tables with typed columns. That is
 * a real difference, not a wrapper's worth of work, so the mapping is written down rather than
 * implied:
 *
 * - a **collection** is a table, and a **document** is a row;
 * - the document **id** is the primary key — it is not a field inside the document, so it is
 *   added to every row on the way out and taken back off on the way in;
 * - a **field** is a column, learnt by *sampling* documents rather than read from a schema,
 *   because there is no schema to read.
 *
 * Sampling is the honest weak point. A field no sampled document happened to carry is a column
 * loom does not know about, and a field two documents disagree about the type of is reported as
 * the type of the first one that had a value. Nothing here pretends otherwise: the columns are
 * what was *seen*, and the panel says how many documents were looked at.
 *
 * Two things Firestore cannot do, which are refused rather than approximated:
 * **`contains`** — there is no substring match in a Firestore query, and faking it by reading
 * every document and filtering in the function would be a search that silently costs a full
 * collection read. **`min` and `max`** — Firestore aggregates are `count`, `sum` and `average`
 * only (verified against the aggregation-queries documentation).
 */

export const FIREBASE_MANIFEST: ModuleManifest = {
  id: 'firestore',
  label: 'Firestore',
  kind: 'connector',
  config: [
    {
      key: 'projectId',
      label: 'Project ID',
      placeholder: 'my-app-1234',
    },
  ],
  credentials: [
    {
      name: 'FIREBASE_SERVICE_ACCOUNT',
      label: 'Service account JSON',
      scope: 'server',
      hint: 'The whole key file, pasted. It holds a private key, so it never leaves the server.',
    },
  ],
};

/** How many documents are read to work out what a collection holds. */
export const SAMPLE_SIZE = 25;

/** The column every collection has, which is not a field in any of its documents. */
export const DOCUMENT_ID = 'id';

/** One sampled document: its id, and whatever fields it happened to carry. */
export interface SampledDoc {
  collection: string;
  id: string;
  fields: Record<string, unknown>;
}

/**
 * A value's type, as loom's vocabulary sees it.
 *
 * Firestore's own wrappers (a Timestamp, a GeoPoint, a DocumentReference) arrive as objects; only
 * the timestamp has a loom type, and it is recognised by shape rather than by `instanceof`, since
 * this runs on rows that have already crossed a wire as JSON.
 */
export function firestoreType(value: unknown): TypeRef {
  if (typeof value === 'string') return { kind: 'text' };
  if (typeof value === 'number') return { kind: 'number' };
  if (typeof value === 'boolean') return { kind: 'boolean' };
  if (Array.isArray(value)) return { kind: 'list', of: { kind: 'unknown' } };

  if (value && typeof value === 'object') {
    const shape = value as Record<string, unknown>;
    const timestamp =
      (typeof shape._seconds === 'number' && typeof shape._nanoseconds === 'number') ||
      (typeof shape.seconds === 'number' && typeof shape.nanoseconds === 'number');
    return timestamp ? { kind: 'date' } : { kind: 'record' };
  }

  // `null` in a document says the field exists and holds nothing, which is not a type.
  return { kind: 'unknown' };
}

/**
 * The sampled documents, gathered into the collections a designer sees.
 *
 * A field is `required: false` throughout, and that is not laziness: a document store has no
 * column that must be present, so a form that demanded one would be enforcing a rule the
 * database does not have.
 */
export function parseSampledDocs(docs: readonly SampledDoc[]): TableSchema[] {
  if (docs.length === 0) {
    throw new ConnectorError(
      'Connected, but this project holds no collections with documents in them. Firestore learns ' +
        'what a collection holds by reading it, so an empty one has nothing to show yet.',
    );
  }

  const collections = new Map<string, Map<string, TypeRef>>();

  for (const doc of docs) {
    const seen = collections.get(doc.collection) ?? new Map<string, TypeRef>();
    collections.set(doc.collection, seen);

    for (const [field, value] of Object.entries(doc.fields)) {
      if (value === null || value === undefined) continue;
      const already = seen.get(field);
      // The first document that had a value decides the type; a later disagreement is left
      // alone rather than widened to `unknown`, which would lose the useful case to the rare one.
      if (!already || already.kind === 'unknown') seen.set(field, firestoreType(value));
    }
  }

  return [...collections]
    .map(([name, fields]) => ({
      name,
      columns: [
        // The document id: written by the database when it makes one, supplied when it does not.
        {
          name: DOCUMENT_ID,
          type: { kind: 'text' } as TypeRef,
          required: false,
          primaryKey: true,
          generated: true,
        } satisfies ColumnSchema,
        ...[...fields]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(
            ([field, type]): ColumnSchema => ({
              name: field,
              type,
              required: false,
              primaryKey: false,
              generated: false,
            }),
          ),
      ],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** What a service account key has to look like before it is worth opening a connection with. */
export function checkServiceAccount(json: string): { projectId: string } {
  const text = json.trim();
  if (!text) throw new ConnectorError('A service account key is required.');

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new ConnectorError('That is not the JSON key file — paste the whole file, braces and all.');
  }

  const projectId = String(parsed.project_id ?? '');
  if (!projectId || typeof parsed.private_key !== 'string') {
    throw new ConnectorError(
      'That JSON is missing "project_id" or "private_key". Download a new private key from ' +
        'Project settings → Service accounts.',
    );
  }

  return { projectId };
}
