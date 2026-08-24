import { FIREBASE_MANIFEST } from './firestore';
import { MYSQL_MANIFEST, POSTGRES_MANIFEST } from './sql';
import { SUPABASE_MANIFEST } from './supabase';
import { AGGREGATE_FNS, type AggregateFn, type FilterOp } from './nodes';
import type { ModuleManifest } from './module';

/**
 * The connectors a project can attach (`docs/06-glossary.md`).
 *
 * Two of them are *ways of reaching* the same data model — Supabase over HTTP and Postgres over a
 * socket both end up as tables with typed columns and a primary key, which is why the node
 * vocabulary did not grow when the second was added.
 *
 * Firestore is the third, and it is genuinely a different model: a document store with no schema
 * to read. It is mapped rather than wrapped — collection to table, document to row, document id
 * to primary key, and the columns learnt by *sampling* documents — and the two things it cannot
 * do (`contains`, and `min`/`max`) are refused at compile time rather than approximated. That
 * mapping is written down in `firestore.ts`, because a mapping that lives only in someone's head
 * is how a builder starts lying about what the database will do.
 */
export const MODULES: readonly ModuleManifest[] = [
  SUPABASE_MANIFEST,
  POSTGRES_MANIFEST,
  MYSQL_MANIFEST,
  FIREBASE_MANIFEST,
];

/**
 * Nothing is waiting any more.
 *
 * MySQL was held back because it has no `RETURNING`: an insert could not answer with the row it
 * wrote, and a connector that reads but silently mangles writes is worse than one that is not
 * there. It now reads the row back — by the key that was supplied, or by the one the database
 * made — which costs a second round trip and makes the node mean the same thing it means
 * everywhere else (`docs/14-data.md`).
 */
export const PLANNED: readonly ModuleManifest[] = [];

/** True when this connector stores documents rather than rows, and so cannot do everything. */
export function isDocumentStore(moduleId: string): boolean {
  return moduleId === 'firestore';
}

/**
 * The comparisons a connector can make, and the totals it can work out.
 *
 * A panel that offers what the database cannot do turns a compile error into a dead end: the
 * designer picks it, sees a refusal, and has no way to know it was never available. So the
 * choices are narrowed at the point of choosing, and the compiler refuses anyway as the backstop.
 */
export function filterOpsFor(moduleId: string): FilterOp[] {
  const all: FilterOp[] = ['equals', 'notEquals', 'greaterThan', 'lessThan', 'contains'];
  // Firestore has no substring match, and reading a whole collection to fake one is not a search.
  return isDocumentStore(moduleId) ? all.filter((op) => op !== 'contains') : all;
}

export function aggregatesFor(moduleId: string): AggregateFn[] {
  // Firestore's aggregates are count, sum and average — verified against its documentation.
  return isDocumentStore(moduleId) ? ['sum', 'avg'] : [...AGGREGATE_FNS];
}

export function moduleFor(id: string): ModuleManifest | undefined {
  return MODULES.find((module) => module.id === id);
}

/** True when this module speaks SQL directly — the query editor is only offered on those. */
export function speaksSql(moduleId: string): boolean {
  return moduleId === 'postgres' || moduleId === 'mysql';
}

/** The dialect a module writes, for the emitter and the introspector. */
export function dialectOf(moduleId: string): 'postgres' | 'mysql' | undefined {
  if (moduleId === 'postgres') return 'postgres';
  if (moduleId === 'mysql') return 'mysql';
  return undefined;
}
