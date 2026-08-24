# 10 — Interaction & UI System Plan (P0–P7)

> The execution plan for the capabilities between "the graph compiles" and "a designer ships the
> acceptance-test app." `09-implementation-plan.md` covers M0–M6; this file covers the phases
> that sit **around M6**, because several of them turn out to be prerequisites for it rather than
> follow-ons. Terminology follows `06-glossary.md`. Scope decisions defer to `07-v1-scope.md`.

## Why this plan exists

Two things prompted it. First, a survey of **Bubble** — the closest proven product in this
category — for workflows and tools worth adopting. Second, reading that survey against loom's own
acceptance test:

> a designer builds a working sample app (Fintrack-class: **auth, dashboard with live data, a
> CRUD resource, one search**) with zero syntax, previews it against their Supabase, and deploys
> it to their Vercel. — `07-v1-scope.md`

Held against what loom does today, that sentence names four gaps:

| Acceptance test asks for | State today |
| --- | --- |
| auth | **Missing.** Named in M4's build list, skipped |
| dashboard with live data | Works — reactive read into a List |
| a **CRUD** resource | **Half.** Database nodes do select and insert; no update, no delete |
| one **search** | **Missing.** A read has sort and limit, no filter |

And under all four, one thing no app can do without: **there is no conditional rendering at all.**
Every component drawn always renders. No empty state, no error message, no signed-in-only panel.

So this is not a wishlist of competitor features. It is the gap between loom today and loom's own
stated finish line, with Bubble as the reference for *how the good version feels* — never for how
it is built, since its core bets (hosted runtime, its own database, no real code out) are the
inverse of loom's.

## What survives the translation, and what does not

Bubble's model is `page → elements → workflows → its database`; loom's is
`artboard → components → pipelines → your Supabase`. The shapes line up. What differs is who owns
the runtime, so:

**Adopt** — conditions on visibility and style, ordered client action sequences, an issue
checker, a step debugger, list search + pagination, static option sets, reusable components.
All live *above* the runtime and translate cleanly.

**Adapt** — their API Connector becomes a REST **module** on the connector system loom already
has. Their privacy rules become *surfacing* Supabase RLS, never a parallel authorization model
(guardrail 3).

**Refuse** — the hosted runtime and built-in database (kills BYO-backend and compile-to-real-code,
the two things loom *is*); the inline expression composer with arbitrary chained operators (the
general-purpose-VPL slide — the arbitrary 20% goes to the Code node, guardrail 7); elements with
two hundred properties each (the curated vocabulary and the scope ceiling are features).

## Guiding principles for these phases

1. **The action catalogue is the product decision.** Bubble has roughly sixty actions; loom should
   have about twelve. Deciding which twelve *is* the design work — a thirteenth needs an argument,
   not a ticket.
2. **Keep the sequence on the canvas.** loom's protection against workflow spaghetti is that
   behaviour is visible and wired. That protection dies the moment an action list hides in a modal.
3. **Steal the UX, never the runtime.** Every phase here must still emit a repo the user owns.
4. **Each phase ends with a runnable artifact and a gate that can fail.** Same rule as `09`.
5. **Lean on what compilation already buys.** Bubble's worst failure modes — hidden dependencies,
   performance cliffs, no real version control — are answered by `tsc` and a git repo. Do not
   reinvent solutions to problems loom does not have.

## Prerequisite specs

Written before their consumers, per `09`'s rule.

| #   | Spec | Blocks | Land by |
| --- | --- | --- | --- |
| 6 | **Conditions model** — where a condition lives, what it may read, how it compiles | P1 | before P1 |
| 7 | **Action vocabulary** — the eight, their arguments, and the bar for a ninth | P3 | ✅ landed |
| 8 | **Lineage / source map** — node ↔ emitted line, the trust bridge | P6 | before P6 |
| 9 | **Problems** — what earns a row, and why the compiler is not the only source | P2 | ✅ landed |

---

## Phase plan

### P0 — Persistence ✅ _(done)_

- **Goal:** a reload stops losing the project.
- **Build:** serialize the snapshot to local storage on a debounce; open/reset; a schema-version
  guard so an older document either migrates or refuses loudly. The platform layer (R2 blob then
  Postgres pointer, per `02`) replaces the storage backend later without touching the editor.
- **Done-when:** build a form, reload the browser, and the form is still there — asserted in
  Playwright, not by hand.
- **Why first:** every phase below adds work a designer would lose. The acceptance test says "a
  designer builds a sample app"; nobody builds a sample app in a tab that forgets.

### P1 — Conditions ✅ _(done)_

- **Goal:** things can be shown, hidden, and restyled by state.
- **Build:** `visibleWhen` on any component, bound to a boolean; conditional **style overrides**
  (a second token reference applied when a condition holds), which is a small extension now that
  style is token-first. Reads a field's mirror, a derivation, a screen bucket, or a route param.
- **Done-when:** an empty state appears only when a list is empty, and an error message only when a
  pipeline failed — both verified in the Preview.
- **Notes:** compiles to `{cond ? <x/> : null}` and a merged style object. No new runtime.

### P2 — Problems panel ✅ _(done)_

- **Goal:** the first of the three error tiers gets a home.
- **Build:** a live list of everything currently wrong — illegal wires refused at the gesture,
  Build errors from the compiler, unbound required inputs — each row revealing its entity.
  The compiler already raises these with an entity id attached; nothing new is detected, it is
  *collected*.
- **Done-when:** three distinct problems appear in the panel, and clicking one selects the offending
  node or component.
- **Reference:** Bubble's issue checker, which refuses to deploy with issues outstanding. Whether
  loom blocks Deploy on problems is an open decision below.

### P3 — Action sequences ✅ _(done)_

- **Goal:** one click can do more than one thing.
- **Build:** an event holds an **ordered list of actions**, each optionally conditional. The
  starting catalogue: navigate, run pipeline, set state, set/clear a field, show a message, show/
  hide, open a URL, copy to clipboard. (Auth actions arrive with P5.) The editor surface is the
  design risk — the sequence stays legible on the canvas rather than hiding in a modal.
- **Done-when:** a submit button runs a pipeline, clears the form, shows a confirmation, and
  navigates — in that order, in the Preview.
- **Follows:** custom events / named pipelines become worth revisiting immediately after, because
  duplication starts the moment sequences exist. `07` defers reusable *sub-graphs* to v1.5; that
  deferral should be re-examined here rather than assumed.

### P4 — CRUD and search ✅ _(done)_

- **Goal:** the acceptance test's "a CRUD resource, one search" becomes possible.
- **Build:** **update** and **delete** database nodes (update needs a row identity — the primary
  key from introspection); **filter constraints** on a read (column, operator, value or binding);
  pagination on the List. A write should invalidate a reactive read on the same table — today it
  does not, and the gap is recorded in `specs/binding-trigger-runtime.md`.
- **Done-when:** the sample app can create, list, edit, delete and search one table's rows against
  a real Supabase.

### P5 — App auth ✅ _(done)_

- **Goal:** the acceptance test's "auth" stops being a hole.
- **Build:** Supabase app auth as a connector capability — sign up, sign in, sign out as **actions**
  (P3), the session as a readable value, auth-gated visibility (P1), and a **guard** on a Flow so a
  route redirects when there is no session. Two auth systems stay unblurred: the designer's login to
  loom is a different universe from the generated app's users (guardrail 3).
- **Done-when:** the sample app signs a user up, signs them in, shows their own rows, and bounces a
  signed-out visitor off a protected screen.
- **Verify first, per `04`:** Supabase auth's client surface and session shape, before designing on
  top of it.

### M6 — Vercel deploy + the sample app

Unchanged from `09`, but it now has what it needs. P0–P5 are its prerequisites; running the
acceptance test before them would fail on auth, on update/delete, on search, and on the absence of
any empty state.

### P6 — Runtime tier and the step debugger _(the differentiator)_

- **Goal:** when something goes wrong at runtime, the canvas says where.
- **Build:** the **lineage** map from node to emitted line (spec 8), a graph-aware Preview console
  that maps a runtime failure back to a wire or node, and a step view for a pipeline run showing
  the value at each stage.
- **Done-when:** a failing insert highlights the database node that issued it, and the step view
  shows the row that was rejected.
- **Why after M6:** it is the most valuable thing in the list and the least blocking. `02` is
  explicit that it must not be skipped after M4 — this is the phase where that promise is kept.

### P7 — Reusable components and option sets

- **Goal:** the missing half of "UI systems".
- **Build:** promote a frame to a **component** with instances and per-instance overrides; project
  **option sets** (named static enums) feeding Select options, Gate comparisons and typed ports —
  the same "named decision" idea the design tokens already use.
- **Done-when:** a header is defined once, used on three screens, and changing it changes all three;
  a status enum defined once types a Select and a Gate.
- **Scope call:** `07` defers reusable *sub-graphs* to v1.5. Reusable **UI components** are arguably
  a different thing, and this is where that gets decided deliberately rather than by default.

---

## Cross-cutting

- **Type system.** Conditions are `boolean`-typed ports; the checker already refuses a text into a
  boolean. Option sets extend the existing `enum` kind rather than adding a type.
- **Security.** Auth touches credentials: the session belongs to the generated app, the service
  role key stays server-side, and the compiler's existing refusals must cover the new nodes.
- **Design system.** Conditional style reuses the token layer; no new colour vocabulary.
- **Testing.** Same three-layer discipline: unit tests per package, a smoke gate that installs and
  builds the emitted repo, Playwright through the real editor. A phase without a gate that can fail
  is not done.

## Risk register

| Risk | Where | Mitigation |
| --- | --- | --- |
| Action sequences drift toward Bubble's sixty | P3 | Spec 7 fixes the catalogue and the bar for additions; the ceiling is a feature |
| The sequence editor becomes a modal nobody can read | P3 | Keep it on the canvas; the wire is the visible fact |
| Conditions become an inline expression language | P1 | A condition reads a boolean port. Composition happens in nodes, not in a property |
| Auth designed on assumed Supabase behaviour | P5 | `04`'s protocol: verify the client surface against live docs first |
| Update/delete without a stable row identity | P4 | Take the primary key from introspection; refuse a table without one |
| Persistence schema churn as phases add fields | P0 | Version the snapshot; a version guard that refuses loudly beats a silent partial load |

## Open decisions (recommended defaults)

1. **How many actions?** _Settled:_ eight in P3, plus three auth actions in P5. `show`/`hide` was
   dropped for `setVariable` + `visibleWhen`; a ninth needs an argument in spec 7.
2. **Do reusable UI components jump the v1.5 queue?** _Recommend:_ yes, but after M6 — they are the
   missing half of "UI systems," and the `07` deferral was written about sub-graphs.
3. **Does Deploy block on open Problems?** _Recommend:_ yes for Build-tier problems (the emitted app
   would not compile anyway), no for lint-level ones.
4. **Where does persistence live in P0?** _Recommend:_ local storage now behind a storage interface,
   so the platform's R2-then-Postgres order (`02`) swaps in without touching the editor.
5. **Does a write invalidate a reactive read?** _Settled:_ yes, per table, via a counter bumped by
   the write and named in the read's dependencies. Only for tables both written and reactively read
   on the same screen; a screen you are not looking at re-reads when you arrive.

## Immediate next actions

1. **P0** — persist the snapshot. One debounced write, one guard, one Playwright reload test.
2. Write **spec 6 (conditions)**, then build **P1**.
3. Build **P2** — the Problems panel collects errors the compiler already produces.
4. Write **spec 7 (actions)** before touching P3, because the catalogue is the decision that keeps
   loom from becoming Bubble.
