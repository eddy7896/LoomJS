import { MYSQL_MANIFEST, POSTGRES_MANIFEST } from './sql';
import { SUPABASE_MANIFEST } from './supabase';
import type { ModuleManifest } from './module';

/**
 * The connectors a project can attach (`docs/06-glossary.md`).
 *
 * Three, and they are three *ways of reaching* data rather than three data models: every one of
 * them ends up as tables with typed columns and a primary key, which is why the node vocabulary
 * does not grow when one is added. A connector that could not be described that way — a document
 * store, say — would need its own nodes, and that is a decision rather than an integration.
 */
export const MODULES: readonly ModuleManifest[] = [SUPABASE_MANIFEST, POSTGRES_MANIFEST];

/**
 * MySQL is described here but not offered yet.
 *
 * Reading it works — `information_schema` answers in nearly the same words — but writing to it
 * does not: MySQL has no `RETURNING`, so an insert has to be followed by a read of the row it
 * made, and that read is a different statement for an auto-increment key than for a supplied one.
 * A connector that reads but silently mangles writes is worse than one that is not there, so it
 * waits for that work rather than shipping half of it.
 */
export const PLANNED: readonly ModuleManifest[] = [MYSQL_MANIFEST];

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
