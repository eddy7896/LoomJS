# 02 — System Architecture

## The spine: graph-as-IR, frameworks/hosts as adapters

The visual graph is an **intermediate representation**. The compiler walks it and emits code
via **adapters** (emit targets). This is standard compiler architecture and it's what keeps
loomJS one coherent product instead of many. Adding a target = writing one adapter.

- **Frontend adapter (V1):** Vite + React + TypeScript SPA, react-router. (Next.js/RSC is
  deferred — it would force the graph to model server/client boundaries.)
- **Backend adapter (V1):** Vercel serverless functions (`/api`). API route node = one real
  endpoint. Logic lives in one place (Vercel), not scattered into Supabase edge functions.
- **Database/auth:** the user's **Supabase** (relational, Postgres). Supabase also supplies
  auth + row-level security, which is why it's the V1 flagship connector.
- **Deploy adapter (V1):** Vercel **managed** deploy (push repo, Vercel builds). Docker/
  container deploy is a separate deferred adapter class.

The compiler is **template emission**, not magic: each node type owns a code template; compile
= stitch templates + wire data flow. It is codegen, a solved category.

## Layers of the system

1. **Design + flow** — Figma-style UI editor; artboards, components, flow arrows.
2. **Logic graph (Nodes)** — FN + API route nodes; the backend pipeline.
3. **Connectors → data** — Supabase (V1). Connectors are the boundary to external services.
4. **Preview** — the compiled app running live against a dev database.
5. **Connectors → ship** — Vercel deploy (V1).

## Components are schema-defined; the inspector is a schema renderer

**A component is an instance of a property schema** (class/instance relationship). The
properties tab is *generated from* the schema — not attached to the component.

- **Definition** lives on the component *type* (native or imported): each property has a name
  and a **type**. Authored once per type.
- **Values** live on each *instance* on the artboard.
- **Property value kinds** (this trio is the seam between the two modes):
  - **static** — a literal the designer typed.
  - **bound** — a wire to a backend node (the Design↔Nodes bridge).
  - **event** — a handler/flow trigger ("onClick → this API route").
- The inspector maps field types → controls (enum→dropdown, boolean→toggle, color→swatch…).
  Imported kits (shadcn) ship a **curated** props manifest — surface useful props only, not
  every prop of a component.

## UI-instances-as-nodes; ports; trigger modes (the binding runtime)

Every placed component gets a **mirror UI node** in Nodes mode. Its ports derive from its
schema:

- **data-properties → data ports** (carry values continuously along wires).
- **events → trigger ports** (fire pipelines; render distinctly, e.g. triangle vs circle —
  control flow, not data flow).
- **inputs are bidirectional**: a `value` output (what the user typed) AND a `setValue` input
  (to pre-fill, e.g. an edit form).
- **container frames aggregate** their children's values into one composed **object port**, so
  a form has identity and validates once. (A route/API node may act as a container holding an
  internal ordered pipeline — the container model keeps top-level graphs readable.)

**Two pipeline trigger modes** (both required; Fintrack needs both on one screen):

- **triggered** — fires on an event port (search box → submit → query → result label).
- **reactive** — runs on mount / when inputs change (dashboard list auto-loads). Inferred from
  the absence of an incoming event wire.

**Ownership discipline (prevents two-canvas confusion):** the **artboard owns existence and
appearance** (create/delete/style in Design mode); **Nodes mode owns behavior** (wiring). You
never create a UI node in Nodes mode — only wire the ones design produced. Deleting a component
deletes its node.

## Connectors: modules that are node factories

A **connector** is a **module** that bridges to an external service. Every connector is a
module; not every module is a connector (a pure FN module touches nothing external).

- A **connector introspects** a live schema and **generates typed nodes per table** — a
  `transactions` node with query/insert/update/delete operations whose ports are the real
  columns with real types (from Supabase's generated TS types). "Access all the data" falls
  out of introspection; it isn't hardcoded.
- Connectors are **collapsible** on canvas (one tidy card; expand to per-table nodes).
- Data flows **both directions**: writes (form → connector insert → table, triggered) and
  reads (table → connector query → UI, reactive).
- **Module = definition + instance.** Definition = manifest (config schema, capabilities,
  exposed nodes) + adapter (implements `connect()`, `introspect()`, operations). Instance =
  configured, credentialed, wired node. Config schema auto-renders the settings form.
- **Typed ports are the universal contract** — third-party modules compose safely because
  ports declare types. **Capability-based security** is mandatory: modules declare and the
  user approves what they touch; adapters are sandboxed.
- **Build first-party connectors on the same module API you'll open up** (dogfood). Public
  marketplace is deferred.

## Modules for the frontend (component kits & behavior libs)

- **Design-system / component kits (shadcn = flagship):** first-party modules that ship a
  **props manifest** to populate the Design **palette**, and orchestrate compile-time setup
  (CLI/file emit, Tailwind, deps like Radix). shadcn is codegen-native (copies owned source),
  which fits loom perfectly. Brand tokens **drive** the kit's Tailwind theme.
- **Behavior/utility libs (Framer Motion):** npm dependency + a **curated preset layer in the
  inspector** (fade/slide/hover-spring), not the raw API.
- **Only styled, prop-documented kits auto-populate the palette.** Unstyled/compound-primitive
  libs (Radix, Headless UI) are dependencies, not palette items.
- **npm generally:** search → install → added to `package.json` → available inside **Code
  nodes**. Surface install incompatibilities (serverless-incompatible, native modules) at
  install time, not deploy time. No auto-node from arbitrary packages.

## Type system (adopt, don't invent)

- **TypeScript is loom's type layer.** Do not build a parallel type language.
- **Supabase-generated TS types are the data spine** — ingest them; DB node ports *are* those
  types.
- **Curated visible vocabulary:** `text`, `number`, `boolean`, `date`, `record`, `list<T>`,
  `optional<T>`, `enum`. Full TS (generics/unions) lives only in emitted code.
- **Inference over annotation** — types flow along wires. Untyped boundaries (Code node output,
  untyped npm) are `any`/`unknown`, **visibly marked**.
- **`tsc` is the authoritative checker.** loom's canvas checker is a fast approximation for
  red-ring feedback.

## State scope: three buckets (distinguished by trust + lifecycle)

- **Screen (local)** — lives/dies with one artboard → React local state.
- **Global (app)** — many screens read/write (current user, theme) → app-level Context/store.
  A STATE node is flagged `app` or `screen`.
- **Env (secrets)** — server-only. Referenced by name; values NEVER in the graph snapshot, R2,
  or the browser bundle. Injected into Vercel/Preview at deploy. The compiler **refuses** to
  wire an env value into any client-side node. Anon key = client-safe config; service key = env.

## Navigation with data

Flow arrows are the router. An arrow can carry a **payload** (e.g. `transaction.id`); the
destination artboard declares matching **input params**. Compiles to `/transactions/:id`. This
unlocks all master→detail flows.

## Errors: three timing tiers (three consoles)

- **Problems (live)** — graph-validity + linting, detected continuously as you edit; muted for
  work-in-progress, sharp red for true breaks; blocks compile. Red port ring + hover tooltip.
- **Build (on compile)** — codegen / `tsc` failures.
- **Runtime (during Preview)** — **graph-aware**: maps a runtime error back to the wire/node on
  the canvas ("wire form→insert carried null `amount`"). This is the forms/data-flow debugger.

## Reusability (two systems)

- **Reusable UI component** (Figma-component style) — define once, instance many, edit once →
  emits a real React component. Required by list-rendering (a row *is* a reusable component).
  **In V1.**
- **Reusable sub-graph / custom node** — a bundled pipeline with a typed signature = a
  user-defined function. **Fast-follow (v1.5)**, after type system + scope settle. Unifies with
  the module system: a connector is just a well-authored custom node.

## Layout model

- **Flex-first, never absolute.** Every Frame is a flex container (direction, gap, padding,
  alignment); children hug/fill/fixed. Emits real responsive CSS. Absolute-position output is
  the classic design-tool trap and is irreversible — do not build it.
- **Tablet-and-up.** V1 needs no breakpoints (flex reflows within a constrained band). Below
  ~768px, emit a graceful "designed for tablet and up" guard. Breakpoints = v2 (additive).

## Platform layer (loomJS itself)

Build boringly, fast, on proven tools — reserve invention for the compiler.

- **Built on Supabase** (auth, Postgres metadata) — dogfoods the connector.
- **Data model:** User, Workspace, Project, Membership(role). **Design as if teams exist**
  (workspace is a distinct entity; users join via membership+role) but ship **single-workspace**
  in V1 (invites/teams disabled). This keeps the collaboration door cheap to open.
- **Project storage:** the graph **snapshot** + assets live in **Cloudflare R2** (zero egress,
  S3-compatible, versioning-ready). Postgres holds the queryable **metadata + R2 pointer**.
  Save order: write R2 blob first, then update the Postgres pointer (orphan blob is harmless;
  dangling pointer is not). Keep searchable facts in Postgres, not buried in the R2 blob.
- **Closed beta:** gated signup (invite codes / allowlist).
- **Two auth systems, never blurred:** *platform auth* (designer logs into loom) vs. *app auth*
  (end-users of the generated app, powered by the user's connected Supabase).

## Connector credential model (BYO + OAuth-ready)

- Credentials are stored **source-agnostic** in the encrypted env bucket: the store holds "the
  credentials to reach this service," not caring whether a human pasted them or OAuth fetched
  them. Acquisition is a **pluggable strategy** (`manual` now, `oauth` later) feeding one store.
- **OAuth scope (planned):** authorization + credential-retrieval for **both** Supabase and
  Vercel; **provisioning + deploy for Vercel** (its job, safe); **Supabase provisioning
  deferred/optional** (creating someone's database for them is heavier and rarely wanted).
- **Never make launch depend on OAuth partner approval.** Manual-connection-with-instant-
  validation ships first and always exists (also the OSS/self-host path). OAuth is additive.
- OAuth raises custody to **account-level** tokens (vs project keys): minimal scopes, encrypted
  tokens, refresh/revocation, audit. Learn on project keys first.

## Versioning & the branch-ready document (v2 foundation, cheap now)

- **Snapshots are the source of truth; operations are derived** (Git's model). Each version =
  a full JSON snapshot; history = a sequence of parent-linked snapshots; "how it changed" = a
  **graph-aware semantic diff** computed on demand (also the merge engine — one hard thing,
  three payoffs: history, branch-compare, merge).
- **Content-addressed object storage, not one monolithic file** (R2 is exactly this). Dedup,
  no merge bottleneck, integrity via hashes. V1 may overwrite one key per project; the upgrade
  to full history is "stop overwriting, keep every key" — additive.
- **Live editing uses atomic operations in memory** (undo/redo, responsiveness); a save/commit
  produces a new snapshot. Operations must be clean atoms ("added node X", "wired A→B", "set
  prop P"), never "replaced whole graph" — coarse ops make future merge impossible.
- **Git-style async branch/merge (v2):** borrow Git's *architecture* (async branches, semantic
  merge), hide Git's *interface* (call them "versions"/"copies", one-button branch, visual
  conflict resolution on the canvas). Design **for separability** (per-artboard/per-feature
  branches touch disjoint id-sets → trivial union merges); reserve semantic conflict resolution
  for genuine overlaps. Scope = branch / merge / history only (no rebase/cherry-pick/staging).
