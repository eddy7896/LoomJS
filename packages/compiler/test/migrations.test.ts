import { describe, expect, it } from 'vitest';
import { applyOps, type Snapshot } from '@loom/ir';
import { compile } from '../src/index';
import { slug } from '../src/emit/migrations';
import { postgresSnapshot } from './fixtures';

/**
 * Migrations in the emitted repo (`docs/15-schema.md`).
 *
 * The studio changes a schema against one live database. A second environment has never seen
 * those changes, and a colleague cloning the repo gets an app whose queries reference columns
 * that are not there — so the same statements, in the same order, come with the repo.
 */

const withMigrations = (): Snapshot =>
  applyOps(postgresSnapshot(), [
    {
      type: 'recordMigration',
      migration: {
        id: 'mg_one',
        index: 1,
        description: 'create table notes',
        appliedAt: '2026-08-23T10:00:00.000Z',
        statements: ['create table "notes" ("id" uuid primary key default gen_random_uuid())'],
      },
    },
    {
      type: 'recordMigration',
      migration: {
        id: 'mg_two',
        index: 2,
        description: 'add column body to notes',
        appliedAt: '2026-08-23T10:05:00.000Z',
        statements: ['alter table "notes" add column "body" text'],
      },
    },
  ]);

const fileAt = (snapshot: Snapshot, path: string): string => {
  const file = compile(snapshot).files.find((entry) => entry.path === path);
  if (!file) throw new Error(`no ${path} emitted`);
  return file.content;
};

describe('the migrations a project carries', () => {
  it('numbers them so any runner finds them in order', () => {
    const paths = compile(withMigrations())
      .files.map((file) => file.path)
      .filter((path) => path.startsWith('migrations/'));

    expect(paths).toEqual([
      'migrations/0001_create_table_notes.sql',
      'migrations/0002_add_column_body_to_notes.sql',
    ]);
  });

  it('is plain SQL, with what it did and when at the top', () => {
    const content = fileAt(withMigrations(), 'migrations/0002_add_column_body_to_notes.sql');
    expect(content).toContain('-- add column body to notes');
    expect(content).toContain('-- Applied 2026-08-23T10:05:00.000Z by loom.');
    expect(content).toContain('alter table "notes" add column "body" text;');
  });

  it('emits nothing for a project that never changed a schema', () => {
    const paths = compile(postgresSnapshot())
      .files.map((file) => file.path)
      .filter((path) => path.startsWith('migrations/'));
    expect(paths).toEqual([]);
  });

  it('turns a description into a filename without losing what it says', () => {
    expect(slug('add column body to notes')).toBe('add_column_body_to_notes');
    expect(slug('rename notes.title to heading')).toBe('rename_notes_title_to_heading');
    expect(slug('!!!')).toBe('change');
  });
});
