# 07 — V1 Scope

> V1 = **closed beta.** This file is the in/out line and the build order. Anything under "Out"
> is a v2 branch off the same spine, **not a gap**. Do not pull "Out" items into V1 without
> explicit sign-off.

## The V1 pipeline (what a beta user can do)

Design + flow → backend functions & routes → Supabase (data + auth) → Preview → Vercel deploy,
built single-user, on a branch-ready document, wrapped in a platform (accounts/workspaces/
projects).

**Acceptance test:** a designer builds a working sample app (Fintrack-class: auth, dashboard
with live data, a CRUD resource, one search) **with zero syntax**, previews it running against
their Supabase, and deploys it to their Vercel.

## In scope (V1)

**Editor**
- Two-mode canvas (Design + Nodes), drag, wiring, schema-driven inspector.
- Flex-first layout, tablet-and-up, sub-768px guard screen.
- Reusable UI components (required by list rendering).
- Mirror UI nodes; data/trigger ports; bidirectional inputs; frame aggregation.
- Triggered + reactive pipeline modes.
- Flow-arrows-as-router, with payload/params (master→detail).
- FN vocabulary: Validate, Transform/Map, Compute, Gate, Query/Mutation, Guard, Code node.
- Three state buckets (screen/global/env).
- Three error tiers (Problems/Build/Runtime), graph-aware runtime console.

**Compiler**
- Emit Vite + React + TypeScript SPA + react-router.
- Emit Vercel serverless functions for API/FN nodes.
- Node ↔ code lineage (source maps) + managed/ejected ownership + Code node escape hatch.
- Type registry: ingest Supabase-generated TS types; curated visible vocabulary; `tsc` check.

**Connectors**
- Supabase connector: introspection → typed per-table nodes; auth + RLS; dev connection.
- Vercel managed deploy connector.
- shadcn/ui as the flagship design-system module (palette populate via props manifest; brand
  tokens drive its Tailwind theme).
- Framer Motion as a curated inspector preset layer (fade/slide/hover-spring).
- npm search → install → available in Code nodes (with incompatibility surfaced at install).
- Credentials: source-agnostic env-bucket store; **manual** connection with instant validation.

**Platform**
- Supabase-backed platform (auth, Postgres metadata) + R2 (snapshots + assets).
- Data model User/Workspace/Project/Membership — team-ready, shipped single-workspace.
- Gated (invite/allowlist) signup; login; project dashboard (create/open/rename/duplicate/
  delete); project→editor handoff; account settings.

**Document foundation (branch-ready hygiene — cheap now)**
- Stable ids on every node/component/property; changes as atomic ops; whole-snapshot save
  format; R2 blob + Postgres pointer (may overwrite one key per project in V1).

## Out of scope (V1) — v2 branches, with reasons in `03-system-memory.md`

- Live multiplayer / CRDT-OT co-editing (→ Git-style async branch/merge, v2).
- Version history / content-addressed store / branch / merge / visual diff.
- Next.js / RSC target; Firebase connector; Docker/container deploy; custom CI/CD engine.
- Public module marketplace; third-party module authoring.
- React Native / mobile; non-React frameworks (Vue/Svelte).
- Responsive breakpoints (distinct mobile/tablet/desktop layouts).
- Reusable sub-graphs / custom nodes / user-defined functions (→ v1.5 fast-follow).
- `.d.ts` assisted node scaffolder; Supabase auto-provisioning; OAuth one-click connect
  (manual-with-validation is the V1 path; OAuth is additive later).
- Runtime error boundaries, test emission, schema migrations, app-shell/nested layouts,
  role-based access in generated apps.

## Build order (milestones — front-load risk)

- **M0 — Compiler skeleton (first).** Hardcoded trivial graph → real Vite/React repo that
  builds and renders. Proves `graph → files → runs`. Highest-risk, do it cheaply first.
- **M1 — Editor ↔ compiler ↔ Preview.** Wire prototype graph state to the compiler; Preview in
  an iframe. Core loop live (static UI).
- **M2 — Flow arrows → routing.** Second artboard + arrow → react-router. Proves flow-as-router.
- **M3 — Backend graph → serverless.** One API node → one Vercel `/api` function; one FN;
  button → call. Nodes mode emits running backend.
- **M4 — Supabase connector (own milestone, the hard/differentiating one).** Introspect one real
  table → typed DB node → list rows. Add Supabase auth. Budget for real engineering.
- **M5 — Auto-backend inference (last, on purpose).** Form + submit flow → AUTO nodes
  (validator + POST + state write + Supabase insert) materialize pre-wired. Orchestrates
  primitives that must already work.
- **M6 — Vercel deploy + full sample app.** Managed deploy; build the whole acceptance-test app.

**Platform layer** (auth/workspaces/projects on Supabase + R2, gated signup) is built in
parallel as the shell the milestones plug into — boring and functional, not beautiful.

## Riskiest / most-valuable / proof

- Riskiest: **M0** (compiler works at all) and **M4** (Supabase introspection → typed ports).
- Most magical: **M5** (auto-backend) — but a capstone, never a foundation.
- Proof: **M6** — a designer builds the sample app with zero syntax.
