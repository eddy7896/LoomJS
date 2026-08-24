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
| **D5** | Tables and columns: create, add, rename, retype, default, required, drop | done  |
| **D6** | Relations, unique constraints and indexes                              | done  |
| **D7** | Migrations emitted into the repo, and seeding a table with rows        | done  |
| **D8** | The elements: a Table that renders rows, a Form built from columns     | done  |
| **D9** | All of it in one tab: the data work moves next to the data              | done  |

## What happens after a change

A schema change makes the cached introspection wrong, so applying one **re-reads the schema** and
retypes every database node standing on that table, and every route holding one. A column that no
longer exists must not survive as a port that emits code referencing it — that is a compile error
at best and a silent write to nowhere at worst.

## Relations and indexes

A **relation** is a fact about the data rather than a decoration: it says a value in this column is
the key of a row over there. That is what makes a picker possible instead of asking someone to
paste a uuid, so it is edited beside the column it belongs to rather than in a diagram elsewhere.

Only a column that identifies **one** row can be pointed at — a key, or something unique — and the
two columns have to hold the same kind of value. Both are checked before anything is sent, because
the database's own refusal is about operator classes and says nothing a designer can act on.

Every link says what happens when the row it points at is deleted, because there is no safe
default: refuse the delete, delete this row too, or keep it and forget the link.

An **index** is the difference between a search and reading every row, and the moment to know that
is while the column is being chosen. So a filter on a column with no index says so, in the
inspector, before the table has grown enough for anyone to notice.

Introspection reads all of this back in **three statements rather than one join**: a column that is
a foreign key and sits in two indexes would come back three times from a single query, and a
schema that reports a column three times is worse than one that costs two more round trips. Only
the **first** column of an index is reported — an index on (a, b) does not help a query filtering
on b alone, and saying otherwise would tell a designer their search is fast when it is not.

## Migrations, and rows to design against

The studio makes schema changes against a **live database**. That is fine while one person is
designing and useless the moment there is a second environment: staging has never seen them, and a
colleague cloning the repo gets an app whose queries reference columns that are not there.

So every applied change is also recorded in the document and emitted as a numbered file —
`migrations/0002_add_column_body_to_notes.sql` — carrying the same statements in the same order.
They are **plain SQL with no runner**: a migration tool is a choice a team makes, and often has
already made, so what loom emits works with psql, with Supabase's CLI, and with anything that
reads a directory of numbered files.

A migration records what **was applied**, so it is written only once the database has accepted the
change. One written for a statement that was refused would describe a schema nobody has.

**Sample rows.** A blank table makes every screen look broken while it is being designed, and
typing five rows by hand to find that out is worse. So a table can be filled with plausible rows —
"title 1", "title 2" — which are readable on screen in a way random strings are not. The values
travel as **parameters**, like every other value loom sends a database; the rows are made up, but
nothing about them becomes SQL text. Columns the database fills in are skipped, and so are columns
pointing at another table: inventing a key that matches nothing there is not sample data, it is a
broken row.

## The elements

**Table** is the one arrangement of data worth its own element. A List with a Frame inside it can
be made to look like a table, and every project ended up doing exactly that — badly, because
columns lining up across rows is the one thing a List cannot promise. Its columns are **named**
rather than discovered from the first row: a row missing a field would otherwise reorder every
column after it, and a table whose columns move between rows is worse than no table. Naming
nothing falls back to the keys of the first row, worked out once so the rest still line up.

**Form** is not an element at all. "Build me the form for this table" lays out a Frame, a label and
an input per column, and a button, then wires each field to the column it was made for and the
button to a route that writes the row. Everything it makes is an **ordinary component**, editable
afterwards exactly like one placed by hand — a generator that produced something only it could
edit would be a worse version of the thing it saved you from. Columns the database fills in are
not asked for, and the control follows what the column holds: a number gets a number field, a
yes/no gets a checkbox, a structure gets a text area, because nothing here edits a structure.

**The date gap is closed.** A DateField hands back the browser's `YYYY-MM-DD`, which is text, and
loom will not call text a date on the way into a date column — rightly, because nothing was
converting it. Compute now has a **Read as date** operation that does, and the generated form
wires a date column through it: the same step a designer would have added by hand. An empty box
becomes nothing rather than an Invalid Date, which would otherwise reach the column as null with no
explanation.

If a field still cannot be wired for some other reason, the form says which one and why, rather
than laying out something that looks finished and drops what you type into it.

## One tab for data

Reading a table used to be in the **Nodes** palette, next to Compute and Compare — one mode switch
away from the schema that says what the tables are. A designer thinking about data was reading one
panel and clicking in another, and the two panels never agreed about which table they meant.

So everything about a table is in the **Data** tab now: the connection, the schema, the seven
things you can do to a table, the written statement, and the two elements generated *from* a table
— a Table of it, and a Form for it. The Nodes palette keeps what is not about a table: API routes,
logic, values, the Current user node. Nothing is duplicated between them.

Two things fell out of moving it:

**A step brings its own route.** Server work lives inside an API route, and the old panel simply
did not offer the buttons until one was selected. Now the step makes the route if there is not one
— the same node, one click earlier.

**And the next step joins the same route.** Adding a step selects that *step*, so a panel that only
recognised a selected route would have started a second route for the second step. Two routes
doing one job is not what anybody drew, so the panel follows a selected step back to the route
holding it and says which one the next step is going into.
