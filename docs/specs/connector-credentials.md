# Spec 3 — Connector Credential Model (v1)

> The third of the five "next specs" (`03-system-memory.md`), gating **M4**. It defines where a
> secret lives, who may read it, and why the compiler can *refuse* rather than merely warn.
> `packages/connectors` is authoritative; this doc is its prose companion.

## The one rule

**A secret never enters the document.** A `ConnectorInstance` in the snapshot carries a
`credentialRef` — a *name* — and nothing else. The value lives in the **env bucket**, keyed by
that name. This is structural, not procedural: since the snapshot has nowhere to put a secret,
saving to R2, sharing a project, or exporting the repo cannot leak one (guardrails 1–4).

```
snapshot.connectors[cn_1] = { moduleId: 'supabase', config: { url }, credentialRef: 'default' }
env bucket (never in the snapshot) = { SUPABASE_ANON_KEY: '…', SUPABASE_SERVICE_ROLE_KEY: '…' }
```

## Scope: client vs server

Every credential a module declares carries a **scope**.

| Scope | Meaning | Reaches |
| ----- | ------- | ------- |
| `client` | safe to ship to the browser (a Supabase anon key, protected by RLS) | emitted client bundle + server |
| `server` | must never leave the server (a service-role key) | emitted serverless functions only |

The compiler enforces this at build time: a `server`-scoped credential referenced by anything
outside an API route node's body is a **Build error**, not a lint. This is the concrete form of
"security is a build-time gate, not a review step" (`09-implementation-plan.md`).

Consequence for the node vocabulary: **database nodes only run inside an API route body.** The
container boundary is the network boundary (spec 4), so that is also the line the service key
cannot cross.

## Reading a credential in emitted code

Emitted code reads `process.env.<NAME>` — the compiler emits the *name*, never the value:

```ts
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
```

Deployment injects the values by name (Vercel env vars, M6). Nothing else changes between
Preview and production, which is the point of naming rather than inlining.

## Where the bucket actually lives

| Stage | Store | Notes |
| ----- | ----- | ----- |
| V1 platform | platform Postgres, encrypted at rest, per project | the durable answer (`02-system-architecture.md`) |
| studio dev (today) | the designer's browser, and a `.env.local` written into the preview directory | the platform layer is not built yet; the values never touch the snapshot either way |
| deploy | Vercel env vars, injected by name | M6 |

The preview `.env.local` is written by the dev-server plugin on request and is gitignored. It is
the local stand-in for the bucket, not a second source of truth.

## Connection strategy: manual, with validation

V1 connects **manually**: the designer pastes a project URL and keys, and loom immediately
validates them by introspecting. OAuth "connect your Supabase account" is additive later and is
explicitly *not* assumed to be available (`04-hallucination-check.md` — the Management API and
partner program terms are unverified, and the design must survive them being unavailable).

Validation is part of connecting: an unvalidated connection is not saved as connected, so a typo
surfaces at the moment of entry rather than at first query.

## Introspection is cached in the document

What introspection *returns* — table names, column names, column types — is **not** secret, so it
is stored in the connector's `config`. That is what makes the compiler and the canvas work
offline: typed ports come from the cached schema, never from a live call at compile time. Stale
schema is a re-introspect away, and re-introspecting is how a schema change reaches the graph.

## v1 boundaries

- One credential set per connector instance; no per-environment sets beyond dev/prod (M6).
- No secret rotation UI, no audit log, no per-member access rules (teams ship disabled).
- No OAuth flows for any connector.
- The bucket is not readable from the canvas: the studio can write and test credentials, and can
  tell you a name exists, but never renders a stored value back.

## Correction (found against a real project)

Introspection was designed as a browser call using the **anon** key. A hosted Supabase project
refuses it: `GET {url}/rest/v1/` answers `401 Invalid API key — Only the service_role API key can
be used for this endpoint`. The service role key is server-scoped and may not cross into a
browser, so introspection moved to the dev server:

- The studio tries the direct call first, which still works for a self-hosted project, an older
  project, or a test stub that accepts the anon key.
- On `401`/`403` it relays through `POST /__loom/introspect` with **only the project URL**. The
  refused key is not sent again; the server uses the one it loaded from `.env.local`.
- The response carries the OpenAPI document and nothing else. Table and column names are not
  secret — the key is, and it never leaves the process that holds it.

The same shape applies on the platform: the relay becomes a server route, not a browser call.

## What a project with users asks for (P5)

The names a deployment needs depend on who its routes are.

| The project | Names in `.env.example` |
| --- | --- |
| No users | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| With users | `SUPABASE_URL`, `SUPABASE_ANON_KEY` |

The second row is the interesting one: a project with auth **stops asking for the service-role
key**, because its routes answer as the person asking and the key that bypasses row-level security
would defeat the point (`docs/specs/app-auth.md`). The publishable key is used server-side there,
which is not a contradiction — `client` scope says where a value *may* go, not where it must.

Session cookies are minted by the emitted server and are `HttpOnly`, so the browser holds a
session it cannot read. That is the same rule as everywhere else in this document, applied to a
credential the app issues rather than one the designer supplies.
