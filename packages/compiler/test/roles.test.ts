import { describe, expect, it } from 'vitest';
import { compile } from '../src/index';
import { CompileError } from '../src/types';
import { crudSnapshot } from './fixtures';
import type { Snapshot, Tenancy } from '@loom/ir';

/**
 * Roles (O2, `docs/V1-COMPLETION.md`).
 *
 * The gate: **a teacher opening an admin route is redirected, and an admin-only button is absent
 * from the teacher's DOM — not hidden.**
 *
 * "Absent, not hidden" is the half worth being precise about. An element that renders and is then
 * hidden with CSS still occupies layout, still takes focus, and still ships its contents to
 * everyone — which for a panel built for somebody else is a leak wearing a `display: none`.
 *
 * What this phase is **not**: a data boundary. A role decides which screens mount and which
 * elements render. What the database returns is decided by its policies (O3), and per-table role
 * rules are not expressible yet — so a role here is about what somebody is shown, never about what
 * they could fetch.
 */

const TENANCY: Tenancy = {
  orgTable: 'orgs',
  membershipTable: 'memberships',
  tenantColumn: 'org_id',
  userColumn: 'user_id',
  roleColumn: 'role',
  scopedTables: ['notes'],
};

/** The CRUD fixture, organised by tenant, with roles and a guarded screen. */
function withRoles(options: { requireRole?: string[]; roles?: string[] } = {}): Snapshot {
  const base = crudSnapshot();
  const [first] = Object.keys(base.artboards);

  // Somewhere unguarded to be sent to. A guard pointing at a guarded screen is a bounce with no
  // floor, and the compiler already refuses it.
  const outsideRoot = { id: 'cp_outside', type: 'Frame', props: {}, children: [] };

  return {
    ...base,
    tenancy: TENANCY,
    roles: options.roles ?? ['admin', 'teacher'],
    components: { ...base.components, cp_outside: outsideRoot },
    artboards: {
      ...base.artboards,
      ab_outside: { id: 'ab_outside', name: 'Sign in', root: 'cp_outside' },
      [first!]: {
        ...base.artboards[first!]!,
        guard: {
          redirectTo: 'ab_outside',
          ...(options.requireRole ? { requireRole: options.requireRole } : {}),
        },
      },
    },
  };
}

const appOf = (snapshot: Snapshot) =>
  compile(snapshot).files.find((file) => file.path === 'src/App.tsx')!.content;

const authOf = (snapshot: Snapshot) =>
  compile(snapshot).files.find((file) => file.path === 'src/state/auth.tsx')!.content;

describe('a screen only some roles may open', () => {
  it('carries the roles it is for into the router', () => {
    expect(appOf(withRoles({ requireRole: ['admin'] }))).toContain('roles={["admin"]}');
  });

  it('redirects anyone whose role is not one of them', () => {
    const auth = authOf(withRoles({ requireRole: ['admin'] }));
    expect(auth).toContain('roles.includes(auth.org?.role');
    expect(auth).toContain('<Navigate to={redirectTo} replace />');
  });

  /**
   * The role is read from the membership row by the server and handed down. A browser that could
   * name its own role could name any role.
   */
  it('reads the role from the session rather than from anything the browser sets', () => {
    const auth = authOf(withRoles({ requireRole: ['admin'] }));
    expect(auth).toContain('auth.org?.role');
    // Never off a prop, a query string or storage.
    expect(auth).not.toMatch(/localStorage|sessionStorage|searchParams/);
  });

  it('leaves an unrestricted guard exactly as it was', () => {
    const app = appOf(withRoles());
    expect(app).toContain('RequireSignIn');
    expect(app).not.toContain('roles={');
  });

  /**
   * Said in the emitted code, not just in the docs: this stops somebody landing on a screen built
   * for a different job. It is not what keeps the data private.
   */
  it('says in the code that it is not the boundary', () => {
    expect(authOf(withRoles({ requireRole: ['admin'] }))).toContain('rather than a boundary');
  });
});

describe('what a role guard is refused', () => {
  /**
   * A guard naming a role nobody has compiles, runs, and redirects every single person — which
   * reads as a broken route rather than as a typo, and is found by being bounced out of your own
   * admin screen.
   */
  it('refuses a role the project does not have', () => {
    expect(() => compile(withRoles({ requireRole: ['superuser'] }))).toThrow(CompileError);
    expect(() => compile(withRoles({ requireRole: ['superuser'] }))).toThrow(/does not have/);
  });

  it('says so differently when the project has no roles at all', () => {
    expect(() => compile(withRoles({ requireRole: ['admin'], roles: [] }))).toThrow(/no roles yet/);
  });

  /** A role is read from a membership row, so a role guard needs somewhere to read one from. */
  it('refuses a role guard in a project that is not organised by tenant', () => {
    const untenanted: Snapshot = { ...withRoles({ requireRole: ['admin'] }), tenancy: undefined };
    expect(() => compile(untenanted)).toThrow(/not organised by tenant/);
  });
});

describe('a role folded into a condition', () => {
  /**
   * "Only for admins" is a comparison against the current org's role, and a comparison is what a
   * Compare node is. Reading the session into a derivation used to be refused outright, with a
   * comment saying nothing needed it — roles are that demand.
   *
   * The alternative was a role check that lived only in the inspector, which is the second way of
   * saying a condition that `docs/10` refuses.
   */
  it('lets a Compare read the current org’s role', () => {
    const base = withRoles();
    const [screen] = Object.keys(base.artboards);
    const org = {
      id: 'nd_org',
      category: 'state' as const,
      kind: 'currentOrg',
      ports: [
        {
          id: 'pt_role',
          name: 'role',
          direction: 'out' as const,
          portKind: 'data' as const,
          type: { kind: 'text' as const },
        },
      ],
      position: { x: 0, y: 0 },
    };
    const compare = {
      id: 'nd_cmp',
      category: 'fn' as const,
      kind: 'compare',
      ports: [
        {
          id: 'pt_input',
          name: 'input',
          direction: 'in' as const,
          portKind: 'data' as const,
          type: { kind: 'any' as const },
        },
        {
          id: 'pt_result',
          name: 'result',
          direction: 'out' as const,
          portKind: 'data' as const,
          type: { kind: 'boolean' as const },
        },
      ],
      position: { x: 0, y: 0 },
      config: { operator: 'equals', rightKind: 'value', right: 'admin' },
    };

    const root = base.components[base.artboards[screen!]!.root]!;
    const secret = {
      id: 'cp_secret',
      type: 'Text',
      props: { content: { kind: 'static' as const, value: 'Admin only' } },
      visibleWhen: { source: { nodeId: 'nd_cmp', portId: 'pt_result' } },
    };

    const snapshot: Snapshot = {
      ...base,
      nodes: { ...base.nodes, nd_org: org, nd_cmp: compare },
      wires: {
        ...base.wires,
        wr_role: {
          id: 'wr_role',
          from: { nodeId: 'nd_org', portId: 'pt_role' },
          to: { nodeId: 'nd_cmp', portId: 'pt_input' },
        },
      },
      components: {
        ...base.components,
        cp_secret: secret,
        [root.id]: { ...root, children: [...(root.children ?? []), 'cp_secret'] },
      },
    };

    const files = compile(snapshot).files;
    const screenFile = files.find((file) => file.path.includes('/artboards/'))!;

    // The comparison reads the session the same way a bound property does.
    expect(screenFile.content).toContain('auth.org?.role');
    // And the module holds the session, which the derivation could not ask for itself.
    expect(screenFile.content).toContain('useAuth()');
  });

  /**
   * **Absent, not hidden.** An element rendered and then hidden still occupies layout, still takes
   * focus, and still ships its contents to everybody.
   */
  it('leaves the element out of the tree entirely', () => {
    const app = appOf(withRoles({ requireRole: ['admin'] }));
    expect(app).not.toContain('display: none');
    expect(app).not.toContain('visibility: hidden');
  });
});
