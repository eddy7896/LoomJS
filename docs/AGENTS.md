# AGENTS.md — loomJS

> Cross-tool project context. Read by **Google Antigravity** and **Cursor** at session
> start (Claude Code uses `CLAUDE.md`, which mirrors this). Under the 12,000-char rule
> limit. Detailed reference lives in `/docs`; always-on constraints live in
> `.agents/rules/loomjs-core.md`.

## Tech stack

- **Generated apps:** Vite + React 18 + TypeScript (SPA), react-router. Backend =
  Vercel serverless functions (`/api`). Database + auth = the **user's own Supabase**.
- **Styling of generated apps:** Tailwind (driven by loom brand tokens); shadcn/ui is the
  flagship component-kit module.
- **Platform (loomJS itself):** built on Supabase (auth, Postgres metadata) + Cloudflare
  **R2** (project graph snapshots + assets). The compiler is Node.js.
- **Type layer:** TypeScript is adopted, not reinvented. Supabase-generated TS types are
  ingested as the data-shape spine. `tsc` is the authoritative type-checker.

## What loomJS is

A **web-based visual programming language with Figma-style design tools**. Designers build
full-stack data-driven web apps by designing UI and wiring visual nodes — no syntax. The
node graph is an **intermediate representation (IR)**; a compiler emits a real, owned repo.
Promise: *a designer should never feel they left the canvas.*

**Two modes on one canvas:** *Design mode* (Figma-style UI + user-flow editor, frontend
only) and *Nodes mode* (the backend graph: UI/FN/API/STATE/DB nodes wired port-to-port).

## Non-negotiable principles

1. **BYO-backend.** loom owns the build experience; the user owns their app's infra (their
   Supabase, their Vercel). loom never hosts app data. It brokers the user's credentials.
2. **Compile = generate real code.** The graph emits a real repo. Preview runs it; Deploy
   ships it. No locked-in runtime.
3. **Scope ceiling is a feature.** Domain-specific language for data-driven web apps, NOT
   general-purpose. 80% (forms/CRUD/auth/dashboards) = nodes; arbitrary 20% = **Code node**.
   Never try to make all logic expressible as nodes.

## Code quality & conventions

- TypeScript everywhere in generated output; the Code node body is TS. Never emit plain JS.
- Keep the two-mode split: Design mode is frontend-only; Nodes mode is the backend graph.
- Every UI component is defined by a **property schema**; the inspector is a schema renderer.
  Property values are one of three kinds: **static**, **bound** (wire to a node), **event**.
- Nodes expose data as ports (data-properties → data ports; events → trigger ports). Inputs
  are bidirectional (`value` out + `setValue` in). Container frames aggregate children into
  one composed object port.
- Two pipeline trigger modes: **triggered** (fires on an event port) and **reactive** (runs
  on mount / when inputs change). A dashboard list is reactive; a search submit is triggered.

## Safety guardrails (confirm before acting)

- **Secrets are server-only.** Credentials live in the env bucket, encrypted, referenced by
  name. NEVER serialize a secret into the project snapshot, the repo, or R2. The compiler
  must refuse to wire an env/secret value into any client-side (UI) node.
- **Never commit `.env` or keys.** Env values are injected into Vercel/Preview at deploy
  time from the encrypted store, by name reference only.
- **Two Supabases, never blurred:** loom's *platform* Supabase (users/workspaces/metadata)
  vs. the user's *connected* Supabase (their app's data). Never route one through the other.
- **Verify external APIs before relying on them** (Supabase Management API / OAuth, Vercel
  integration API, R2). Do not assume a capability exists — check live docs. See
  `docs/04-hallucination-check.md`.
- **Do not invent** node types, port types, connectors, or terminology beyond the glossary.
  If something needs a new primitive, flag it explicitly rather than silently adding it.
- **Ask before destructive actions** (deleting user projects, writing to a connected
  database during Preview, mutating migrations).

## Design system (authoritative — do not invent colors/fonts/chrome)

- Type: **Archivo** (interface) + **JetBrains Mono** (code, values, types).
- Surface: canvas `#F6F7F9`, panels `#FFFFFF`, hairline borders `#E8EAEE`, ink `#1B1D21`,
  muted grays `#4B5058` / `#868D97`, radius 13–16px, soft shadows, **light-mode only**.
- Brand / primary action: red `#EC3013`, used sparingly (single primary button).
- **Color is functional (node category), never decorative.** Node hues:
  UI `#7C5CFF` · FN `#EC3013` · API `#12A07A` · State `#2F7DE1` · DB `#D98A12`.
  Each category also has a soft tint background (e.g. UI `#F2EFFE`, DB `#FBF1DF`).
- Wires: bezier curves in the **source node's** category color; dashed = pending/AUTO.
- Ports: circles on card edges — inputs left, outputs right; filled when connected, ring
  when open. Event/trigger ports render distinctly (e.g. triangle) from data ports.

## Layout rules

- **Flex-first, never absolute positioning.** Every Frame is a flex container (direction,
  gap, padding, alignment); children hug / fill / fixed. This emits real responsive CSS.
- **Target tablet width and up.** Below ~768px the generated app shows a graceful
  "designed for tablet and up" guard screen, not a shattered layout.

## Current phase & focus

**V1 = closed beta.** Build order: platform layer (auth/workspaces/projects on Supabase +
R2) → compiler skeleton (`graph → running app`) → Supabase connector with introspection →
flow-as-router → backend-as-serverless → Supabase data + auth → auto-backend inference →
Vercel deploy. Multiplayer is deferred to a **Git-style async branch/merge** model (v2),
but keep the document **branch-ready now**: stable ids on everything, changes as atomic ops.

## Where to read more

`docs/01-system-context.md` (vision) · `docs/02-system-architecture.md` (layers) ·
`docs/03-system-memory.md` (**decision log — read before re-deciding**) ·
`docs/04-hallucination-check.md` · `docs/05-guardrails.md` · `docs/06-glossary.md`
(terminology) · `docs/07-v1-scope.md` (in/out line) ·
`docs/V1-COMPLETION.md` (**the plan from here to done** — target app classes, the audited gap,
the component↔node contract in §3, and the phase plan).
