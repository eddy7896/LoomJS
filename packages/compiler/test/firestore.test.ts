import { describe, expect, it } from 'vitest';
import { applyOps, type Op, type Snapshot } from '@loom/ir';
import { createQueryNode, parseSampledDocs, firestoreType } from '@loom/connectors';
import { compile } from '../src/index';
import { firestoreSnapshot, firestoreOperationsSnapshot } from './fixtures';

/**
 * The Firestore connector (`docs/14-data.md`).
 *
 * A document store under a vocabulary of tables. Most of these are about the seams where the two
 * do not line up — the document id, the missing substring search, the two aggregates Firestore
 * does not have — because that is where a builder is tempted to paper over the difference and
 * ship something that fails when it runs rather than when it compiles.
 */

const routeFor = (snapshot: Snapshot, path: string): string => {
  const file = compile(snapshot).files.find((entry) => entry.path === path);
  if (!file) throw new Error(`no ${path} emitted`);
  return file.content;
};

const narrowed = (operator: string): Snapshot =>
  applyOps(firestoreSnapshot(), [
    {
      type: 'setNodeConfig',
      nodeId: 'nd_select',
      config: {
        connectorId: 'cn_supabase',
        table: 'notes',
        operation: 'select',
        filters: [{ column: 'title', operator, source: 'value', value: 'draft' }],
      },
    },
  ]);

describe('reading a collection', () => {
  const code = routeFor(firestoreSnapshot(), 'api/notes.ts');

  it('starts the app once, not once per request', () => {
    expect(code).toContain('getApps()[0] ??');
    expect(code).toContain('initializeApp({');
  });

  it('reads the key by name, and never carries the value', () => {
    expect(code).toContain('process.env.FIREBASE_SERVICE_ACCOUNT');
    expect(code).not.toContain('BEGIN PRIVATE KEY');
  });

  it('puts the document id on the row, because it is not a field in the document', () => {
    expect(code).toContain('found.docs.map((doc) => ({ id: doc.id, ...doc.data() }))');
  });

  it('narrows with a real query rather than reading everything and filtering', () => {
    const code = routeFor(narrowed('equals'), 'api/notes.ts');
    expect(code).toContain('query.where("title", "==", "draft")');
  });

  it('refuses a substring search instead of quietly reading the whole collection', () => {
    expect(() => compile(narrowed('contains'))).toThrow(/no "contains" search/);
  });
});

describe('writing a document', () => {
  it('never stores the id as a field of the document it identifies', () => {
    const code = routeFor(firestoreOperationsSnapshot(), 'api/updatenotes.ts');
    expect(code).toContain('const { id: id, ...fields }');
    expect(code).toContain('db.collection("notes").doc(String(id))');
  });

  it('answers with the row it removed, as every other connector does', () => {
    const code = routeFor(firestoreOperationsSnapshot(), 'api/deletenotes.ts');
    // Read, then delete: after the delete there is nothing left to answer with.
    expect(code.indexOf('await doc.get()')).toBeLessThan(code.indexOf('await doc.delete()'));
    expect(code).toContain('That row was not found.');
  });

  it('saves with a merge when the id is known and lets Firestore name it when it is not', () => {
    const code = routeFor(firestoreOperationsSnapshot(), 'api/upsertnotes.ts');
    expect(code).toContain('doc.set(fields, { merge: true })');
    expect(code).toContain('.add(fields)');
  });
});

describe('what Firestore cannot do', () => {
  it('counts and totals with the aggregates it has', () => {
    expect(routeFor(firestoreOperationsSnapshot(), 'api/countnotes.ts')).toContain(
      'query.count().get()',
    );
    expect(routeFor(firestoreOperationsSnapshot(), 'api/aggregatenotes.ts')).toContain(
      'AggregateField.sum("weight")',
    );
  });

  it('refuses min and max, which are not Firestore aggregates', () => {
    const withMin = applyOps(firestoreSnapshot(), [
      {
        type: 'setNodeConfig',
        nodeId: 'nd_select',
        config: {
          connectorId: 'cn_supabase',
          table: 'notes',
          operation: 'aggregate',
          fn: 'min',
          column: 'weight',
        },
      },
    ]);
    expect(() => compile(withMin)).toThrow(/no "min"/);
  });

  it('refuses a written statement, because there is no statement to run', () => {
    const ops: Op[] = [
      { type: 'removeNode', nodeId: 'nd_select' },
      {
        type: 'addNode',
        node: {
          ...createQueryNode('nd_q', { x: 0, y: 0 }, 'cn_supabase'),
          config: { connectorId: 'cn_supabase', sql: 'SELECT 1', returns: 'many' },
        },
      },
      {
        type: 'setNodeConfig',
        nodeId: 'nd_read',
        config: { method: 'POST', path: 'notes', body: ['nd_q'] },
      },
    ];
    expect(() => compile(applyOps(firestoreSnapshot(), ops))).toThrow(/does not run statements/);
  });

  it('refuses a field name it did not learn from a document', () => {
    const odd = applyOps(firestoreSnapshot(), [
      {
        type: 'setNodeConfig',
        nodeId: 'nd_select',
        config: {
          connectorId: 'cn_supabase',
          table: 'notes',
          operation: 'select',
          orderBy: 'title"; drop',
        },
      },
    ]);
    expect(() => compile(odd)).toThrow(/not a field name this connector can address/);
  });
});

describe('what the project installs', () => {
  it('carries the admin SDK and no SQL driver', () => {
    const pkg = routeFor(firestoreSnapshot(), 'package.json');
    expect(pkg).toContain('firebase-admin');
    expect(pkg).not.toContain('"pg"');
    expect(pkg).not.toContain('@supabase/postgrest-js');
  });

  it('asks the deployment for the key by name', () => {
    expect(routeFor(firestoreSnapshot(), '.env.example')).toBe('FIREBASE_SERVICE_ACCOUNT=\n');
  });
});

describe('learning what a collection holds', () => {
  it('gathers sampled documents into collections with typed fields', () => {
    const tables = parseSampledDocs([
      { collection: 'notes', id: 'a', fields: { title: 'One', weight: 2, done: false } },
      { collection: 'notes', id: 'b', fields: { title: 'Two', tags: ['x'] } },
      { collection: 'authors', id: 'c', fields: { name: 'Ada' } },
    ]);

    expect(tables.map((table) => table.name)).toEqual(['authors', 'notes']);
    const notes = tables.find((table) => table.name === 'notes')!;
    // Every field any sampled document carried, plus the id — which is the key.
    expect(notes.columns.map((column) => column.name)).toEqual([
      'id',
      'done',
      'tags',
      'title',
      'weight',
    ]);
    expect(notes.columns[0]).toMatchObject({ primaryKey: true, generated: true });
    expect(notes.columns.find((column) => column.name === 'weight')?.type).toEqual({
      kind: 'number',
    });
  });

  it('asks for nothing, because a document store has no required field', () => {
    const [notes] = parseSampledDocs([
      { collection: 'notes', id: 'a', fields: { title: 'One' } },
    ]);
    expect(notes!.columns.every((column) => !column.required)).toBe(true);
  });

  it('says so when there is nothing to sample rather than showing an empty list', () => {
    expect(() => parseSampledDocs([])).toThrow(/no collections with documents/);
  });

  it('recognises a timestamp by its shape, and leaves what it cannot place as unknown', () => {
    expect(firestoreType({ _seconds: 1, _nanoseconds: 0 })).toEqual({ kind: 'date' });
    expect(firestoreType({ seconds: 1, nanoseconds: 0 })).toEqual({ kind: 'date' });
    expect(firestoreType({ latitude: 1, longitude: 2 })).toEqual({ kind: 'record' });
    expect(firestoreType(null)).toEqual({ kind: 'unknown' });
  });
});
