# 14 — Data

> How a project reaches data, and what a designer sees of it. Companion to
> `specs/connector-credentials.md` (the rules a credential lives under) and `06-glossary.md`
> (the node vocabulary this must not grow).

## The claim

**A database node says the same thing whichever connection is under it.** Read these rows, insert
this one, update that one, remove it. The connector decides how the app *reaches* the data — a
PostgREST request over HTTP, or a socket to the database itself — and nothing about the node,
its ports, or the screen bound to it changes when you swap which.

That claim is the reason the connector list can grow without the vocabulary growing with it. It
also draws the line: a store that cannot be described as tables with typed columns and a primary
key would need its own nodes, and that is a decision to make on purpose rather than an
integration to slip in.

## The phases

| Phase  | What it is                                                                | State |
| ------ | ------------------------------------------------------------------------- | ----- |
| **D1** | Postgres emission — statements, parameters, the pool, the driver, the env | done  |
| **D2** | The studio side — connect, introspect, the schema table, the query editor | done  |
| **D3** | More of what a database can do: count, upsert, aggregate                  | next  |
| **D4** | MySQL emission, once writes can be done honestly                          | later |
| **D5** | Firestore, or the decision not to                                         | open  |

## What is emitted

A Supabase project emits `@supabase/postgrest-js` calls and asks for `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY`. A Postgres project emits `pg` and asks for `DATABASE_URL`. Neither
carries the other's dependency: the project installs what it actually reaches for.

The pool is held at **module scope**, `max: 1`. A serverless function is reused between requests,
and opening a connection per invocation is how a database's connection limit gets used up. The
pooling that matters happens in front of the database — Supavisor, PgBouncer, Neon — which is why
the credential's hint asks for the pooled connection string rather than the direct one.

The helpers a route does not call are not emitted at all: the emitted app builds with
`noUnusedLocals`, so an unused `quote` is a build failure rather than dead weight.

## Every value is a parameter

Not one filter value and not one identifier is pasted into a statement from something a designer
typed.

- **Values** become `$1, $2, …` with the value in the array beside them. A filter containing
  `'; DROP TABLE notes; --` matches no rows; it does not drop a table.
- **Identifiers** — tables, columns, sort keys — come from the *cached introspection*, and are
  checked against `/^[A-Za-z_][A-Za-z0-9_]*$/` before they are quoted. A name that fails is a
  compile error, not an escape-and-hope.
- A quoted identifier is written into the emitted file with `JSON.stringify`, because `"notes"`
  pasted into a double-quoted string closes it early. That was a real bug, and the smoke gate
  that runs the emitted project's own `tsc` is what now catches its kind.

## The query editor

The four table nodes stop at a join, a group-by or a window function. Rather than growing the
vocabulary until it is SQL with dropdowns, the **query node is SQL** — with the one rule kept:
`:name` is a parameter, and it becomes an input port on the node, so the value arrives from the
request rather than as text inside the statement. Typing `:since` adds a port; deleting it takes
one away; the route holding the step is retyped in the same breath, because a route's inputs are
its body's shape.

It is offered only on a connection that can run a statement. On a connector reached over HTTP the
compiler refuses with what to do instead, rather than emitting something that would fail at
run time.

## The connection string is a whole credential

It carries the password in the middle of it, so it follows the strictest reading of
`specs/connector-credentials.md`:

- It goes **straight to the dev server** and is never written to the studio's env bucket in
  `localStorage`. The studio can learn that the server holds one; it can never read it back.
- It never enters the document, so saving or sharing a project cannot leak it. What the document
  keeps is the schema name and the cached schema, and neither is secret.
- A browser cannot open a database socket anyway, so introspection runs on the dev server and
  answers with rows from `information_schema`. Driver errors are scrubbed of the string before
  they travel back, because an error message ends up in screenshots.

## The schema, as a table

The schema is the vocabulary a designer builds against, so it is shown as one: column, type, and
the two flags that decide what an insert form contains — the primary **key**, and whether the
database fills the column in (**auto**). A list of table names with a column count told none of
that, and every question about it got answered by opening a node and reading a dropdown. It
appears in the Data panel and again under the step being edited, because reading column names
should not mean leaving the statement you are writing.
