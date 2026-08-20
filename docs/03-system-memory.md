# 03 — System Memory (Decision Log)

> This is the project's persistent memory. **Read before proposing anything that feels
> already-decided.** Each entry records the decision *and the reasoning*, so trade-offs
> aren't re-argued. "Deferred" means *chosen out with a reason*, not forgotten.

## Format

`[STATUS] Decision — Reasoning. (Reversibility / cost note where relevant.)`
STATUS ∈ SETTLED · DEFERRED · OPEN.

## Identity & scope

- **[SETTLED] loomJS is a domain-specific VPL for data-driven web apps, not general-purpose.**
  General-purpose visual programming becomes unreadable past a threshold (Blueprints/Node-RED
  graveyard). The Code node absorbs the arbitrary 20%. This is a *policy*, not just a feature.
- **[SETTLED] BYO-backend.** loom owns building; user owns app infra (their Supabase/Vercel).
  Offloads data liability, matches OSS future, makes "you own it" literal. Trade: onboarding
  UX becomes the hard problem.
- **[SETTLED] Compile = generate a real, owned repo.** Reversibility + lineage is the trust
  model; never a locked-in runtime, never hide the code.
- **[SETTLED] Fintrack is a sample, not the spec.** Don't encode finance assumptions.

## Stack

- **[SETTLED] Frontend target: Vite + React + TypeScript SPA + react-router.** Simplest to
  emit; avoids teaching the graph Next.js/RSC server/client boundaries.
- **[SETTLED] Backend target: Vercel serverless functions (`/api`).** One place for logic
  (not scattered into Supabase edge functions). API node = one real endpoint.
- **[SETTLED] Database/auth: user's own Supabase (Postgres, relational).** Supabase supplies
  auth + RLS + TS type generation → flagship V1 connector.
- **[SETTLED] Deploy: Vercel managed (V1).** No Docker in V1.
- **[SETTLED] Project storage: Cloudflare R2 for graph snapshots + assets; Postgres for
  metadata + pointer.** R2 = zero egress (read-heavy), S3-compatible, versioning-ready.
- **[SETTLED] TypeScript is a hard, non-optional dependency** of generated apps and Code nodes.
  Gains a full type system + `tsc` checker for free. No plain-JS output, ever.

## Core mechanics

- **[SETTLED] Component = property-schema instance; inspector = schema renderer.** One system
  for native + imported components (no origin-based special-casing).
- **[SETTLED] Property value kinds: static / bound / event.** `bound` is the Design↔Nodes seam.
- **[SETTLED] Every UI component gets a mirror node; data-props → data ports, events → trigger
  ports; inputs bidirectional; frames aggregate children into a composed object port.**
- **[SETTLED] Two pipeline trigger modes: triggered + reactive.** Required for dashboards
  (reactive) and forms/search (triggered) to coexist. Mode inferable from event-wire presence.
- **[SETTLED] Ownership discipline: artboard owns existence/appearance; Nodes mode owns
  behavior.** Prevents two-canvas confusion.
- **[SETTLED] Connectors are modules that are node factories; introspection generates typed
  per-table nodes.** "Access all data" falls out of introspection.
- **[SETTLED] Module = definition (manifest + adapter) vs instance (configured/wired).**
  Same class/instance pattern as component type/instance, managed/ejected.
- **[SETTLED] Type layer = adopt TS + ingest Supabase-generated types; curated visible
  vocabulary; inference over annotation; `tsc` authoritative.**
- **[SETTLED] Three state buckets: screen / global(app) / env(secrets, server-only).**
- **[SETTLED] Flow arrows are the router; can carry a payload; destination declares input
  params.** → dynamic routes, master→detail.
- **[SETTLED] Errors in three timing tiers: Problems(live) / Build(compile) / Runtime(preview,
  graph-aware).** Linting rides in the live tier.
- **[SETTLED] Layout is flex-first, never absolute; tablet-and-up; graceful sub-768px guard.**
  Absolute output is the irreversible design-tool trap.
- **[SETTLED] Reusable UI components in V1; reusable sub-graphs (custom nodes / user functions)
  fast-follow (v1.5).**

## Credentials, security, OAuth

- **[SETTLED] Secrets are server-only, in an encrypted env bucket, referenced by name; never in
  the snapshot/R2/repo/client.** Compiler refuses to wire env → client node. Anon key =
  client-safe; service key = env.
- **[SETTLED] Two Supabases, never blurred: platform vs. connected.** Two auth systems: platform
  auth vs. generated-app auth.
- **[SETTLED] Credential store is source-agnostic; acquisition is pluggable (`manual` now,
  `oauth` later).** Makes the OAuth upgrade additive.
- **[SETTLED] OAuth plan: authorization + retrieval for both Supabase & Vercel; provisioning +
  deploy for Vercel; Supabase provisioning deferred.** Never make launch depend on partner
  approval — manual-with-validation ships first and is the permanent OSS/fallback path.

## Platform

- **[SETTLED] Platform built on Supabase; data model = User/Workspace/Project/Membership.**
- **[SETTLED] Design as if teams exist, ship single-workspace in V1.** Cheap hygiene to keep
  collaboration door open (mirrors the multiplayer deferral logic).
- **[SETTLED] Closed beta with gated signup (invite codes/allowlist).**

## Deferred (v2+ — chosen out, with reason)

- **[DEFERRED] Live multiplayer / CRDT-OT co-editing → Git-style async branch/merge.** Worthless
  before the compiler works; forces a distributed foundation before the model stabilizes. Keep
  the doc branch-ready now (stable ids + atomic ops) so re-adding is cheap, NOT a rewrite.
- **[DEFERRED] Snapshot version history / content-addressed store / branch / merge / visual
  diff.** V1 may overwrite one R2 key per project; upgrade is additive.
- **[DEFERRED] Next.js / RSC frontend target.** Adds server/client-boundary modeling weight.
- **[DEFERRED] Firebase (NoSQL) connector.** Document model warps the relational DB node; a
  second, differently-shaped node. Relational (Supabase) first.
- **[DEFERRED] Docker / container deploy (Cloud Run, Render, Fly, self-host).** Different adapter
  class from Vercel-managed.
- **[DEFERRED] Custom CI/CD engine.** Emit a GitHub Actions workflow / use Vercel git-deploy;
  don't build a pipeline engine.
- **[DEFERRED] Public module/plugin marketplace.** Dogfood first-party connectors on the same
  API first; open authoring later.
- **[DEFERRED] React Native / mobile.** Different rendering primitives (no DOM/CSS); IR spine
  makes it addable later without rewrite.
- **[DEFERRED] Non-React frameworks (Vue/Svelte).** Second component model = different product.
- **[DEFERRED] Responsive breakpoints (mobile/tablet/desktop distinct layouts).** Flex-first
  makes this additive later.
- **[DEFERRED] `.d.ts`-based assisted node scaffolder (human-in-loop).** Only for well-typed
  packages; v2 authoring accelerator, never "search-and-appears."
- **[DEFERRED] Runtime error boundaries in generated apps, testing/test-emission, schema
  migrations/evolution, app-shell/nested layouts, role-based access in generated apps.**
- **[DEFERRED] Supabase auto-provisioning (create project for user).** Billing/region/data
  implications; users create their own project deliberately.

## Open (needs a decision before/at build)

- **[OPEN] Preview database strategy:** dev branch/seeded project vs. writing to the connected
  Supabase (warn user). Clean answer = connector holds a dev + prod connection. Decide before
  Preview is real. *(Still open as of M4: the Preview writes to whatever project is connected.)*
- **[SETTLED — M3] Route/API node is a container.** The nodes inside its body run on the server;
  everything outside runs in the browser. The container boundary *is* the network boundary, which
  is also the line a server-only credential may not cross. See
  `specs/binding-trigger-runtime.md`.
- **[SETTLED — M0-M4] The five named specs are written**: `specs/snapshot-schema.md`,
  `specs/type-registry.md`, `specs/connector-credentials.md`,
  `specs/binding-trigger-runtime.md`, `specs/layout-model.md`.

## Implementation decisions taken while building M0-M5

Recorded here because they constrain everything downstream. Each was taken at the phase named.

- **[M1] Preview run model: a child Vite dev server** serving the emitted app in an iframe. The
  studio compiles *in the browser* and posts the emitted files to the dev server, which only
  writes them — a Build error then surfaces against the offending node with no round trip.
- **[M2] Routes are derived, never authored.** Each artboard is a route, the entry artboard is
  `/`, and an artboard that declares params gets a dynamic path. A flow arrow carrying an empty
  value is a Build error, not an empty URL segment.
- **[M3] Pipeline state is demand-driven.** An output nobody binds emits no variable — the
  emitted app builds with `noUnusedLocals`, so dead state would fail its own `tsc`.
- **[M4] Introspection reads the PostgREST OpenAPI document** at `{project}/rest/v1/`, not the
  Management API. Every project serves it, it needs only a URL and a key the designer already
  has, and it keeps manual-connection-with-validation as the baseline that `04` demands. The
  parser is defensive: an unrecognised column type becomes `unknown`, never a guess. Ingesting
  `supabase gen types` output stays a later accelerator, not the spine.
- **[M4] Emitted server code uses `@supabase/postgrest-js`, not `@supabase/supabase-js`.**
  The umbrella package builds a realtime client on import, which needs Node 22's native
  WebSocket and is dead weight in a stateless function. Same query API; one fewer reason for a
  generated app to break on a runtime it did not choose.
- **[M4] Introspected schema is cached in the document**, because table and column names are not
  secret. That is what lets the compiler and the canvas type ports offline.
- **[M5] AUTO is provenance, not a mode.** An inferred pipeline is ordinary nodes carrying a mark;
  the compiler emits it identically whether it is proposed, accepted, or detached. The mark exists
  for the canvas and for regeneration, and **Detach simply deletes it** — an unmarked node is one
  the designer owns. See `specs/snapshot-schema.md` §M5.
- **[M5] The whole proposal is one unit.** Accept/Detach/regenerate operate on a group id shared
  by every node and wire from one inference run, and generating is a single undo step. A pipeline
  half-owned by loom and half by the designer would be unreadable.
- **[M5] Inference matches by name and refuses to guess.** A form's fields are matched to columns
  by normalised name; a table is only proposed if the form covers **every required column**; two
  buttons means no proposal, because which one submits is not loom's call. Every refusal carries
  the sentence the designer sees.
- **[M5] Inference never creates UI.** It reads the artboard and writes only behaviour, so the
  ownership discipline holds (guardrail 13): mirrors it materialises are views of existing
  components and are deliberately *not* marked AUTO.
- **[M5, correcting M4] Schema introspection runs on the dev server, not in the browser.** A
  hosted Supabase project serves its PostgREST OpenAPI document only to the `service_role` key
  ("Only the `service_role` API key can be used for this endpoint"), and that key may never enter
  a browser. The studio tries the call directly — a self-hosted project or a stub answers the anon
  key — and on a 401/403 relays it through `POST /__loom/introspect`, which uses the key the dev
  server holds and returns **only the document**. Verified against a real project; the anon key
  alone cannot read it. On the platform (M6) the same relay is a server route.
- **[M5] Validation runs on the server**, inside the route's body, because that is the only place
  it cannot be bypassed. It also coerces — an `<input>` yields strings and a number column will
  not take one — and omits an empty optional column rather than writing an empty string.

- **[M5.1] The expression vocabulary is typed at the input.** NumberField, Checkbox and Select
  join TextField; each holds its own type in state rather than a string everything downstream has
  to parse. Select's port stays `text` — typing it as an `enum` of its options needs the mirror to
  read the component's config, which is a wider change than the vocabulary needed.
- **[M5.1] Gate ships as stop-on-false, not as two branch edges.** One condition, and the request
  ends with the Gate's message when it does not hold. Branching needs a second body inside the
  container; the deferral is recorded in `specs/binding-trigger-runtime.md` rather than implied.
- **[M5.1] "Loops" are answered by the query and the implicit map, deliberately.** A read carries
  sort and limit; a List renders one row at a time. No loop node — that is the general-purpose VPL
  graveyard (`04-hallucination-check.md`), and the arbitrary case is the Code node.

- **[M5.1] Operator nodes carry their operands in config, not on extra ports.** Math, Compare and
  Logic read named fields of the record flowing through and write the answer into a named field.
  A route body is an ordered pipeline of one value; giving each operator two data-input ports
  would turn a readable column of steps into a web of wires for no gain. Flagged as *kinds* of
  the glossary's Compute rather than new node categories.
- **[M5.1] Arithmetic fails loudly.** Divide by zero and non-numeric operands raise named errors
  instead of writing `Infinity` or `NaN` into a column — a plausible wrong number is worse than a
  stopped request.

- **[M5.1] A function node outside an API route runs in the browser.** The container boundary is
  the network boundary in both directions, so a Compute wired from a field into a Text compiles to
  one `const` — no request, no state. Only Compute qualifies: the record-shaped steps, Validate,
  Gate and Code each belong inside a route, and each says so by name when placed outside one.

- **[M5.1] Canvas derivations follow the same triggered/reactive rule as pipelines.** A `run`
  port left unwired means the value recomputes with its inputs (a `const`); a trigger wired in
  means it is held in state until fired. Read from the wiring, never configured.
- **[M5.1] Math takes wired operands on the canvas and config fields inside a route body.** Two
  environments, one operator vocabulary: a canvas has wires, a route body has one value flowing
  through ordered steps. The Inspector shows only the fields that apply where the node sits.

## The next specs to write (highest-leverage, in dependency order)

1. **Snapshot schema** — canonical project JSON (artboards, components, graph, wires, bindings,
   stable ids). It's the save format + compiler input + versioning atom.
2. **Type registry + live checker** (with Supabase-generated-type ingestion).
3. **Connector credential model** (source-agnostic, env-bucket, manual/oauth strategies).
4. **Binding/trigger runtime** (how a bound property gets its data; triggered vs reactive).
5. **Layout model** (flex container spec).
