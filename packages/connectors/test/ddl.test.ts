import { describe, expect, it } from 'vitest';
import {
  checkStatement,
  confirmationFor,
  identifier,
  isDestructive,
  literal,
  planChange,
  type SchemaChange,
} from '../src/ddl';

/**
 * Schema authoring (`docs/15-schema.md`).
 *
 * DDL takes no parameters, so a table name typed into a box becomes part of a statement. These
 * are mostly about that: what is refused, what is quoted, and what a designer has to do on
 * purpose before anything is destroyed.
 */

const only = (change: SchemaChange): string => {
  const statements = planChange(change);
  expect(statements).toHaveLength(1);
  return statements[0]!;
};

describe('a name typed into a box', () => {
  it('is quoted, so the database reads it as a name and nothing else', () => {
    expect(identifier('notes')).toBe('"notes"');
    expect(identifier('  notes  ')).toBe('"notes"');
  });

  it('is refused when it is not a name', () => {
    expect(() => identifier('notes; drop table users')).toThrow(/cannot be used as a name/);
    expect(() => identifier('my notes')).toThrow(/cannot be used as a name/);
    expect(() => identifier('"notes"')).toThrow(/cannot be used as a name/);
    expect(() => identifier('1st')).toThrow(/cannot be used as a name/);
    expect(() => identifier('')).toThrow(/cannot be used as a name/);
  });

  it('is refused when the database would silently shorten it', () => {
    expect(() => identifier('a'.repeat(64))).toThrow(/stop at 63 characters/);
    expect(identifier('a'.repeat(63))).toBe(`"${'a'.repeat(63)}"`);
  });
});

describe('a default value', () => {
  it('has to be what its column holds', () => {
    expect(literal('wholeNumber', '42')).toBe('42');
    expect(literal('decimal', '1.5')).toBe('1.5');
    expect(literal('boolean', 'TRUE')).toBe('true');
    expect(literal('text', 'draft')).toBe("'draft'");
    expect(literal('structured', '{"a":1}')).toBe(`'{"a":1}'::jsonb`);
  });

  it('is refused when it is not', () => {
    expect(() => literal('wholeNumber', 'soon')).toThrow(/is not a number/);
    expect(() => literal('wholeNumber', '1.5')).toThrow(/not a whole number/);
    expect(() => literal('boolean', 'yes')).toThrow(/true or false/);
    expect(() => literal('structured', '{a:1}')).toThrow(/not valid JSON/);
    expect(() => literal('timestamp', 'whenever')).toThrow(/not a date loom can read/);
  });

  it('understands "now", because that is the one anybody wants', () => {
    expect(literal('timestamp', 'now')).toBe('now()');
    expect(literal('timestamp', 'CURRENT_TIMESTAMP')).toBe('now()');
    expect(literal('timestamp', '2026-01-31')).toBe(`'2026-01-31'::timestamptz`);
  });

  it('cannot end the statement it sits in', () => {
    // The quote doubling is the whole defence: a default is the one value that is not a parameter.
    expect(literal('text', "'; drop table notes; --")).toBe(`'''; drop table notes; --'`);
    expect(() => checkStatement(only({
      kind: 'setDefault',
      table: 'notes',
      column: 'title',
      type: 'text',
      value: "'; drop table notes; --",
    }))).not.toThrow();
  });
});

describe('making a table', () => {
  it('gives it a key that is honestly text at every layer', () => {
    const statement = only({
      kind: 'createTable',
      table: { name: 'notes', key: 'uuid', columns: [{ name: 'title', type: 'text', required: true }] },
    });
    expect(statement).toBe(
      'create table "notes" ("id" uuid primary key default gen_random_uuid(), "title" text not null)',
    );
  });

  it('offers a counting key for someone who wants readable ids', () => {
    const statement = only({
      kind: 'createTable',
      table: { name: 'notes', key: 'counter', columns: [] },
    });
    expect(statement).toContain('"id" integer primary key generated always as identity');
  });

  it('stores numbers as the types the driver hands back as numbers', () => {
    const statement = only({
      kind: 'createTable',
      table: {
        name: 'orders',
        key: 'uuid',
        columns: [
          { name: 'quantity', type: 'wholeNumber' },
          { name: 'total', type: 'decimal' },
        ],
      },
    });
    // Never bigint or numeric: pg hands both back as strings (see NUMBER_NOTE).
    expect(statement).toContain('"quantity" integer');
    expect(statement).toContain('"total" double precision');
    expect(statement).not.toContain('bigint');
    expect(statement).not.toContain('numeric');
  });

  it('writes a default and a requirement in the order the database expects', () => {
    const statement = only({
      kind: 'createTable',
      table: {
        name: 'notes',
        key: 'uuid',
        columns: [{ name: 'created', type: 'timestamp', required: true, defaultValue: 'now' }],
      },
    });
    expect(statement).toContain('"created" timestamptz default now() not null');
  });
});

describe('changing a table', () => {
  it('adds a column with everything it was given', () => {
    expect(
      only({
        kind: 'addColumn',
        table: 'notes',
        column: { name: 'slug', type: 'text', unique: true },
      }),
    ).toBe('alter table "notes" add column "slug" text unique');
  });

  it('casts explicitly when a column changes type, so the database decides if it can', () => {
    expect(only({ kind: 'retypeColumn', table: 'notes', column: 'count', to: 'wholeNumber' })).toBe(
      'alter table "notes" alter column "count" type integer using "count"::integer',
    );
  });

  it('turns a requirement on and off', () => {
    expect(only({ kind: 'setRequired', table: 'notes', column: 'title', required: true })).toContain(
      'set not null',
    );
    expect(
      only({ kind: 'setRequired', table: 'notes', column: 'title', required: false }),
    ).toContain('drop not null');
  });

  it('drops a default rather than setting it to nothing', () => {
    expect(
      only({ kind: 'setDefault', table: 'notes', column: 'title', type: 'text', value: '' }),
    ).toContain('drop default');
  });

  it('names a unique constraint the way Postgres does, so dropping it finds it again', () => {
    expect(only({ kind: 'setUnique', table: 'notes', column: 'slug', unique: true })).toContain(
      'add constraint "notes_slug_key" unique ("slug")',
    );
    expect(only({ kind: 'setUnique', table: 'notes', column: 'slug', unique: false })).toContain(
      'drop constraint "notes_slug_key"',
    );
  });

  it('refuses to take dependents down with a dropped table', () => {
    // No `cascade`: failing loudly beats removing something the designer did not name.
    expect(only({ kind: 'dropTable', table: 'notes' })).toBe('drop table "notes"');
  });
});

describe('losing data on purpose', () => {
  it('knows which changes destroy something', () => {
    expect(isDestructive({ kind: 'dropTable', table: 'notes' })).toBe(true);
    expect(isDestructive({ kind: 'dropColumn', table: 'notes', column: 'body' })).toBe(true);
    expect(isDestructive({ kind: 'renameTable', from: 'notes', to: 'posts' })).toBe(false);
  });

  it('asks for the name of the thing being destroyed', () => {
    expect(confirmationFor({ kind: 'dropColumn', table: 'notes', column: 'body' })).toBe('body');
    expect(confirmationFor({ kind: 'dropTable', table: 'notes' })).toBe('notes');
    expect(confirmationFor({ kind: 'renameTable', from: 'a', to: 'b' })).toBeUndefined();
  });
});

describe('what the dev server agrees to run', () => {
  it('accepts the statements this file builds', () => {
    const changes: SchemaChange[] = [
      { kind: 'createTable', table: { name: 'notes', key: 'uuid', columns: [] } },
      { kind: 'addColumn', table: 'notes', column: { name: 'title', type: 'text' } },
      { kind: 'dropTable', table: 'notes' },
    ];
    for (const change of changes) expect(() => checkStatement(only(change))).not.toThrow();
  });

  it('refuses anything that is not a schema change', () => {
    expect(() => checkStatement('select * from users')).toThrow(/not a schema change/);
    expect(() => checkStatement('grant all on notes to public')).toThrow(/not a schema change/);
  });

  it('refuses a second statement hidden behind a semicolon', () => {
    expect(() => checkStatement('drop table "notes"; drop table "users"')).toThrow(
      /is one statement/,
    );
  });
});
