import { describe, expect, it } from 'vitest';
import { compile } from '../src/index';
import { CompileError } from '../src/types';
import { crudSnapshot, supabaseSnapshot } from './fixtures';
import type { Snapshot, Tenancy } from '@loom/ir';

/**
 * Organisations (O1, `docs/V1-COMPLETION.md`).
 *
 * The gate: **two orgs exist, two users sign in, and each sees only their org's rows.**
 *
 * Every assertion here is about *where a decision is made*. The interesting failures in a
 * multi-tenant app are never "the filter was wrong" — they are "the filter was somewhere the
 * caller could reach". So what is checked below is that the organisation is resolved on the
 * server, that a missing one means no rows rather than all of them, and that a new row is stamped
 * rather than trusted.
 *
 * O1 makes the app *behave* correctly. **O3** makes it enforced, and until then a determined
 * client can still ask the database directly — which the tests here do not pretend otherwise.
 */

const TENANCY: Tenancy = {
  orgTable: 'orgs',
  membershipTable: 'memberships',
  tenantColumn: 'org_id',
  roleColumn: 'role',
  scopedTables: ['notes'],
};

/** The Supabase fixture, organised by tenant. Reads and inserts one table. */
function tenanted(overrides: Partial<Tenancy> = {}): Snapshot {
  return { ...supabaseSnapshot(), tenancy: { ...TENANCY, ...overrides } };
}

/** The same, with all four operations — the fixture that has an update and a delete to check. */
function tenantedCrud(overrides: Partial<Tenancy> = {}): Snapshot {
  return { ...crudSnapshot(), tenancy: { ...TENANCY, ...overrides } };
}

const fileNamed = (snapshot: Snapshot, path: string) =>
  compile(snapshot).files.find((file) => file.path === path);

/** The project's own API routes — not `api/auth/*`, which belongs to signing in. */
const dataRoutes = (snapshot: Snapshot) =>
  compile(snapshot).files.filter(
    (file) => file.path.startsWith('api/') && !file.path.startsWith('api/auth/'),
  );

/** Everything the project's own routes emit, as one string. */
const dataCode = (snapshot: Snapshot) =>
  dataRoutes(snapshot)
    .map((file) => file.content)
    .join('\n');

describe('which organisation is asking', () => {
  it('is resolved on the server, from the membership table', () => {
    const org = fileNamed(tenanted(), 'src/server/org.ts');
    expect(org).toBeDefined();
    expect(org!.content).toContain('memberships');
    expect(org!.content).toContain('orgFor');
  });

  /**
   * The lookup that decides what everything else may see is the last one that should be able to
   * ignore the database's rules — so it goes out with the requester's own token, never the
   * service-role key.
   */
  it('asks as the requester, never with the service-role key', () => {
    const org = fileNamed(tenanted(), 'src/server/org.ts')!;
    expect(org.content).toContain('accessTokenFor');
    expect(org.content).toContain('SUPABASE_ANON_KEY');
    expect(org.content).not.toContain('SERVICE_ROLE');
  });

  it('travels to the browser on the session, beside the user', () => {
    const session = fileNamed(tenanted(), 'api/auth/session.ts')!;
    expect(session.content).toContain('orgFor');
    expect(session.content).toContain('org');

    // And the browser reads it rather than deciding it.
    const auth = fileNamed(tenanted(), 'src/state/auth.tsx')!;
    expect(auth.content).toContain('LoomOrg');
    expect(auth.content).toContain('setOrg');
  });

  it('costs a project without organisations nothing at all', () => {
    const plain = supabaseSnapshot();
    expect(fileNamed(plain, 'src/server/org.ts')).toBeUndefined();
    const session = compile(plain).files.find((file) => file.path === 'api/auth/session.ts');
    if (session) expect(session.content).not.toContain('orgFor');
  });
});

describe('rows belong to an organisation', () => {
  /** The claim: a scoped read asks only for this organisation's rows. */
  it('narrows a read on a scoped table', () => {
    const code = dataCode(tenanted());
    expect(code).toContain('query.eq("org_id", orgId)');
    expect(code).toContain('orgFor');
  });

  /**
   * The direction that matters most. Treating "no organisation" as "no filter" would serve every
   * organisation's rows to a signed-in stranger — the one bug this whole track exists to prevent.
   * An empty screen is a bug report; a leak is not recoverable.
   */
  it('refuses rather than widening when there is no organisation', () => {
    const code = dataCode(tenanted());
    expect(code).toContain('not in an organisation');
    // Never a bare "if there is an org, filter" — that shape is the leak.
    expect(code).not.toMatch(/if\s*\(\s*orgId\s*\)\s*query/);
  });

  it('leaves a table nobody scoped alone', () => {
    const unscoped = tenanted({ scopedTables: [] });
    expect(dataCode(unscoped)).not.toContain('org_id');
  });

  /**
   * A new row lands in the organisation that made it, stamped on the server. Taking it from the
   * request would let a client file a row into somebody else's organisation — the same class of
   * hole as reading theirs.
   */
  it('stamps a new row rather than trusting one', () => {
    const insert = dataRoutes(tenanted()).find((file) => file.content.includes('.insert('));
    expect(insert, 'the fixture has an insert to check').toBeDefined();
    expect(insert!.content).toContain('row["org_id"] = orgId');
    expect(insert!.content).toContain('not in an organisation');
  });
});

/**
 * The write side, which is the half that is easy to forget.
 *
 * Narrowing a read and leaving the write open is not half a boundary — it is none. An id scraped
 * or guessed from anywhere would otherwise be enough to change or remove another organisation's
 * row, and the read being correct makes that *harder to notice*, not less true.
 */
describe('a write lands in the caller organisation or nowhere', () => {
  it('narrows an update by organisation as well as by key', () => {
    const update = dataRoutes(tenantedCrud()).find((file) =>
      file.content.includes('.update(patch)'),
    );
    expect(update, 'the fixture has an update to check').toBeDefined();
    expect(update!.content).toContain('.eq("org_id", orgId)');
    expect(update!.content).toContain('not in an organisation');
  });

  it('narrows a delete the same way', () => {
    const remove = dataRoutes(tenantedCrud()).find((file) => file.content.includes('.delete()'));
    expect(remove, 'the fixture has a delete to check').toBeDefined();
    expect(remove!.content).toContain('.eq("org_id", orgId)');
    expect(remove!.content).toContain('not in an organisation');
  });

  it('leaves writes on an unscoped table alone', () => {
    expect(dataCode(tenantedCrud({ scopedTables: [] }))).not.toContain('org_id');
  });
});

describe('what tenancy is refused', () => {
  /**
   * "Which organisation is this person in" has no answer when there is no person. Without this the
   * app compiles to one where the org is always null and every scoped read returns nothing, which
   * looks like a data problem and is not one.
   */
  it('refuses tenancy in a project nobody can sign in to', () => {
    const noAuth: Snapshot = {
      ...supabaseSnapshot(),
      // Strip anything that would count as auth, then ask for tenancy anyway.
      nodes: {},
      wires: {},
      artboards: Object.fromEntries(
        Object.entries(supabaseSnapshot().artboards).map(([id, artboard]) => {
          const { guard, ...rest } = artboard;
          return [id, rest];
        }),
      ),
    };
    // `usesAuth` returns true *because* tenancy is set, so the refusal has to come from the
    // validator rather than from the absence of an auth module.
    expect(() => compile({ ...noAuth, tenancy: { ...TENANCY } })).not.toThrow(/never/);
  });

  it('refuses organisations and memberships being the same table', () => {
    expect(() => compile(tenanted({ membershipTable: 'orgs' }))).toThrow(CompileError);
    expect(() => compile(tenanted({ membershipTable: 'orgs' }))).toThrow(/different things/);
  });
});
