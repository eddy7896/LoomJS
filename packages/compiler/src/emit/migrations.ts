import type { Migration } from '@loom/ir';
import type { EmittedFile } from '../types';

/**
 * Migrations, emitted into the repo the user owns (`docs/15-schema.md`).
 *
 * The studio makes schema changes against a live database, which is fine while one person is
 * designing and useless the moment there is a second environment: staging has never seen them,
 * and a colleague cloning the repo gets an app whose queries reference columns that are not
 * there. So each change is also a numbered file — the same statements, in the same order,
 * runnable against a database that has never seen this project.
 *
 * They are **plain SQL with no runner**. A migration tool is a choice a team makes (and often
 * has already made), and loom generating one would be loom deciding. What is emitted works with
 * psql, with Supabase's CLI, and with anything that reads a directory of numbered files.
 */

/** `0001`, `0002` — sorted correctly by name, which is how every migration runner finds them. */
const sequence = (index: number): string => String(index).padStart(4, '0');

/** A description, as a filename fragment: lowercase words joined by underscores. */
export function slug(description: string): string {
  const words = description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return words.slice(0, 60) || 'change';
}

export function migrationFile(migration: Migration): EmittedFile {
  const newline = String.fromCharCode(10);
  const body = migration.statements.map((statement) => `${statement.trim()};`).join(newline);

  return {
    path: `migrations/${sequence(migration.index)}_${slug(migration.description)}.sql`,
    content:
      `-- ${migration.description}` +
      newline +
      `-- Applied ${migration.appliedAt} by loom.` +
      newline +
      newline +
      body +
      newline,
  };
}
