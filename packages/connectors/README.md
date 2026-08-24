# @loom/connectors

The module system, and the Supabase connector built on it. Every connector is a module; not every
module is a connector (`docs/06-glossary.md`).

## Status — M4

- **Module manifest** — config fields plus the credentials a module declares, each scoped
  `client` or `server`. The scope is what the compiler enforces: server-only credentials may not
  cross out of an API route's body (`docs/specs/connector-credentials.md`).
- **Supabase connector** — `introspect()` reads the **PostgREST OpenAPI document** every project
  serves at `{url}/rest/v1/`, and maps Postgres column types into loom's visible vocabulary.
  Connecting *is* validating: the schema read is the proof that the URL and key work.
- **Typed per-table nodes** — a `select` node yields `rows`/`count`; an `insert` node takes one
  input per writable column, typed exactly as the column is, with generated columns omitted and
  nullable columns widened to `optional<T>`.

## Why the OpenAPI route

`04-hallucination-check.md` says the Supabase Management API and its OAuth partner program must
not be assumed available, and that manual-connection-with-validation stays the baseline. The
OpenAPI document needs nothing but a project URL and a key the designer already has. Its exact
per-column key set is not fully specified publicly, so the parser treats every field as optional
and degrades an unrecognised type to `unknown` rather than guessing.

## Not yet

Supabase **app auth** (sign-in for the generated app's end users), row-level-security awareness in
the editor, relations and foreign-key traversal, update/delete nodes, filters and ordering on a
select, and OAuth "connect your account" flows. Vercel is M6.
