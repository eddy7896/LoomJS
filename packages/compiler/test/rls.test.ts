import { describe, expect, it } from 'vitest';
import { compile } from '../src/index';
import { CompileError } from '../src/types';
import { crudSnapshot } from './fixtures';
import {
  BREACH_PATH,
  MEMBERSHIP_FN,
  PRIVATE_SCHEMA,
  RLS_PATH,
  emitRlsMigration,
} from '../src/emit/rls';
import type { Snapshot, Tenancy } from '@loom/ir';

/**
 * Row-level security (O3, `docs/V1-COMPLETION.md`).
 *
 * **The gate is a breach that must fail**, and it cannot be closed here: proving that user A's
 * session cannot read organisation B's rows needs a live Postgres with these policies applied.
 * `scripts/rls-breach.mjs` in the emitted repo is that test, and it is the one that actually
 * settles it.
 *
 * What is asserted below is everything a live database would be too late to tell you: that the
 * policies exist for every operation, that the recursion trap is avoided, and that the definer
 * function is not itself a way in. Each of these produces SQL that *runs* — so none of them would
 * fail loudly at deploy time. They would fail quietly, as a boundary that is not one.
 */

const TENANCY: Tenancy = {
  orgTable: 'orgs',
  membershipTable: 'memberships',
  tenantColumn: 'org_id',
  userColumn: 'user_id',
  roleColumn: 'role',
  scopedTables: ['notes'],
};

const tenanted = (overrides: Partial<Tenancy> = {}): Snapshot => ({
  ...crudSnapshot(),
  tenancy: { ...TENANCY, ...overrides },
});

const sqlFor = (snapshot: Snapshot = tenanted()): string => emitRlsMigration(snapshot)!.content;

describe('the database is what refuses', () => {
  it('turns row-level security on for every table that holds an organisation’s rows', () => {
    const sql = sqlFor();
    expect(sql).toContain('alter table public."notes" enable row level security;');
    expect(sql).toContain('alter table public."memberships" enable row level security;');
    expect(sql).toContain('alter table public."orgs" enable row level security;');
  });

  /**
   * Postgres does not accept several operations in one `for` clause, so a policy per operation is
   * not a style choice — a table with only a `select` policy silently refuses every write.
   */
  it('writes a policy for each of the four operations', () => {
    const sql = sqlFor();
    for (const operation of ['for select', 'for insert', 'for update', 'for delete']) {
      expect(sql, operation).toContain(operation);
    }
  });

  /**
   * `using` decides which rows may be touched; `with check` decides what they may become. An
   * update with only the first lets a row be moved *out of* the organisation it belonged to —
   * which reads as a deletion to everyone who could see it, and as an appearance to everyone who
   * now can.
   */
  it('gives update both halves, so a row cannot be moved out of its organisation', () => {
    const sql = sqlFor();
    // Anchor on the *create*, not the `drop policy if exists` that precedes it.
    const update = sql.slice(sql.indexOf('create policy "loom_notes_update"'));
    const body = update.slice(0, update.indexOf(';'));
    expect(body).toContain('using');
    expect(body).toContain('with check');
  });

  it('names the role every policy applies to', () => {
    const sql = sqlFor();
    // Never left implicit: a policy with no `to` applies to every role, `anon` included. The
    // grant on the helper names the same role and is not a policy, so it is not counted here.
    const policies = sql.match(/create policy/g)!.length;
    const scoped = sql.match(/^to authenticated$/gm)!.length;
    expect(scoped).toBe(policies);
  });

  it('wraps auth.uid() so it is evaluated once per statement, not once per row', () => {
    expect(sqlFor()).toContain('(select auth.uid())');
  });
});

describe('the definer function is not itself a way in', () => {
  /**
   * "Rows in an organisation you belong to" means reading the membership table, whose own policies
   * Postgres then evaluates — which is `42P17 infinite recursion detected in policy`.
   */
  it('breaks the recursion with a security definer function', () => {
    const sql = sqlFor();
    expect(sql).toContain('security definer');
    expect(sql).toContain(`create or replace function ${MEMBERSHIP_FN}()`);
  });

  /**
   * The exploit this prevents: without a pinned search path, a caller points an unqualified name
   * at an object of their own and it runs with the function owner's privileges.
   */
  it('pins an empty search path and schema-qualifies what it reads', () => {
    const sql = sqlFor();
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain('from public."memberships"');
  });

  /**
   * A definer function in an exposed schema is callable over the Data API **as its owner**, which
   * hands out precisely the privilege it exists to contain.
   */
  it('keeps it out of a schema the API exposes', () => {
    const sql = sqlFor();
    expect(MEMBERSHIP_FN.startsWith(`${PRIVATE_SCHEMA}.`)).toBe(true);
    expect(PRIVATE_SCHEMA).not.toBe('public');
    expect(sql).toContain(
      `revoke all on schema ${PRIVATE_SCHEMA} from public, anon, authenticated`,
    );
    expect(sql).toContain('revoke all on function');
  });

  /**
   * The membership table's own policy must not call the helper that reads it — that is the
   * recursion the helper exists to prevent, put straight back.
   */
  it('reads the membership table directly in its own policy', () => {
    const sql = sqlFor();
    const block = sql.slice(sql.indexOf('create policy "loom_membership_select"'));
    const body = block.slice(0, block.indexOf(';'));
    expect(body).toContain('(select auth.uid())');
    expect(body).not.toContain(MEMBERSHIP_FN);
  });
});

describe('what it refuses to emit', () => {
  it('refuses policies it cannot write, rather than writing ones that do nothing', () => {
    expect(() => compile(tenanted({ userColumn: undefined }))).toThrow(CompileError);
    expect(() => compile(tenanted({ userColumn: undefined }))).toThrow(/names the person/);
  });

  /**
   * Scoping the membership table by the thing the membership table decides is circular. It would
   * emit, run, and lock everybody out of the lookup that tells the database who they are.
   */
  it('refuses to scope the tables that decide who belongs where', () => {
    expect(() => compile(tenanted({ scopedTables: ['memberships'] }))).toThrow(/its own rule/);
    expect(() => compile(tenanted({ scopedTables: ['orgs'] }))).toThrow(/its own rule/);
  });

  /** A file of policies over no tables looks like protection and is not. */
  it('emits nothing when no table has been marked as belonging to an organisation', () => {
    expect(emitRlsMigration(tenanted({ scopedTables: [] }))).toBeUndefined();
    expect(emitRlsMigration(crudSnapshot())).toBeUndefined();
  });
});

/**
 * The script that actually settles the gate.
 *
 * It cannot be *run* here — that needs a live database with two people in two organisations — so
 * what is checked is that it exists, that it is real JavaScript, and that it fails loudly rather
 * than reporting a pass nobody earned.
 */
describe('the breach attempt ships with the policies', () => {
  const breach = () => compile(tenanted()).files.find((file) => file.path === BREACH_PATH)!;

  it('is emitted beside the migration', () => {
    expect(breach()).toBeDefined();
  });

  /**
   * It is generated code full of quotes and regexes, and an escaping slip would ship a file that
   * looks right and throws on the first line — the last place anyone would find it is while
   * checking whether their app leaks data.
   */
  it('parses as real JavaScript', async () => {
    const { transform } = await import('esbuild');
    await expect(
      transform(breach().content, { loader: 'js', format: 'esm' }),
    ).resolves.toBeDefined();
  });

  it('asks the database directly, with no filter, the way a stranger would', () => {
    const content = breach().content;
    expect(content).toContain('/rest/v1/');
    expect(content).toContain('select=*');
    expect(content).toContain('/auth/v1/token?grant_type=password');
  });

  /**
   * Zero rows on both sides is what a working policy and a broken one look like alike. Reporting
   * that as a pass is the shape of a security test that never worked.
   */
  it('calls an empty result inconclusive rather than a pass', () => {
    const content = breach().content;
    expect(content).toContain('INCONCLUSIVE');
    expect(content).toContain('proved nothing');
  });

  it('exits non-zero when a table does not hold', () => {
    const content = breach().content;
    expect(content).toContain('LEAK on');
    expect(content).toContain('process.exit(1)');
    expect(content).toContain('Do not ship this');
  });
});

describe('the project owns it', () => {
  it('lands in the repo as ordinary SQL, not behind a button', () => {
    const file = compile(tenanted()).files.find((entry) => entry.path === RLS_PATH);
    expect(file).toBeDefined();
    expect(file!.path.endsWith('.sql')).toBe(true);
    // Somebody has to be able to read the rules that decide who sees what.
    expect(file!.content).toContain('read it first');
  });

  it('can be run again without hand-editing it first', () => {
    const sql = sqlFor();
    expect(sql.match(/drop policy if exists/g)!.length).toBe(sql.match(/create policy/g)!.length);
    expect(sql).toContain('create schema if not exists');
    expect(sql).toContain('create or replace function');
  });
});
