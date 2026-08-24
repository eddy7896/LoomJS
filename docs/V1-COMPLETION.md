# V1 Completion Plan

> **The single executable plan** for taking loomJS from what it is today to a tool that builds the
> ten target app classes: school management, ERP, ecommerce, CRM, data/tools dashboards, messaging,
> B2B SaaS dashboards, websites, finance, fitness.
>
> This file supersedes nothing and restates nothing. `07-v1-scope.md` still owns the in/out line,
> `03-system-memory.md` still owns the decision log, `06-glossary.md` still owns the words. What
> this file adds is: what the ten classes actually require, an audited gap against what exists,
> **the component↔node contract every new capability must satisfy**, the IR changes, and a phase
> plan with gates that can fail.
>
> Written to be picked up cold at a later date. Every phase names its files, its node vocabulary
> and its done-when. Nothing here needs the conversation that produced it.

**Contents**

1. [The target: ten classes, twenty capabilities](#1-the-target-ten-classes-twenty-capabilities)
2. [Where loom stands today](#2-where-loom-stands-today)
3. [The component↔node model](#3-the-componentnode-model)
4. [Node vocabulary for every new capability](#4-node-vocabulary-for-every-new-capability)
5. [IR changes](#5-ir-changes)
6. [The plan: six tracks](#6-the-plan-six-tracks)
7. [Sequence: three waves](#7-sequence-three-waves)
8. [Risks](#8-risks)
9. [Start here](#9-start-here)

---

## 1. The target: ten classes, twenty capabilities

Ten app names collapse into **twenty capabilities**. Each is a thing that, if missing, makes a
whole class unbuildable rather than merely awkward.

| #   | Capability                                                                                                             | Why an app class dies without it                                                                        |
| --- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| C1  | **Tenancy** — org entity, membership, tenant column on every row                                                       | School, ERP, CRM, B2B SaaS are _definitionally_ multi-tenant. One school must never read another's rows |
| C2  | **Roles & permissions** — role vocabulary, route guard by role, visibility by role, **server-side enforcement**        | Admin/teacher/student/parent; ERP approver vs clerk. Signed-in-or-not is one bit and these need four    |
| C3  | **App shell / nested layout** — one sidebar + topbar across 40 routes, active nav, breadcrumbs                         | Every dashboard-shaped app. Redrawing a sidebar per screen is not a product                             |
| C4  | **Reusable components** — define once, instance everywhere, per-instance overrides                                     | A 40-screen ERP built from copies is unmaintainable by the second week                                  |
| C5  | **Relations / nested reads** — order → line items, student → class → grades, in one query                              | ERP and school data is a graph. A flat single-table read cannot express it                              |
| C6  | **Server-side pagination, sort, search** — offset/cursor, exact count, bound filter values                             | 100k-row tables. Fetching-then-slicing is a memory bug with a UI on it                                  |
| C7  | **Transactions** — several writes, all or none                                                                         | Checkout, journal posting, stock decrement. Half a checkout is a support ticket                         |
| C8  | **Decimal money, currency, timezone**                                                                                  | Finance and ecommerce. IEEE floats for money is a defect, not a tradeoff                                |
| C9  | **Realtime subscriptions**                                                                                             | Messaging is the class. Dashboards and shared ERP queues want it too                                    |
| C10 | **Inbound webhooks**                                                                                                   | Stripe says "paid", the app must hear it. Outbound-only is half a connector story                       |
| C11 | **Scheduled work** — cron / queued jobs                                                                                | Invoice runs, fee reminders, streak resets, nightly syncs                                               |
| C12 | **Notifications** — in-app, email, push                                                                                | Every class. Email/SMS exist as _tools_; nothing models a notification                                  |
| C13 | **Responsive layout**                                                                                                  | Websites and fitness are phone-first. Currently `[DEFERRED]`                                            |
| C14 | **SEO / public pages** — meta, title, OG, crawlable HTML, sitemap                                                      | A marketing website that renders an empty `<div>` to a crawler is not a website                         |
| C15 | **Documents** — PDF, print stylesheet, report layout                                                                   | Invoices, report cards, statements, purchase orders                                                     |
| C16 | **Bulk import / export** — CSV in and out                                                                              | School rosters, ERP master data, CRM lead lists. First-hour task in every one                           |
| C17 | **Audit trail / soft delete**                                                                                          | ERP and finance compliance; "who changed this" is a table, not a feature                                |
| C18 | **Error boundaries in the emitted app**                                                                                | A 40-screen app that whitescreens on one bad row is unshippable. `[DEFERRED]`                           |
| C19 | **Project scale in the studio** — 40+ screens: search, folders, jump-to                                                | The editor's own scaling wall, hit long before the compiler's                                           |
| C20 | **Platform + deploy** — accounts, workspaces, projects, cloud save, one-click ship                                     | None of the above matters if the work lives in one browser's localStorage                               |

### Which class needs which

`●` blocking · `○` wanted

|             | C1  | C2  | C3  | C4  | C5  | C6  | C7  | C8  | C9  | C10 | C11 | C12 | C13 | C14 | C15 | C16 | C17 |
| ----------- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| School mgmt | ●   | ●   | ●   | ●   | ●   | ●   | ○   | ○   | ○   | ○   | ●   | ●   | ○   |     | ●   | ●   | ○   |
| ERP         | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ○   | ○   | ●   | ●   |     |     | ●   | ●   | ●   |
| Ecommerce   | ○   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ○   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ○   |
| CRM         | ●   | ●   | ●   | ●   | ●   | ●   | ○   | ○   | ○   | ●   | ●   | ●   | ○   |     | ○   | ●   | ●   |
| Dashboards  | ●   | ●   | ●   | ●   | ●   | ●   |     | ○   | ●   | ○   | ○   | ○   | ○   |     | ○   | ●   |     |
| Messaging   | ●   | ○   | ●   | ●   | ●   | ●   |     |     | ●   | ○   | ○   | ●   | ●   |     |     |     |     |
| B2B SaaS    | ●   | ●   | ●   | ●   | ●   | ●   | ○   | ●   | ○   | ●   | ●   | ●   | ○   | ○   | ○   | ●   | ●   |
| Websites    |     | ○   | ●   | ●   | ○   | ○   |     |     |     | ○   | ○   | ○   | ●   | ●   |     |     |     |
| Finance     | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ○   | ●   | ●   | ●   | ●   |     | ●   | ●   | ●   |
| Fitness     | ○   | ○   | ●   | ●   | ●   | ●   |     |     | ○   | ○   | ●   | ●   | ●   |     |     | ○   |     |

**Read the columns, not the rows.** C3 (app shell) and C4 (reusable components) block **ten of ten**
classes. C1, C2, C5 and C6 block eight or nine. Those six are the whole story; the rest are
class-specific.

---

## 2. Where loom stands today

67 commits. M0–M5, P0–P5, S0–S3, C0–C4, D1–D9, A2–A3, G1–G2, V1, L1, T1–T3, plus the Code and
README phases. What exists is substantial and is not in question below — only what is missing.

**Shipped and load-bearing**

- **IR + compiler.** [`packages/ir/src/schema.ts`](../packages/ir/src/schema.ts) — 627 lines, zod,
  stable ids, id-keyed maps. [`packages/compiler`](../packages/compiler) emits a Vite + React + TS
  repo with routes, server functions, styles, migrations, a README and a Dockerfile. 42 unit test
  files, a Playwright suite, and an install-and-build smoke gate.
- **Element vocabulary — 31 types.** `Frame List Table Text Button Link Icon Image Video Audio
Embed Carousel Tiles Avatar Shape TextField MultilineField NumberField DateField Select Checkbox
RadioGroup Slider FileField ImageField BarChart LineChart PieChart Stat Calendar Chat`. Charts are
  inline SVG with no library. Variants (`27`) give every element named modern defaults.
- **Node vocabulary — 6 categories, ~20 kinds.** Categories `ui fn api state db tool`. Kinds
  include `mirror route validate compute math compare logic gate code write currentUser query`
  plus the type-literal nodes. Query operations: `select insert update delete upsert count
aggregate`, with filters, `orderBy` and `limit`.
- **Actions — 12.** `navigate trigger setVariable setField clearField message openUrl copy signIn
signUp signInWith signOut`.
- **Data.** Supabase, Postgres, MySQL, Firestore. Schema editing — tables, columns, relations,
  constraints, indexes — with emitted numbered migrations (`15`, D5–D9).
- **Auth.** Email/password, session in **HttpOnly cookies** (not localStorage —
  [`emit/auth.ts`](../packages/compiler/src/emit/auth.ts)), a `Current user` node, per-artboard
  `guard` redirect, 14 SSO providers.
- **Tools (`22`).** Typed server-side HTTP calls: OpenAI/Anthropic, Stripe, Resend, Twilio, Slack,
  IoT, generic request. Credentials never reach the browser.
- **Files (`29`).** Upload fields plus local / R2 / S3 / Supabase / Firebase buckets, three-step
  signed upload.
- **Studio.** Design canvas with free placement, rulers, guides, grid; Nodes canvas with grouping;
  inspector as a design panel; Problems, Logs, Code, Data, Tools, Files panels; floating Preview
  with device mockups; undo/redo; localStorage autosave.

### The scorecard

|     | Capability               | State        | Evidence                                                                                                                                                                                            |
| --- | ------------------------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Tenancy                  | **None**     | No org/membership entity in the IR; no tenant column concept; no query auto-scoping                                                                                                                 |
| C2  | Roles                    | **None**     | `GuardSchema = { redirectTo }` — one bit. `[DEFERRED]` in `03`                                                                                                                                      |
| C3  | App shell                | **None**     | Every artboard is a whole screen; [`emit/routes.ts`](../packages/compiler/src/emit/routes.ts) has no layout route. `[DEFERRED]`                                                                     |
| C4  | Reusable components      | **None**     | No `ComponentDefinition` in the IR. P7 in `10` is unbuilt                                                                                                                                           |
| C5  | Relations / nested reads | **Half**     | Relations can be _created_ (D6); a query cannot _traverse_ one. No join, no embed                                                                                                                   |
| C6  | Server pagination        | **Half**     | `limit` + `orderBy` + filters exist. `List.pageSize` explicitly pages _what was fetched_ — `defs.ts` says so in a comment. No offset, no cursor, no exact count                                      |
| C7  | Transactions             | **None**     | Each db node is its own statement in `emit/server.ts`                                                                                                                                               |
| C8  | Money / decimal          | **None**     | `TypeRef` has `number`. No decimal, currency or timezone                                                                                                                                            |
| C9  | Realtime                 | **None**     | No subscribe node, no channel                                                                                                                                                                       |
| C10 | Inbound webhooks         | **None**     | `tools.ts` is outbound only                                                                                                                                                                         |
| C11 | Scheduled work           | **None**     | No cron trigger, no queue                                                                                                                                                                           |
| C12 | Notifications            | **Half**     | Email/SMS/Slack exist as tools. No notification model, no in-app inbox, no push                                                                                                                     |
| C13 | Responsive               | **None**     | One flex layout; `free` mode actively fights reflow. `[DEFERRED]`                                                                                                                                   |
| C14 | SEO / public pages       | **None**     | SPA only; no meta, no prerender, no sitemap. Next.js target `[DEFERRED]`                                                                                                                            |
| C15 | Documents / PDF          | **None**     | —                                                                                                                                                                                                   |
| C16 | CSV import/export        | **None**     | —                                                                                                                                                                                                   |
| C17 | Audit trail              | **None**     | —                                                                                                                                                                                                   |
| C18 | Error boundaries         | **None**     | `[DEFERRED]`                                                                                                                                                                                        |
| C19 | Studio at 40 screens     | **Untested** | Flat artboard list, no search or folders; canvas performance unmeasured past a handful of screens                                                                                                    |
| C20 | Platform + deploy        | **None**     | [`main.tsx`](../apps/studio/src/main.tsx) restores from **localStorage**. No accounts, workspaces, projects or cloud save. No Vercel deploy connector — `emit/container.ts` writes a Dockerfile, which is a different thing (M6 unbuilt) |

**Five of twenty green-ish, fifteen absent.** The compiler and the element vocabulary are ahead of
plan. Everything that makes an app _multi-user, multi-tenant, at scale, and shipped_ is behind it.

### Decisions this ambition forces

`[DEFERRED]` lines in `03-system-memory.md` that the new target **reverses**. Take these
explicitly — silently building past a decision log is how the log stops being true.

| Deferred line                       | Why it must move                            | Call                                                                                                     |
| ----------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Role-based access in generated apps | C2 blocks 9/10 classes                      | **Reverse.** Build it as _surfacing Supabase RLS_, never a parallel authorization model (`10`'s rule)     |
| App-shell / nested layouts          | C3 blocks 10/10                             | **Reverse.** Highest ratio of unlock to effort in this document                                          |
| Responsive breakpoints              | Websites and fitness are phone-first        | **Reverse, narrowly.** Two breakpoints, not a breakpoint system. See L3                                  |
| Runtime error boundaries            | A 40-screen app cannot whitescreen          | **Reverse.** One boundary per route, one per List item. Small                                            |
| Next.js / RSC target                | C14 needs crawlable HTML                    | **Do not reverse.** Prerender the SPA at build time. A second emitter target doubles the compiler        |
| Reusable sub-graphs (v1.5)          | 40 screens duplicate pipelines, not just UI | **Reverse after the UI half.** Ship R1 first, then reassess at R4                                        |

**The standing tension, named once.** `CLAUDE.md` says _"the scope ceiling is a feature."_ Ten app
classes is a wider target than "the 80% of data-driven apps," and the failure mode is loom drifting
into a general-purpose VPL. The discipline that prevents it is unchanged and binds every phase
below: **each capability enters as a small named vocabulary with a fixed count, not as an expression
language.** Roles are a list of names, not a policy DSL. A transaction is a container, not a
scripting construct. The arbitrary 20% still goes to the Code node (guardrail 7).

The countable budget this whole plan spends:

| Vocabulary   | Today | This plan adds | After  |
| ------------ | ----- | -------------- | ------ |
| Elements     | 31    | 5              | 36     |
| Node categories | 6  | 1 (`event`)    | 7      |
| Node kinds   | ~20   | 5              | ~25    |
| Actions      | 12    | 1              | 13     |

Anything beyond those numbers needs an argument, not a ticket.

---

## 3. The component↔node model

This section is the part most likely to be skipped and most expensive to skip. Every new element in
§6 has a node face, and there is exactly one place that decides what it is.

### 3.1 How the bridge works today

Five mechanisms, all pivoting on one function.

**(a) `mirrorPortsFor(componentType) → Port[]`** —
[`packages/components/src/nodes.ts:603`](../packages/components/src/nodes.ts#L603). A hand-written
switch over the type string. It is the **single chokepoint**: it decides whether an element exists
in Nodes mode at all, and what it can send or receive.

```
Button                         → out  trigger  onClick
TextField / MultilineField     → out  data     value : text
NumberField / Slider           → out  data     value : number
Checkbox                       → out  data     checked : boolean
Select / RadioGroup            → out  data     value : text
DateField                      → out  data     value : text
Text                           → in   data     content : any
Image                          → in   data     source : text
Link                           → in   data     address : text
List / Table                   → in   data     items : list<record>
(everything else)              → []
```

**(b) `ensureMirror(componentId, position)`** —
[`apps/studio/src/state/graph.ts:40`](../apps/studio/src/state/graph.ts#L40). Mirrors are
materialised **lazily, on the first wire that touches one**, so the graph is not pre-filled with
nodes nobody wired. `ports.length === 0` ⇒ returns `undefined` ⇒ **the element can never appear in
Nodes mode.**

**(c) The wire↔prop bridge** —
[`apps/studio/src/state/graph.ts:283`](../apps/studio/src/state/graph.ts#L283). Drawing a data wire
into a mirror's `in` port emits `setProp(component, port.name, { kind: 'bound', source })`.

> **The port name _is_ the prop key.** That is the entire naming contract between the two modes, it
> is undeclared, and nothing checks it. `Text` needs a special case (`content`) because the two
> already disagree.

A trigger wire _out_ of a mirror appends `{ kind: 'trigger', target }` to the component's `onClick`
handler — the wire and the action are one fact in two views (spec 7).

**(d) The compiler reads back through `mirrorOf`** — in
[`emit/props.ts`](../packages/compiler/src/emit/props.ts),
[`emit/artboard.ts`](../packages/compiler/src/emit/artboard.ts),
[`emit/derived.ts`](../packages/compiler/src/emit/derived.ts),
[`emit/pipeline.ts`](../packages/compiler/src/emit/pipeline.ts) and
[`emit/state.ts`](../packages/compiler/src/emit/state.ts). A binding whose `source` points at a
mirror resolves to the mirrored component's local state rather than to a pipeline result.

**(e) Container nodes derive their ports from their body** — `apiPortsFromBody(body)`, same file.
The first step's inputs become the route's inputs; the last step's output types the result. This is
the pattern every future container node copies.

### 3.2 The audit: three lists that must agree, and do not

Three hand-maintained lists in `packages/components/src/nodes.ts` describe the same elements from
three angles, and **nothing enforces agreement between them**:

| List                | Purpose                                            | Covers  |
| ------------------- | -------------------------------------------------- | ------- |
| `mirrorPortsFor`    | what the element can send/receive in Nodes mode     | 14 of 31 |
| `FIELD_STATE_TYPES` | whether its value lives in local state in the app   | 8 of 31  |
| `acceptsItems`      | whether it renders once per row of a bound list     | 7 of 31  |

Consequences found in the current tree:

- **17 of 31 elements have no node face at all.** `Frame Icon Video Audio Embed Carousel Tiles
Avatar Shape FileField ImageField BarChart LineChart PieChart Stat Calendar Chat`.
- **Charts, Calendar and Chat declare `acceptsItems: true`, their templates read
  `component.props.items` ([`templates/charts.ts:22`](../packages/compiler/src/templates/charts.ts#L22)),
  and `mirrorPortsFor` has no case for them.** The compiler can render bound rows into a chart; the
  designer has no port to wire a query into. Bindable by the compiler, unwireable by hand.
- **`acceptsItems` is consumed by nothing.** It is declared in `defs.ts` and read by no compiler or
  studio code anywhere in the repo. A flag that means nothing is worse than a missing one.
- **`FileField` / `ImageField` diverge three ways.** The compiler calls `ctx.requireFieldState(...)`
  for them ([`templates/upload.ts:59`](../packages/compiler/src/templates/upload.ts#L59)), so the
  emitted app _does_ hold the uploaded URL in state — but `FIELD_STATE_TYPES` does not list them and
  `mirrorPortsFor` has no case, so the studio believes they have neither. The uploaded URL cannot be
  wired into an insert. `docs/29` promises "a value a database column can hold"; the graph cannot
  carry it there.
- **Port types cannot depend on configuration.** `mirrorPortsFor` takes a _type string_ and nothing
  else. The `Select` case says so in a comment: it emits `text` rather than an enum of the options
  because typing it "would need the mirror to read the component's config." The same wall blocks
  money-typed number fields (Q4) and instance ports (R1).

There is already a drift test for the _other_ half of this contract —
[`packages/compiler/test/vocabulary.test.ts`](../packages/compiler/test/vocabulary.test.ts) asserts
every `ComponentDef` has a code template, because "a type the studio can place but the compiler
cannot emit is a broken editor." The same argument applies to the node face and no test makes it.

### 3.3 The rule going forward

> **Every element declares its node face in its own definition, in one place, and a test fails when
> it does not.**

Concretely — this is phase **N0**, and it comes before every element this plan adds:

1. **Move the node face onto `ComponentDef`.** A `node` field replaces the switch:

   ```ts
   interface ComponentDef {
     // ...existing
     node?: {
       /** Ports this element exposes when mirrored. `propKey` makes the naming contract explicit. */
       ports: (config: Record<string, unknown>) => MirrorPort[];
       /** Its value lives in local state in the emitted app (replaces FIELD_STATE_TYPES). */
       fieldState?: boolean;
       /** It renders its template once per row (replaces acceptsItems, and is now *read*). */
       perRow?: boolean;
     };
   }

   interface MirrorPort extends Port {
     /** The component prop this port binds. Explicit, because today the port *name* is the key. */
     propKey: string;
   }
   ```

2. **`ports` takes the component's config**, so a `Select` types its port as
   `enum(options)`, a money-mode `NumberField` types it `money`, and an `Instance` types its ports
   from its definition's params. This is the change the current comment asks for by name.

3. **`mirrorPortsFor` becomes a thin lookup** over `ComponentDef.node`, keeping every existing call
   site working. `hasFieldState` and `acceptsItems` become lookups too, and the three lists become
   one.

4. **A declaration of _no_ node face is explicit**, not an absent switch case: `node: undefined`
   with a comment saying why (a `Shape` is decoration; it genuinely has nothing to send).

5. **The drift test grows a third assertion.** Table-driven over `componentDefs()`:
   - every def has a code template _(exists today)_,
   - every def either declares `node` or explicitly declares it has none,
   - every `MirrorPort.propKey` names a real key in that def's `fields`,
   - every def with `perRow` has an `in` port carrying `list<record>`.

**Done-when (N0):** the five elements that declare `acceptsItems` today can be wired to a query in
Nodes mode; `FileField`'s uploaded URL can be wired into an insert; and the new test fails if
someone adds an element without answering the node question.

### 3.4 The element intake checklist

Every element added from here — the five in §4, and every one after — lands in **seven** places.
Missing any one is the defect class §3.2 documents:

| # | File                                          | What lands                                          |
| - | --------------------------------------------- | --------------------------------------------------- |
| 1 | `packages/components/src/defs.ts`             | the `ComponentDef` — fields, variants, layout, size |
| 2 | `packages/components/src/defs.ts` (`node`)     | **the node face** — ports + propKey, fieldState, perRow |
| 3 | `packages/components/src/variants.ts`         | its CSS class name                                  |
| 4 | `packages/ui/src/variants.ts`                 | the stylesheet the canvas *and* the app are painted by |
| 5 | `packages/compiler/src/templates/*.ts`        | the emitter, registered in `templates/registry.ts`  |
| 6 | `packages/compiler/src/diagnostics.ts`        | what it means for it to be misconfigured            |
| 7 | `packages/components/src/icons.ts`            | the palette icon                                    |

---

## 4. Node vocabulary for every new capability

The complete node-side delta, in one table, so §6 can stay about the work rather than the wiring.

### 4.1 New elements (5) and their node faces

| Element      | Phase | Node face (`ComponentDef.node`)                                                                                                                                                        |
| ------------ | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Instance** | R1    | **Ports from its definition**: one `in` data port per declared param (typed by the param), one `out` trigger port per event the definition exposes. Requires the config-aware `ports(config)` signature from N0 — this is its forcing function |
| **Outlet**   | R2    | `node: undefined`. It is a hole where a route renders; it has nothing to send or receive. Declared as none, explicitly                                                                  |
| **Pager**    | Q2    | `out data page : number` (`propKey: page`) · `in data total : number` (`propKey: total`). Wire the query's `pt_total` in and the `page` out into the query's `pt_offset`. No new node kind |
| **Importer** | Q5    | `out data rows : list<record>` · `out data errors : list<record>` · `out trigger parsed`. Its rows wire straight into an insert, so a bulk import is the ordinary insert node, batched   |
| **Inbox**    | E4    | `in data items : list<record>` (`perRow: true`) · `out data unread : number` · `out trigger opened`. A List shape with an unread count; not a new runtime                               |

### 4.2 Existing elements gaining a node face at N0

| Element                              | Node face added                                                                                                             |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `BarChart` `LineChart` `PieChart`     | `in data items : list<record>` (`propKey: items`, `perRow: true`) — closes the declared-but-unwireable gap                   |
| `Calendar`                            | `in data items : list<record>` · `out data month : text` · `out trigger dayPicked`                                          |
| `Chat`                                | `in data items : list<record>` · `out data draft : text` · `out trigger sent`                                               |
| `Stat`                                | `in data value : number` (`propKey: value`) — the number every dashboard puts at the top                                     |
| `FileField` `ImageField`              | `out data value : text` (the uploaded URL) + `fieldState: true` — matches what the compiler already emits                    |
| `Video` `Audio` `Embed` `Avatar`      | `in data source : text` (`propKey: src`)                                                                                    |
| `Icon`                                | `in data name : text` — an icon that changes with status                                                                    |
| `Select` `RadioGroup`                 | port type becomes `enum(options)` read from config, replacing today's `text` fallback                                       |
| `Frame` `Shape` `Carousel` `Tiles`    | `node: undefined`, explicitly, with the reason                                                                              |

### 4.3 New node kinds (5) and one new category

| Node                  | Category  | Phase | Ports                                                                                                                    | Notes                                                                                             |
| --------------------- | --------- | ----- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Current org**       | `state`   | O1    | `out id : text` · `out name : text` · `out role : enum(roles)`                                                           | Sits beside `Current user`, resolved from the session server-side. Never writable from the client |
| **Transaction**       | `fn`      | Q3    | **Container**, ports derived from body like `apiPortsFromBody`: `in run : trigger`, body-derived inputs, `out result`, `out error`, `out rolledBack : boolean` | Its body is one statement block. It may only contain `db` steps — the compiler refuses anything else, because a tool call cannot be rolled back |
| **Subscribe**         | `event`   | E1    | `out rows : list<record>` · `out change : record` · `out changed : trigger`                                              | Config is a table + filter. `rows` wires into a List's `items` — reuses the whole existing path   |
| **Webhook**           | `event`   | E2    | **Container**, source-shaped: no `in` ports. `out payload : record` (typed per sender) · `out received : trigger`         | Emits an API route with signature verification. The body runs server-side, same rule as a route   |
| **Schedule**          | `event`   | E3    | **Container**, source-shaped: `out tick : trigger`                                                                       | Config is a cron expression. Emits the cron entry and the route it calls                          |

**Why `event` is a category and not three `fn` kinds.** The five existing categories answer "what
does this node do." These three answer something different — **who starts it**. A `fn` runs when
something upstream fires it; an `event` node _is_ the upstream, started by the outside world. That
distinction is worth a colour on the canvas because it is the first thing a reader needs to know
about a graph they did not draw. It also carries a rule: **an `event` node has no data `in` ports**,
which is what makes it a source and what the checker enforces.

### 4.4 Node-side changes to existing nodes

| Node             | Phase | Change                                                                                                                                                 |
| ---------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `db / query`     | Q1    | `select` config grows `through` (one level of FK traversal); the `out` row type gains nested `list` fields                                              |
| `db / query`     | Q2    | new `in` ports `offset : number`, and `out` ports `total : number`, `hasMore : boolean`. `countMode: 'exact'` config                                    |
| `db / query`     | Q6    | `includeDeleted : boolean` config on reads when the table is soft-delete; `delete` emits `deleted_at` instead                                           |
| `fn / gate`      | O2    | accepts a `role` condition source — no port change, the condition vocabulary widens                                                                     |
| `fn / math`      | Q4    | decimal-safe path when either operand is `decimal` or `money`; the checker refuses mixing currencies                                                    |
| `api / route`    | O3    | every emitted route answers as the requesting user rather than the service role when tenancy is configured                                              |
| `ui / mirror`    | R2    | scoped to a **layout** as well as an artboard — `graphNodesFor(snapshot, scopeId)` takes a layout id                                                    |

### 4.5 The one new action (12 → 13)

**`download`** — takes a `ValueSource` (a bound list or a document artboard id) and a format
(`csv` · `pdf`). Argued per spec 7's bar: export is initiated by a click, produces no value, and
navigates nowhere — every property of an action and none of a node. Making it a node would put a
node on the canvas whose output nothing reads, which is the shape of a mistake.

Export is therefore **not** in the node vocabulary; import is, because import produces rows that
something downstream must consume.

---

## 5. IR changes

The snapshot is the save format, the compiler input and the versioning atom. Changing it late is
expensive; enumerating it now is free. Land these in **one wave with one `SCHEMA_VERSION` bump**;
every field is optional so every existing document still parses — the rule `layout.mode` and
`EventHandler` already follow.

```ts
// C4 — reusable components
definitions: Record<Id, ComponentDefinition>   // new snapshot root key
ComponentDefinition = { id, name, root: Id, params: Param[] }
Component.type = 'Instance' → props: { defId, overrides: Record<Id, PropertyValue> }

// C3 — app shell / nested layout
layouts: Record<Id, LayoutDefinition>          // new snapshot root key
LayoutDefinition = { id, name, root: Id }      // its subtree contains exactly one `Outlet`
Artboard.layoutId?: Id

// C1/C2 — tenancy and roles
Snapshot.roles?: string[]                      // an option set: deliberately just names
Snapshot.tenancy?: { orgTable, membershipTable, tenantColumn, roleColumn }
GuardSchema += { requireRole?: string[] }
ConditionSchema += { kind: 'role'; role: string }

// C5/C6 — reads that scale
QueryConfig += {
  select?: { column: string; through?: { table; on; columns } }[]   // one level of embed
  offset?: number | PortRef
  cursor?: { column: string; after?: PortRef }
  countMode?: 'none' | 'exact'
}

// C7/C8 — correctness
NodeCategory 'fn' += kind 'transaction'        // a container; its body is one statement block
TypeRef += { kind: 'decimal'; scale: number }
TypeRef += { kind: 'money'; currency: string }

// C9/C10/C11 — events
NodeCategory += 'event'                        // kinds: 'subscribe' | 'webhook' | 'schedule'
NodeCategory 'state' += kind 'currentOrg'

// C13/C14
Artboard.meta?: { title; description; image }  // static in v1; bound meta is a v2 line
Artboard.kind?: 'screen' | 'document'          // C15: page size + margins for print
Style.responsive?: Partial<Record<'sm' | 'lg', Style>>    // two keys, not a breakpoint system
Layout.responsive?: Partial<Record<'sm' | 'lg', Layout>>

// §4.5
ActionSchema += { kind: 'download'; value: ValueSource; format: 'csv' | 'pdf'; ...withCondition }
```

**Ops.** `packages/ir/src/ops.ts` currently cascades mirror deletion in three places
(lines 204, 216, 487). Two new cascades join it: deleting a `ComponentDefinition` must handle its
instances (refuse while any exist — a dangling instance is worse than a blocked delete), and
deleting a `LayoutDefinition` must clear `layoutId` on every artboard using it.

---

## 6. The plan: six tracks

Within a track, phases are ordered; across tracks, they parallelize. Every phase ends with a
**runnable artifact and a gate that can fail** — the rule from `09` and `10`.

### N0 — Unify the component↔node registry ✅ _(done)_

Per §3.3. Move the node face onto `ComponentDef`, make `ports` config-aware, collapse the three
lists into one, add the drift test, and close the gaps in §4.2.
**Done-when:** the five `acceptsItems` elements are wireable to a query; `FileField`'s URL wires
into an insert; and adding an element without a node declaration fails a test.
**Why first:** R1's `Instance` and Q4's money field are both blocked on the config-aware signature,
and every element after this inherits the checklist instead of the defect.

**Landed.** `ComponentDef.node` is required and `null` is a real answer, so an element added
without deciding is a type error. `mirrorPortsFor` takes the component rather than its type and
reads the declaration. All 31 elements answer: 26 have a face, 3 declare none (`Frame`, `Shape`,
`Tiles`), and the 17 that had no node presence now do. `FIELD_STATE_TYPES` and `acceptsItems` are
gone — the latter was read by nothing.

Two live bugs fell out of writing it down, both from the port *name* being used as the property
key: an Image's `source` port wrote `props.source` while `templates/media.ts` read `props.src`, and
a Link's `address` port wrote `props.address` while its emitter read `props.href`. Wiring either
drew a wire and changed nothing. `MirrorPort.propKey` separates the two strings.

Gate: `packages/components/test/nodeFace.test.ts`, six rules, each one a shape that had already
shipped broken. Verified red by reintroducing the Image bug.

### Track R — Structure _(the 10/10 unlock)_

**R1 — Reusable components.** `ComponentDefinition` + `Instance` + per-instance overrides;
promote-a-frame gesture; a definitions list in the Elements panel; the compiler emits one real React
component per definition and JSX instances with props.
**Node side:** an `Instance` mirrors with one `in` port per definition param and one `out` trigger
per exposed event — the first consumer of N0's config-aware ports. A definition's internals are
**not** wireable from outside it; only its params are. That boundary is what makes an instance a
component rather than a group.
_Done-when:_ a header is defined once, placed on three screens, edited once, all three change — in
the Preview, asserted in Playwright.

**R2 — App shell / nested layouts.** `LayoutDefinition` holding a subtree with one `Outlet`;
artboards opt in via `layoutId`; `emit/routes.ts` emits a react-router layout route; active nav
state derived from the current route.
**Node side:** the graph gains a **layout scope**. `graphNodesFor(snapshot, scopeId)` today takes an
artboard id; it takes a layout id too, and a mirror of a sidebar button lives in the layout's graph,
not in every screen's. A layout's graph may read `Current user` and `Current org` and may not read
any screen's state — the same wall that makes the layout reusable.
_Done-when:_ a sidebar drawn once persists across four routes without re-rendering, and the active
item is correct on each.

**R3 — Project navigation at scale (C19).** Screen search, folders in the artboard list,
jump-to-screen, and a measured canvas budget at 40 artboards / 400 components.
**Node side:** the Nodes canvas needs the same treatment — a graph with 200 nodes needs find and
frame-selection, not just pan.
_Done-when:_ a 40-screen fixture opens, navigates and edits with interaction under 100 ms; the
number is in a test, not a claim.

**R4 — Reusable pipelines.** The sub-graph deferral revisited once R1 proves the instance model. A
named pipeline with typed inputs, invoked from several screens.
**Node side:** a `fn / pipeline` container whose ports come from its body, exactly as
`apiPortsFromBody` already does — the third user of that pattern, which is the evidence it was the
right one.
_Done-when:_ one "create invoice" pipeline is invoked from three screens.

### Track O — Tenancy and access

**O1 — Organizations.** Tenancy setup in the Data panel: pick or generate the org table, the
membership table and the tenant column; the emitted app resolves **current org** from the session
the way it already resolves current user.
**Node side:** the `state / currentOrg` node (§4.3). Reads only. Its `role` port is typed
`enum(Snapshot.roles)` once O2 lands, `text` before that.
_Done-when:_ two orgs exist, two users sign in, each sees only their org's rows.

**O2 — Roles.** `Snapshot.roles` as a named option set; `requireRole` on a guard; a `role` condition
for element visibility; the role read from the membership row, never from the client.
**Node side:** no new node. The `role` condition source feeds the existing Gate, and `currentOrg`'s
`role` port narrows to an enum — composition happens in nodes, as conditions already do.
_Done-when:_ a teacher opening an admin route is redirected, and an admin-only button is **absent**
from the teacher's DOM, not hidden.

**O3 — RLS generation.** _The security phase. Do not ship O1/O2 without it._ Tenant and role rules
emit as **Supabase row-level-security policies in a migration the user owns**, and the app's server
queries answer as the requesting user rather than as the service role.

> A client-side guard is a UX affordance. The database is the only thing that actually refuses. O1
> and O2 without O3 are a decoration over an open table.

**Node side:** no new node. Every `api / route` changes who it answers as.
_Done-when:_ with the emitted policies applied, a hand-rolled `curl` carrying user A's session
**cannot** read org B's rows — a test that _attempts the breach_ and asserts the refusal.
_Verify first, per `04`:_ Supabase RLS and `auth.jwt()` claim shapes against live docs, before
design.

**O4 — Invites and membership.** Invite by email, accept, member list, role change, removal.
**Node side:** deliberately nothing new — an insert, an email tool call and a Table. If O4 needs a
new node kind, the vocabulary is wrong somewhere upstream; treat that as a finding.
_Done-when:_ an owner invites a user who accepts and lands in the right org with the right role.

### Track Q — Data that scales

**Q1 — Relations and nested reads (C5).** A read traverses a declared foreign key **one level** and
returns the related rows as a nested typed list. One level, not arbitrary depth — depth is where a
query builder becomes a query language.
**Node side:** the query node's out-port row type gains nested `list` fields; a List nested inside a
List binds its `items` to `{ kind: 'item', field }` — the `item` PropertyValue kind already exists
and does not change.
_Done-when:_ one query returns orders each carrying their line items, and a nested List renders them.

**Q2 — Server-side paging, sort and search (C6).** `offset`/`cursor` and `countMode: 'exact'`; a
Table/List that requests a page rather than slicing one; a search field bound into a filter value;
sortable columns issuing a new read.
**Node side:** the new query ports (§4.4) plus the **Pager** element (§4.1). A search box is an
existing `TextField` mirror wired into a filter value — no new element for search.
_Done-when:_ a 100k-row table pages, sorts and searches, and the network tab shows one page-sized
response per interaction. **Assert the response size, not just the screen.**

**Q3 — Transactions (C7).** The `fn / transaction` container; its body's writes emit as one
statement block (a Postgres function, or explicit `begin`/`commit`); a failure rolls back.
**Node side:** the container may hold **only `db` steps**, and the compiler refuses anything else
with a Problems row — a tool call cannot be rolled back, and a transaction that silently half-honours
its promise is worse than no transaction.
_Done-when:_ a checkout that decrements stock and inserts an order leaves neither behind when the
second step fails.

**Q4 — Money, decimal and timezone (C8).** `decimal` and `money` in the type vocabulary; the
compiler refuses to bind a float column to a money port; currency-aware formatting; date columns
carrying a timezone rather than assuming the browser's.
**Node side:** a `NumberField` in money mode types its mirror port `money`, not `number` — the
second consumer of N0's config-aware ports. Math nodes take a decimal-safe path and the checker
refuses mixing currencies.
_Done-when:_ `0.1 + 0.2` on a money port is `0.30`, and a fixture proves it.

**Q5 — Import and export (C16).** CSV in with a column-mapping step and per-row error reporting;
CSV/XLSX out from any read.
**Node side:** the **Importer** element (§4.1) whose `rows` wire into an ordinary insert, batched.
Export is the `download` action (§4.5), not a node.
_Done-when:_ a 5,000-row roster imports with three bad rows reported by row number, and the rest
committed.

**Q6 — Audit trail and soft delete (C17).** Opt-in per table: a history row per write, `deleted_at`
instead of `DELETE`. Emitted as triggers in a migration the user owns.
**Node side:** `includeDeleted` on reads; delete becomes an update under the hood, and the node says
so on the canvas rather than pretending.
_Done-when:_ an edited row's previous value is readable, and a deleted row is gone from every read
but present in the table.

### Track E — Events and time

**E1 — Realtime (C9).** The `event / subscribe` node; the emitted app opens one channel and merges
changes into the bound read.
**Node side:** `rows` wires into a List's `items` exactly as a query's result does — the payoff for
N0 is that charts, Calendar and Chat accept it too, with no per-element work.
_Done-when:_ two browsers, one message, no reload.

**E2 — Inbound webhooks (C10).** The `event / webhook` container; an API route with signature
verification for the known senders (Stripe first); a typed payload out.
**Node side:** the first **source container** — no data `in` ports, which is the rule that defines
the `event` category and which the wire checker enforces at the gesture.
_Done-when:_ a Stripe test event marks an order paid, and an unsigned request is rejected with 401.

**E3 — Scheduled work (C11).** The `event / schedule` container; emits the cron entry
(`vercel.json`, or the platform's equivalent) plus the route it calls; the run appears in Logs.
_Done-when:_ a nightly job runs on schedule against a real deployment and its run is visible.

**E4 — Notifications (C12).** A notification is a row plus a channel: in-app inbox with unread
counts, email via the existing Resend tool, web push.
**Node side:** the **Inbox** element (§4.1) and nothing else — an insert plus a tool call is already
the whole backend. Resisting a `notify` node here is the test of whether the vocabulary held.
_Done-when:_ one action produces an unread badge and an email, from one place in the graph.

### Track L — Layout reach

**L1 — Error boundaries (C18).** One boundary per route, one per List item, emitted always.
**Node side:** none. Pure emission.
_Done-when:_ a row that throws shows a row-level error and the other rows still render.

**L2 — Documents and print (C15).** `Artboard.kind: 'document'` with page size and margins, emitted
as a print stylesheet plus a browser-side PDF path.
**Node side:** none — the `download` action (§4.5) prints it. A document artboard reads params like
any other, so "invoice #123" is the flow payload mechanism already built at M2.
_Done-when:_ an invoice prints to a correct A4 PDF with a repeating header.

**L3 — Responsive, narrowly (C13).** **Two** breakpoints — `sm` and the base — as style and layout
overrides. `free`-placed frames warn honestly that they will not reflow, because they will not.
**Node side:** none.
_Done-when:_ one screen reads correctly at 390 px and 1440 px with no second document.

**L4 — Public pages and SEO (C14).** `Artboard.meta`, a public/private flag, build-time prerender of
public routes to real HTML, `sitemap.xml`, `robots.txt`.
**Node side:** none. Meta is **static in v1** — bound meta would need an artboard-scoped mirror, and
that is a v2 line, taken deliberately rather than by drift.
_Done-when:_ `curl` on a public route returns the heading text in the HTML body, and Lighthouse SEO
is ≥ 95.

### Track H — Platform and shipping _(parallel from day one)_

Everything above is worthless in a browser tab one cleared cache erases. This is the track `09`
already planned and nobody has built.

**H1 — Accounts, workspaces, projects.** Platform Supabase (auth + Postgres metadata), the
`User / Workspace / Project / Membership` model, gated signup, the project dashboard. Two auth
systems never blurred: the designer's login to loom is a different universe from the generated app's
users (guardrail 3).
_Done-when:_ sign up, create two projects, open one, the other untouched.

**H2 — Cloud save.** R2 blob **then** Postgres pointer, in that order (`02`), behind the storage
interface P0 already put in place.
_Done-when:_ a project saved on one machine opens on another.

**H3 — Deploy (M6).** The Vercel managed-deploy connector: push the emitted repo, inject env by
name, report the URL. The Dockerfile path from C1 stays as the second target.
_Done-when:_ a project deploys to the user's Vercel and answers on a real URL, with no terminal.

---

## 7. Sequence: three waves

The rule inside each: **nothing that fills a 9/10 or 10/10 column waits behind something
class-specific.**

**Wave 1 — make a real app expressible**
`N0 → R1, R2 · O1, O2, O3 · Q1, Q2 · H1, H2, H3 · L1`

Turns "a five-screen demo" into "a multi-tenant CRM." N0 unblocks the element work; R1+R2 are the
structural unlock; O1–O3 are the tenancy unlock and the security boundary; Q1+Q2 are the data
unlock; H1–H3 mean it ships.

_Acceptance test:_ build a **two-tenant CRM** — org signup, invite a colleague, an admin and a
member role, contacts with related activities, a searchable paged 50k-row table, one shared sidebar
— deploy it, and confirm from a second account that tenant isolation holds **under a deliberate
breach attempt**.

**Wave 2 — make it correct and current**
`Q3, Q4, Q5, Q6 · E1, E2, E3, E4 · R3, R4`

Transactions and money make finance and ERP honest; realtime makes messaging possible; webhooks and
schedules make ecommerce and billing real; import/export and audit are the first week of any ERP.

_Acceptance test:_ an **ecommerce app** — catalog, cart, Stripe checkout in a transaction, a webhook
marking paid, a nightly abandoned-cart job, an order inbox that updates live.

**Wave 3 — make it reach**
`L2, L3, L4`

Documents, phones and crawlers.

_Acceptance test:_ a **school portal** that prints report cards to PDF, works on a parent's phone,
and has a public admissions page a search engine can read.

### Class-by-class unlock

| Class                                         | Buildable after                                            |
| --------------------------------------------- | ------------------------------------------------------------ |
| B2B SaaS dashboard, CRM, data/tools dashboard | **Wave 1**                                                 |
| School management                             | Wave 2 (jobs, notifications, import) + L2 for report cards  |
| ERP, Finance                                  | Wave 2 (transactions, money, audit)                        |
| Ecommerce                                     | Wave 2 + L4 for public product pages                       |
| Messaging                                     | Wave 2 (E1)                                                |
| Fitness                                       | Wave 2 + L3                                                |
| Websites                                      | Wave 3 (L3, L4)                                            |

---

## 8. Risks

| Risk                                                                     | Where    | Mitigation                                                                                                                |
| ------------------------------------------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Tenancy is a security boundary, and a wrong one leaks a school's data** | O1–O3    | O3 is not optional and not last. The gate is an _attempted breach that must fail_, not a screenshot of the right rows      |
| The three-list divergence repeats with the five new elements             | N0       | The intake checklist (§3.4) plus the drift test. A new element without a node declaration is a red build                   |
| Roles become a policy DSL                                                | O2       | Roles are a list of names. Composition happens in Gate nodes, as conditions already do                                     |
| Nested reads become a query language                                     | Q1       | One level of traversal. Deeper is a database view or a Code node                                                          |
| A transaction silently half-honours its promise                          | Q3       | The container refuses non-`db` steps at the gesture, with a Problems row saying why                                       |
| `event` becomes a dumping ground for anything hard to place              | E1–E3    | Its defining rule is enforceable: an `event` node has no data `in` ports. A fourth kind must satisfy it                    |
| The scope ceiling dissolves under ten app classes                        | every    | The countable budget in §2: +5 elements, +1 category, +5 kinds, +1 action. Exceeding it needs an argument                  |
| IR churn under twenty additive fields                                    | §5       | One wave, one `SCHEMA_VERSION` bump, every field optional so old documents parse                                          |
| The studio hits its own wall at 40 screens before the compiler does      | R3       | Measure at 40 artboards early, in a test with a number in it                                                              |
| Prerender (L4) quietly becomes an SSR framework                          | L4       | Build-time prerender of public routes only. If insufficient, that is a v2 emitter decision, taken deliberately            |
| Wave 1 is large and gets shipped half-done                               | Wave 1   | Its acceptance test is one app built end to end. A wave without a built app is not a wave that finished                    |

---

## 9. Start here

Picked up cold, in this order:

1. **Take the six decisions in §2** — four reversals, one refusal, one deferral. Record them in
   `03-system-memory.md` with reasons, before any code.
2. **Build N0.** The registry unification in §3.3. It is small, it is the prerequisite for R1 and
   Q4, and it closes 17 elements' worth of existing divergence on the way past.
3. **Land the §5 IR shapes** as optional fields, one `SCHEMA_VERSION` bump, with round-trip
   fixtures.
4. **Build R1, then R2.** The two 10/10 columns, the smallest of the blocking items, and every
   screen built after them is cheaper.
5. **Start H1 in parallel.** Boring plumbing on proven tools (`09`'s rule), and the difference
   between a demo and a product.
6. **Write `docs/specs/tenancy.md`** before O1 — verifying Supabase RLS and `auth.jwt()` claim
   shapes against live docs first, per `04`.
