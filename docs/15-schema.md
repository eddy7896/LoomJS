# 15 — Making the data structure

> Creating tables, columns, relations and the elements that render them. Companion to
> `14-data.md` (how a project *reaches* data) and `specs/connector-credentials.md`.

## The claim

Until now a project could only ever describe data someone else had already made. That is a real
ceiling: a designer with an idea has to leave loom, open a database console, work out what a
`timestamptz` is, and come back. **The schema is part of the design**, so it is edited here.

What that must not become is a database console with rounded corners. The bar for anything in
this phase is the same as everywhere else in loom: it says what it does in words a designer
already has, it refuses what it cannot do honestly, and it never silently loses data.

## Where a schema change can happen

Schema editing needs a connection that can **run statements**. That draws the same line the query
node drew, for the same reason:

| Connection    | Schema editing                                                                |
| ------------- | ----------------------------------------------------------------------------- |
| **Postgres**  | Yes — DDL over the same pooled connection introspection uses.                  |
| **Supabase**  | Only with a connection string. PostgREST cannot run DDL, so the panel asks for the project's Postgres URL and says why. |
| **Firestore** | No DDL exists. loom keeps a **shape** instead — see below.                     |

A Firestore collection has no schema to alter: a field exists because a document has it. So loom
keeps the shape *itself* — the fields a designer says the collection holds — and uses it for
forms, ports and typing, while being plain that the database enforces none of it. Adding a field
to that shape changes what loom offers; it does not change one document.

## Rules the statements follow

DDL cannot take parameters — a table name is not a placeholder — so this is the second place in
loom where typed text becomes part of a statement, and it is fenced the same way the aggregate
function name is:

- **Every identifier** is checked against `/^[A-Za-z_][A-Za-z0-9_]*$/` and then quoted. A name
  that fails is refused before anything is sent.
- **Every type** comes from a closed map, never from typed text.
- **A default value** is checked against the column's own type before it is written as a literal:
  a number must parse as one, a boolean must be one of two words, JSON must parse, and text is
  quoted with its quotes doubled.
- **DDL never reaches the emitted app.** A schema change is a design-time act performed by the
  studio through its dev server. The repo the user owns contains its *migrations* (D7), never a
  `CREATE TABLE` that runs on request.

## The types a column can have

| loom            | Postgres                              | Why                                                                     |
| --------------- | ------------------------------------- | ----------------------------------------------------------------------- |
| Text            | `text`                                | No length limit to guess at.                                            |
| Number (whole)  | `integer`                             | Arrives as a number through the driver.                                 |
| Number (decimal)| `double precision`                    | Also arrives as a number.                                               |
| Yes / no        | `boolean`                             |                                                                          |
| Date and time   | `timestamptz`                         | A time without a zone is a time that means something different elsewhere.|
| Structured      | `jsonb`                               | For a record or a list.                                                  |

**Why not `bigint` and `numeric`.** node-postgres hands both back as **strings**, to avoid losing
precision that JavaScript cannot hold. A key typed `bigserial` would therefore arrive as text and
type every port downstream as text — the sort of quiet mismatch that shows up three screens later
as a comparison that never matches. Where exact decimals matter more than being a number in the
app, that is a decision to make deliberately, not a default to inherit.

**The key.** A new table gets `id uuid primary key default gen_random_uuid()`. A uuid is honestly
text at every layer, needs no sequence, and does not run out. A whole-number identity key is
offered as an alternative for someone who wants readable ids.

## Losing data on purpose

Dropping a column or a table destroys what is in it, and no dialog with an OK button has ever
stopped that from happening by accident. So a drop asks the designer to **type the name**, and
says in the same breath what goes with it. Everything else — adding, renaming, widening — is a
normal edit.

## The phases

| Phase  | What it is                                                            | State |
| ------ | --------------------------------------------------------------------- | ----- |
| **D5** | Tables and columns: create, add, rename, retype, default, required, drop | now   |
| **D6** | Relations, unique constraints and indexes                              | next  |
| **D7** | Migrations emitted into the repo, and seeding a table with rows        | next  |
| **D8** | The elements: a Table that renders rows, a Form built from columns     | next  |

## What happens after a change

A schema change makes the cached introspection wrong, so applying one **re-reads the schema** and
retypes every database node standing on that table, and every route holding one. A column that no
longer exists must not survive as a port that emits code referencing it — that is a compile error
at best and a silent write to nowhere at worst.
