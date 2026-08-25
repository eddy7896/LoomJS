import type { Snapshot, Tenancy } from '@loom/ir';
import { CompileError } from '../types';

/**
 * Organisations (O1, `docs/V1-COMPLETION.md`), compiled.
 *
 * ## What multi-tenant actually means here
 *
 * A school, a company, a workspace. Rows belong to one of them, and a person from one must never
 * read another's. Four of the ten target app classes are multi-tenant by definition — school
 * management, ERP, CRM, B2B SaaS — and none of them is buildable without this.
 *
 * ## loom does not invent a tenancy model
 *
 * It **names tables the project already has**: which one holds the organisations, which one says
 * who belongs to which, and which column on everything else names the owner. That is the same rule
 * every connector follows — map what is there rather than wrap it — and it is what lets the
 * emitted app and the emitted row-level-security policies agree about where to look.
 *
 * ## The current org is resolved on the server, always
 *
 * It comes back from `/api/auth/session` beside the user, read out of the membership table with
 * the requester's own session. The browser is **told** which org it is in; it never says.
 *
 * A client that could name its own org is a client that could name somebody else's, and no amount
 * of care in the UI fixes that — which is why this is one server round trip rather than a value
 * the app keeps.
 *
 * ## This is not the security boundary
 *
 * O1 makes the app *behave* correctly: reads are scoped, and a person sees their own org's rows.
 * It is **O3** that makes that enforced, by emitting row-level-security policies so the database
 * refuses the request rather than the query merely not asking for it.
 *
 * Until O3 lands, a determined client can still reach another org's rows by asking directly. The
 * README says so, and the plan does not pretend otherwise.
 */

export const TENANCY_MODULE_PATH = 'src/server/org.ts';

/** The node that reads which organisation the person is in. */
export const CURRENT_ORG_KIND = 'currentOrg';

export function isCurrentOrg(node: { category: string; kind: string }): boolean {
  return node.category === 'state' && node.kind === CURRENT_ORG_KIND;
}

/** Is this project multi-tenant at all? Most are not, and pay nothing for this. */
export function tenancyOf(snapshot: Snapshot): Tenancy | undefined {
  return snapshot.tenancy;
}

export function usesTenancy(snapshot: Snapshot): boolean {
  return Boolean(snapshot.tenancy);
}

/** Does this table's rows belong to an organisation? Named by the project, never inferred. */
export function isScoped(tenancy: Tenancy | undefined, table: string): boolean {
  return Boolean(tenancy?.scopedTables?.includes(table));
}

/** The name the emitted handler holds the current organisation's id under. */
export const ORG_ID_VAR = 'orgId';

/**
 * Narrow a query to the organisation asking (O1).
 *
 * **No organisation means no rows.** That direction matters more than anything else here: the
 * failure mode of the opposite choice — treating "no org" as "no filter" — is every organisation's
 * rows served to a signed-in stranger, which is the one bug this whole track exists to prevent.
 * An empty screen is a bug report; a leak is not recoverable.
 *
 * Still not the boundary. This is the query declining to ask. **O3** makes the database refuse,
 * which is the difference between behaving correctly and being enforced.
 */
export function scopeFilter(tenancy: Tenancy, indent = '    '): string {
  return `
${indent}// Only this organisation's rows (O1). No organisation means none of them.
${indent}if (!${ORG_ID_VAR}) throw new Error('You are not in an organisation.');
${indent}query = query.eq(${JSON.stringify(tenancy.tenantColumn)}, ${ORG_ID_VAR});`;
}

/**
 * Tenancy needs users, and says so rather than emitting something that cannot work.
 *
 * "Which organisation is this person in" has no answer when there is no person. A project that
 * configures tenancy and has no way to sign in would compile to an app where the org is always
 * null and every scoped read returns nothing — which looks like a data problem and is not one.
 */
export function validateTenancy(snapshot: Snapshot, hasAuth: boolean): void {
  const tenancy = snapshot.tenancy;
  if (!tenancy) return;

  if (!hasAuth) {
    throw new CompileError(
      `This project is organised by "${tenancy.orgTable}", but nobody can sign in — so there is ` +
        `no way to tell which organisation anyone is in. Add a way to sign in, or turn tenancy off.`,
      snapshot.id,
    );
  }

  if (tenancy.orgTable === tenancy.membershipTable) {
    throw new CompileError(
      `The organisations and the memberships are both "${tenancy.orgTable}". They are different ` +
        `things: one is the organisation, the other is who belongs to it.`,
      snapshot.id,
    );
  }
}

/**
 * The server module that answers "which organisation is this person in".
 *
 * It reads the membership table **as the requester**, so the database's own rules apply to the
 * lookup as well. Asking with the service-role key would make this the one query in the app that
 * ignores them, which is precisely the query that must not.
 */
export function emitTenancyModule(tenancy: Tenancy): string {
  const role = tenancy.roleColumn;

  return `// Generated by @loom/compiler. Which organisation the person asking is in (O1).
// Managed region: edits here are overwritten on the next compile.
//
// Resolved here and never in the browser. A client that could name its own organisation could
// name somebody else's, and no amount of care in the interface fixes that.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { accessTokenFor } from './auth';

export interface LoomOrg {
  id: string;
  name: string;
${role ? '  /** What this person is in this organisation.  */\n  role: string;\n' : ''}}

const URL_BASE = process.env.SUPABASE_URL ?? '';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';

/**
 * The organisation this request belongs to, or null.
 *
 * Asked **as the requester**, with their own access token rather than the service-role key: this
 * is the one lookup in the app that decides what everything else may see, so it is the last one
 * that should be able to ignore the database's rules.
 */
export async function orgFor(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<LoomOrg | null> {
  const token = await accessTokenFor(req, res);
  if (!token || !URL_BASE) return null;

  const columns = ${JSON.stringify(
    ['id:' + tenancy.tenantColumn, ...(role ? [role] : [])].join(','),
  )};
  const url =
    URL_BASE +
    '/rest/v1/${tenancy.membershipTable}?select=' +
    encodeURIComponent(columns) +
    '&limit=1';

  const response = await fetch(url, {
    headers: {
      apikey: ANON_KEY,
      authorization: 'Bearer ' + token,
      accept: 'application/json',
    },
  });
  if (!response.ok) return null;

  // One membership, because V1 gives a person one organisation. Somebody in two gets the first,
  // and switching between them arrives with invites (O4) rather than being guessed at here.
  const rows = (await response.json()) as Array<Record<string, unknown>>;
  const membership = rows[0];
  if (!membership) return null;

  const id = String(membership.id ?? '');
  if (!id) return null;

  // The organisation's *name* is a second read, and only worth it when something shows it.
  const named = await fetch(
    URL_BASE + '/rest/v1/${tenancy.orgTable}?select=' + encodeURIComponent('id,name') +
      '&id=eq.' + encodeURIComponent(id) + '&limit=1',
    {
      headers: { apikey: ANON_KEY, authorization: 'Bearer ' + token, accept: 'application/json' },
    },
  );
  const orgRows = named.ok ? ((await named.json()) as Array<Record<string, unknown>>) : [];

  return {
    id,
    name: String(orgRows[0]?.name ?? ''),
${role ? "    role: String(membership['" + role + "'] ?? ''),\n" : ''}  };
}
`;
}
