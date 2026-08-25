import type { Snapshot, Tenancy } from '@loom/ir';
import { CompileError, type EmittedFile } from '../types';

/**
 * Row-level security (O3, `docs/V1-COMPLETION.md`), compiled.
 *
 * ## This is the phase that makes O1 true
 *
 * O1 narrows what the app *asks for*: a read carries `org_id = <yours>`, a write is stamped with
 * it. That is behaviour, and behaviour is not a boundary. Anyone holding a session can talk to
 * PostgREST directly and ask for whatever they like, and the query the app would have written has
 * no bearing on the answer.
 *
 * **The database is the only thing that can actually refuse.** These policies are that refusal.
 * A client-side guard is a UX affordance; this is the wall.
 *
 * ## Emitted as a migration the project owns
 *
 * Not applied by loom, not hidden behind a button: numbered SQL in the repo, exactly like every
 * other schema change (`docs/15-schema.md`). Somebody has to be able to read the rules that decide
 * who sees what, review them, and run them against an environment loom has never touched.
 *
 * ## Three things verified against Supabase's docs before any of this was written
 *
 * 1. **One policy per operation.** Postgres does not accept several operations in one `for`
 *    clause, so `select`, `insert`, `update` and `delete` each get their own.
 * 2. **`using` and `with check` are different questions.** `using` decides which existing rows an
 *    operation may see or touch; `with check` decides what a new or changed row is allowed to look
 *    like. `update` needs both — without the second, a row can be updated *out of* the
 *    organisation it belonged to.
 * 3. **`auth.uid()` is wrapped in a `select`.** That makes Postgres cache it per statement instead
 *    of calling it once per row, which is the difference between a policy and a table scan.
 *
 * ## Why a `security definer` function, and why it is dangerous done carelessly
 *
 * "Rows whose organisation is one you belong to" means the policy has to read the membership
 * table — and the membership table has policies of its own, which Postgres then evaluates, which
 * is how `42P17 infinite recursion detected in policy` happens.
 *
 * A `security definer` function breaks the cycle by running as its owner. That is also a loaded
 * gun, and it is pointed away here deliberately:
 *
 * - **`set search_path = ''`, every name schema-qualified.** Without a pinned search path a caller
 *   can point an unqualified name at an object of their own and have it run with the owner's
 *   privileges. This is the whole exploit, and one line prevents it.
 * - **It lives in a schema the API does not expose.** A definer function in an exposed schema is
 *   callable over the Data API *as its owner*, which would hand out exactly the privilege it
 *   exists to contain.
 */

/** Where the helper lives. Deliberately not `public`, which PostgREST exposes. */
export const PRIVATE_SCHEMA = 'loom_private';

/** The function policies call to ask which organisations the requester belongs to. */
export const MEMBERSHIP_FN = `${PRIVATE_SCHEMA}.orgs_for_current_user`;

/** A Postgres identifier, quoted so a table called `order` or `user` still works. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Refuse to emit policies that would not do what they say.
 *
 * Every one of these produces SQL that runs, so nothing here would fail loudly at deploy time —
 * it would fail quietly, as a boundary that is not one.
 */
export function validateRls(snapshot: Snapshot): void {
  const tenancy = snapshot.tenancy;
  if (!tenancy) return;

  const scoped = tenancy.scopedTables ?? [];
  if (scoped.length === 0) return;

  if (!tenancy.userColumn) {
    throw new CompileError(
      `Row-level security needs to know which column of "${tenancy.membershipTable}" names the ` +
        `person — the one holding their user id. Without it there is no way to write "rows ` +
        `belonging to an organisation this person is in".`,
      snapshot.id,
    );
  }

  for (const table of scoped) {
    if (table === tenancy.membershipTable || table === tenancy.orgTable) {
      throw new CompileError(
        `"${table}" is what decides who belongs where, so it cannot also be a table scoped by ` +
          `that decision. It gets its own rule instead.`,
        snapshot.id,
      );
    }
  }
}

/**
 * "Which organisations does the person asking belong to?" — the one question every policy asks.
 *
 * `stable` rather than `volatile` so Postgres may call it once per statement; `security definer`
 * so reading the membership table here does not re-enter that table's own policies.
 */
function membershipFunction(tenancy: Tenancy): string {
  const memberships = quoteIdent(tenancy.membershipTable);
  const tenant = quoteIdent(tenancy.tenantColumn);
  const user = quoteIdent(tenancy.userColumn!);

  return `-- Which organisations the person asking belongs to.
--
-- security definer, so reading the memberships here does not re-enter that table's own policies
-- and trip "infinite recursion detected in policy".
--
-- search_path is pinned empty and every name below is schema-qualified. Without that, a caller
-- can point an unqualified name at an object of their own and have it run with this function's
-- privileges — which is the entire reason definer functions are treated carefully.
create or replace function ${MEMBERSHIP_FN}()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.${tenant}
  from public.${memberships} m
  where m.${user} = (select auth.uid());
$$;

revoke all on function ${MEMBERSHIP_FN}() from public, anon;
grant execute on function ${MEMBERSHIP_FN}() to authenticated;`;
}

/** Every policy for one table whose rows belong to an organisation. */
function policiesFor(table: string, tenancy: Tenancy): string {
  const name = quoteIdent(table);
  const column = quoteIdent(tenancy.tenantColumn);
  const mine = `${column} in (select ${MEMBERSHIP_FN}())`;

  return `-- ${table}
alter table public.${name} enable row level security;

drop policy if exists "loom_${table}_select" on public.${name};
create policy "loom_${table}_select"
on public.${name}
for select
to authenticated
using ( ${mine} );

-- \`with check\` on an insert: what the *new* row is allowed to look like. A row filed into
-- somebody else's organisation is refused here rather than merely discouraged in the app.
drop policy if exists "loom_${table}_insert" on public.${name};
create policy "loom_${table}_insert"
on public.${name}
for insert
to authenticated
with check ( ${mine} );

-- An update needs both. \`using\` says which rows may be touched; \`with check\` says what they
-- may become — without the second, a row can be updated *out of* the organisation it belonged to.
drop policy if exists "loom_${table}_update" on public.${name};
create policy "loom_${table}_update"
on public.${name}
for update
to authenticated
using ( ${mine} )
with check ( ${mine} );

drop policy if exists "loom_${table}_delete" on public.${name};
create policy "loom_${table}_delete"
on public.${name}
for delete
to authenticated
using ( ${mine} );`;
}

/**
 * The membership table's own rule, written directly rather than through the helper.
 *
 * It must not call the function that reads it — that is the recursion the helper exists to avoid,
 * and routing this one through it would put the cycle straight back. "Rows that are mine" needs
 * nothing more than the user id anyway.
 */
function membershipPolicies(tenancy: Tenancy): string {
  const name = quoteIdent(tenancy.membershipTable);
  const user = quoteIdent(tenancy.userColumn!);

  return `-- ${tenancy.membershipTable} — who belongs to which organisation.
--
-- Read directly against the user id, never through the helper: the helper reads this table, and
-- a policy here that called it would be the recursion it was written to prevent.
alter table public.${name} enable row level security;

drop policy if exists "loom_membership_select" on public.${name};
create policy "loom_membership_select"
on public.${name}
for select
to authenticated
using ( ${user} = (select auth.uid()) );`;
}

/** The organisations themselves: you may read the ones you are in, and no others. */
function orgPolicies(tenancy: Tenancy): string {
  const name = quoteIdent(tenancy.orgTable);

  return `-- ${tenancy.orgTable} — the organisations.
alter table public.${name} enable row level security;

drop policy if exists "loom_org_select" on public.${name};
create policy "loom_org_select"
on public.${name}
for select
to authenticated
using ( id in (select ${MEMBERSHIP_FN}()) );`;
}

export const RLS_PATH = 'supabase/migrations/loom_row_level_security.sql';
export const BREACH_PATH = 'scripts/rls-breach.mjs';

/**
 * The test that actually settles it: **try the breach, and require it to fail.**
 *
 * Everything checkable at compile time is checked in `rls.test.ts`, and none of it can answer the
 * only question that matters — whether a real session against a real database gets somebody
 * else's rows. That needs a live Postgres with these policies applied, so it ships as a script
 * pointed at the project's own environment.
 *
 * It is written to be **run before trusting the app with anyone's data**, and it is written to
 * pass loudly or fail loudly. A test that reports "0 rows" without saying whether it expected 0 is
 * the shape of a security test that never worked.
 */
function breachScript(tenancy: Tenancy): string {
  const scoped = [...(tenancy.scopedTables ?? [])].sort();

  return `// Generated by @loom/compiler (docs/V1-COMPLETION.md O3).
//
// Does the database actually refuse? Everything else about tenancy is the app being careful.
// This asks the database directly, the way somebody who did not use your app would.
//
//   Set SUPABASE_URL, SUPABASE_ANON_KEY, A_EMAIL, A_PASSWORD, B_EMAIL, B_PASSWORD
//   then: node ${BREACH_PATH}
//
// Two people, in two different organisations, both with a row of their own. It signs in as each,
// asks for everything, and requires that neither can see the other's.

const URL_BASE = (process.env.SUPABASE_URL ?? '').replace(/[/]$/, '');
const ANON = process.env.SUPABASE_ANON_KEY ?? '';
const TABLES = ${JSON.stringify(scoped)};
const TENANT_COLUMN = ${JSON.stringify(tenancy.tenantColumn)};

if (!URL_BASE || !ANON) {
  console.error('Set SUPABASE_URL and SUPABASE_ANON_KEY.');
  process.exit(2);
}

async function signIn(email, password) {
  const response = await fetch(URL_BASE + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error('Could not sign in as ' + email + ': ' + (await response.text()));
  return (await response.json()).access_token;
}

/** Everything this session can see in a table — no filter, which is the point. */
async function readAll(token, table) {
  const response = await fetch(URL_BASE + '/rest/v1/' + table + '?select=*', {
    headers: { apikey: ANON, authorization: 'Bearer ' + token },
  });
  if (!response.ok) throw new Error('Read failed on ' + table + ': ' + (await response.text()));
  return response.json();
}

const a = await signIn(process.env.A_EMAIL, process.env.A_PASSWORD);
const b = await signIn(process.env.B_EMAIL, process.env.B_PASSWORD);

let failures = 0;

for (const table of TABLES) {
  const seenByA = await readAll(a, table);
  const seenByB = await readAll(b, table);

  const orgsA = new Set(seenByA.map((row) => String(row[TENANT_COLUMN])));
  const orgsB = new Set(seenByB.map((row) => String(row[TENANT_COLUMN])));

  // Neither may see more than one organisation, and never each other's.
  const overlap = [...orgsA].filter((org) => orgsB.has(org));

  if (orgsA.size > 1 || orgsB.size > 1 || overlap.length > 0) {
    failures += 1;
    console.error(
      'LEAK on ' + table + ': A sees [' + [...orgsA] + '], B sees [' + [...orgsB] + ']',
    );
  } else if (seenByA.length === 0 && seenByB.length === 0) {
    // Zero rows on both sides proves nothing — it is what a broken policy and an empty table
    // look like alike. Say so rather than reporting a pass nobody earned.
    failures += 1;
    console.error(
      'INCONCLUSIVE on ' + table + ': neither person can see any row, so this proved nothing. ' +
        'Give each of them a row in their own organisation and run it again.',
    );
  } else {
    console.log('ok ' + table + ': A sees ' + seenByA.length + ' row(s), B sees ' + seenByB.length + ', and neither sees the other organisation.');
  }
}

if (failures > 0) {
  console.error(String.fromCharCode(10) + failures + ' table(s) did not hold. Do not ship this.');
  process.exit(1);
}
console.log(String.fromCharCode(10) + 'Every table held: the database refused, not just the app.');
`;
}

/**
 * The whole migration, or nothing.
 *
 * Nothing when the project is single-tenant, and nothing when no table has been marked as
 * belonging to an organisation — policies over an empty list would be a file that looks like
 * protection and is not.
 */
export function emitRlsFiles(snapshot: Snapshot): EmittedFile[] {
  const migration = emitRlsMigration(snapshot);
  if (!migration) return [];
  return [migration, { path: BREACH_PATH, content: breachScript(snapshot.tenancy!) }];
}

export function emitRlsMigration(snapshot: Snapshot): EmittedFile | undefined {
  const tenancy = snapshot.tenancy;
  const scoped = tenancy?.scopedTables ?? [];
  if (!tenancy || scoped.length === 0 || !tenancy.userColumn) return undefined;

  const body = [
    membershipFunction(tenancy),
    membershipPolicies(tenancy),
    orgPolicies(tenancy),
    ...[...scoped].sort().map((table) => policiesFor(table, tenancy)),
  ].join('\n\n');

  return {
    path: RLS_PATH,
    content: `-- Generated by @loom/compiler (docs/V1-COMPLETION.md O3).
--
-- Row-level security: the rules the database itself enforces about who may read and change what.
--
-- Everything the app does to keep one organisation's rows out of another's reach is a
-- convenience until this file is applied. The app narrowing its own queries decides nothing —
-- anyone holding a session can ask the database directly, and this is what answers them.
--
-- Run it against every environment, and read it first: these are the rules that decide who sees
-- what, and they are yours.
--
--   psql "$DATABASE_URL" -f ${RLS_PATH}
--
-- Re-running is safe: every policy is dropped and recreated.

create schema if not exists ${PRIVATE_SCHEMA};
-- Never exposed over the Data API. A definer function in an exposed schema is callable *as its
-- owner* by anyone who can reach the API, which is the opposite of what it is for.
revoke all on schema ${PRIVATE_SCHEMA} from public, anon, authenticated;

${body}
`,
  };
}
