# CLAUDE.md — loomJS

> Primary context file for **Claude Code**. Antigravity/Cursor read `AGENTS.md`
> (same content). Both point into `/docs` for detail. Read this file first,
> then load the docs relevant to your task.

## What loomJS is (one paragraph)

loomJS is a **web-based visual programming language with Figma-style design tools**
that lets designers build full-stack web apps by *designing and wiring visual nodes*,
never by writing syntax. The graph is an **intermediate representation** that a Node.js
compiler emits into a real, runnable **Vite + React + TypeScript** frontend and
**serverless (Vercel) API** backend, wired to the user's **own Supabase** database.
Core promise: *a designer should never feel they left the canvas.*

## The three things to never forget

1. **BYO-backend.** loomJS owns the *building experience*; the user owns the *running
   app's infrastructure* (their Supabase, their Vercel). loom never hosts app data.
2. **Compile = generate real code.** The graph emits a real repo the user owns. Preview
   runs it; Deploy ships it. Nothing is a locked-in runtime.
3. **The scope ceiling is a feature.** loomJS is a *domain-specific* language for
   data-driven web apps, NOT a general-purpose visual language. The 80% (forms, CRUD,
   auth, dashboards) is expressed as nodes; the arbitrary 20% goes to a **Code node**.
   Do not try to make everything expressible as nodes — that path is the graveyard.

## Read-me routing (load what your task needs)

- `docs/01-system-context.md` — vision, BYO-backend, the two modes, the reframe history.
- `docs/02-system-architecture.md` — layers, compiler-as-IR, connectors, data flow, storage.
- `docs/03-system-memory.md` — **decision log**: what's settled, what's deferred, and *why*.
  Read before proposing anything that feels already-decided.
- `docs/04-hallucination-check.md` — verification protocol + known-false traps. Read before
  asserting any external API capability or inventing a node type.
- `docs/05-guardrails.md` — hard constraints (security, design system, scope). Non-negotiable.
- `docs/06-glossary.md` — canonical terminology. Use these exact terms; one term per concept.
- `docs/07-v1-scope.md` — the V1 in/out line. Anything "out" is a v2 branch, not a gap.
- `docs/09-implementation-plan.md` — execution plan for M0–M6 (repo shape, gates, risks).
- `docs/10-interaction-plan.md` — execution plan for P0–P7: persistence, conditions, actions,
  CRUD + search, app auth, the runtime tier, reusable components. Several are prerequisites for
  M6's acceptance test, not follow-ons.
- `docs/11-editor-shell.md` — execution plan for S0–S5: the studio's own sidebar, the element
  palette and the elements tree, plus the bar an element must clear to enter the vocabulary.

## Current phase

**V1 = closed beta.** Focus order: (1) platform layer (auth, workspaces, projects) on
Supabase + R2, (2) compiler skeleton (`graph → running Vite/React app`), (3) Supabase
connector with schema introspection. Multiplayer is **deferred** to a Git-style async
branch/merge model (v2), but the document model must stay **branch-ready** (stable ids,
atomic ops) today. See `docs/03-system-memory.md`.

## Hard rules (the short list — full versions in guardrails)

- **TypeScript is a non-negotiable dependency** of every generated app and every Code node.
  Never propose plain-JS output.
- **Secrets are server-only.** Credentials live in the env bucket, encrypted, referenced by
  name — **never** serialized into the project snapshot or committed to the repo or R2.
- **Layout is flex-first**, never absolute-positioned. Target tablet width and up.
- **Do not invent node types, ports, or connectors** beyond the glossary without flagging it.
- **Verify external APIs** (Supabase, Vercel, R2) against live docs before relying on a
  capability. See the hallucination-check doc.
- **Stay on the design system.** Color is functional (node category), never decorative.
  Red `#EC3013` is reserved for the primary action + FN category only.

## Design tokens (authoritative)

- Type: **Archivo** (interface) + **JetBrains Mono** (code, values, types).
- Surface: canvas `#F6F7F9`, panels `#FFFFFF`, borders `#E8EAEE`, ink `#1B1D21`,
  muted `#868D97`, radius 13–16px, soft shadows, light-mode only.
- Node categories: UI `#7C5CFF` · FN `#EC3013` · API `#12A07A` · State `#2F7DE1` · DB `#D98A12`.
