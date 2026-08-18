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
  Preview is real.
- **[OPEN] Route/API node as container vs. flat graph** for multi-step mutations. Container
  keeps top-level readable; decide before the API node's compiler is built.
- **[OPEN] Exact snapshot schema, type registry format, connector credential record shape,
  binding/trigger runtime spec, layout model spec.** These are the named "next specs"; none
  written yet. See `07-v1-scope.md` build order.

## The next specs to write (highest-leverage, in dependency order)

1. **Snapshot schema** — canonical project JSON (artboards, components, graph, wires, bindings,
   stable ids). It's the save format + compiler input + versioning atom.
2. **Type registry + live checker** (with Supabase-generated-type ingestion).
3. **Connector credential model** (source-agnostic, env-bucket, manual/oauth strategies).
4. **Binding/trigger runtime** (how a bound property gets its data; triggered vs reactive).
5. **Layout model** (flex container spec).
