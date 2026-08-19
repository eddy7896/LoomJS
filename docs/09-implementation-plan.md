# 09 — V1 Implementation Plan

> This is the **execution** companion to `07-v1-scope.md`. Where 07 gives the in/out line and
> the milestone _order_ (M0–M6), this file adds the engineering substrate: repo shape, the
> prerequisite specs, per-phase deliverables + done-when gates, the parallel platform track, and
> the honest risk register. The decision docs (`02`, `03`) still win on _what_ to build; this
> file is _how to start_. Terminology follows `06-glossary.md` exactly.

## Guiding principles for building loom itself

1. **Front-load risk, not polish.** Prove the scary things (compiler emits a running app;
   Supabase introspection yields typed ports) on throwaway fixtures before any UI is pretty.
2. **Spec before code where the artifact is load-bearing.** The snapshot schema is the save
   format _and_ the compiler input _and_ the versioning atom — write it before the compiler
   reads it. The five named specs in `03` §"next specs" are the gating deliverables here.
3. **Boring platform, invented compiler.** The accounts/workspaces/projects shell is proven-
   tools plumbing built in parallel; reserve all cleverness for the graph→code path.
4. **Every phase ends with a runnable artifact**, not a document. A phase that can't be demoed
   isn't done.
5. **Branch-ready hygiene from commit one** — stable ids + atomic ops (guardrail 10). Not a
   CRDT layer; just the free-anyway discipline that also buys undo/redo.

---

## Repo & tooling foundation (Phase 0)

Greenfield today: the repo holds only `docs/` and `landing/` (the marketing site). Everything
below is new. Recommended monorepo (flag if you disagree before scaffolding):

```
loomjs/
  apps/
    studio/        # the canvas web app: platform shell + Design + Nodes modes (one deploy)
  packages/
    ir/            # snapshot schema, stable-id generation, atomic op log — the IR types
    compiler/      # walk IR → emit a real repo (template emission, Node.js). The core bet.
    connectors/    # module system + Supabase connector + Vercel deploy connector
    typesys/       # type registry, curated visible vocabulary, tsc bridge
    ui/            # loom's own design-system primitives (Archivo / JetBrains Mono tokens)
  landing/         # existing marketing site (unchanged)
  docs/
```

- **Tooling:** pnpm workspaces + Turborepo (recommended). Single `tsconfig.base.json`, shared
  ESLint/Prettier, Vitest for unit, Playwright for the editor E2E later.
- **`studio` is one app, not two.** The "platform" (dashboard/auth/projects) is just the routed
  shell around the editor — `07` says the platform is "the shell the milestones plug into." One
  Vite+React+TS SPA with routes: `/login`, `/dashboard`, `/p/:projectId` (editor). Avoids a
  second deploy and a second auth surface.
- **Decision to confirm:** studio's own stack. Default = Vite+React+TS (matches the landing and
  the generated-app target; one mental model). Not settled in the docs — confirm before scaffold.

**Done-when:** `pnpm install && pnpm build` green across empty packages; `@loom/ir` exports a
typed (even if near-empty) `Snapshot`; CI runs lint+typecheck+test on push.

---

## The five prerequisite specs (gate the phases that consume them)

From `03` §"next specs," in dependency order. Each is a real writing task _before_ its consumer:

| #   | Spec                                                                                         | Blocks     | Land by   |
| --- | -------------------------------------------------------------------------------------------- | ---------- | --------- |
| 1   | **Snapshot schema** — artboards, components, graph, wires, bindings, stable ids              | everything | Phase 0   |
| 2   | **Type registry + live checker** — curated vocabulary, Supabase-type ingestion, `tsc` bridge | M3, M4     | before M3 |
| 3   | **Connector credential model** — source-agnostic env-bucket store, `manual` strategy         | M4         | before M4 |
| 4   | **Binding/trigger runtime** — how a bound property gets data; triggered vs reactive          | M3         | before M3 |
| 5   | **Layout model** — flex container spec (direction/gap/padding/align; hug/fill/fixed)         | M1         | before M1 |

Write each as a short spec doc (`docs/specs/*`) + the TS types in the owning package. Snapshot
schema is the long pole — it is the input to the compiler and the save format simultaneously.

---

## Phase plan

Numbering mirrors `07`'s milestones. Platform track runs in parallel (own section below).

### Phase 0 — Foundations

- **Goal:** monorepo + snapshot schema v0 + tooling exist.
- **Build:** repo scaffold; `@loom/ir` snapshot types (spec 1) + stable-id + atomic-op log;
  one hand-written trivial snapshot fixture (a single Text component on one artboard).
- **Done-when:** the fixture round-trips (serialize → parse → deep-equal) and CI is green.

### M0 — Compiler skeleton _(riskiest; do first, cheaply)_

- **Goal:** prove `graph → files → runs`.
- **Build:** `@loom/compiler` walks the trivial fixture and emits a real Vite+React+TS repo:
  each node type owns a code template; compile = stitch templates + wire data flow (it's
  codegen, a solved category — see `02`). Flex-first CSS emission uses layout spec 5.
- **Done-when:** `compiler.compile(fixture) → /out`; `cd out && npm i && npm run build` succeeds
  and the built app renders the Text. **No editor involved yet** — driven from a test.

### M1 — Editor ↔ compiler ↔ Preview _(the core loop)_

- **Goal:** design something, see it running.
- **Build:** `studio` Design-mode canvas (DOM-rendered artboards behind a pan/zoom transform,
  selection/resize overlays), the schema-driven inspector, in-memory graph state as atomic ops;
  wire editor state → compiler → **Preview** in an iframe. Static UI only (no data yet).
- **Done-when:** place/style a component in the editor → it appears in the Preview iframe.
- **Hard part:** the Design canvas renders _real_ React components (per `01`), so it is DOM +
  overlay, not a raster/konva canvas. This is the biggest under-counted cost in the milestone
  list — budget for it. Also resolve the **Preview runtime** decision (see Open decisions).

### M2 — Flow arrows → routing

- **Goal:** prove flow-as-router.
- **Build:** second artboard + a **Flow** arrow between them → emit react-router routes; a Flow
  may carry a payload → destination declares input params → dynamic route (`/x/:id`).
- **Done-when:** clicking through the previewed app navigates between two compiled routes.

### M3 — Backend graph → serverless

- **Goal:** Nodes mode emits a running backend.
- **Build:** **Nodes mode** canvas (React Flow / xyflow recommended for the graph surface); one
  **API route** node → one real Vercel `/api` function; one **Function** node; a Button whose
  `onClick` trigger port fires the pipeline. This is where the **binding/trigger runtime**
  (spec 4) and the **type registry** (spec 2) first ship for real. Resolve the API-node-as-
  container vs flat-graph OPEN decision here (`03`).
- **Done-when:** button in Preview calls the emitted function and shows the result.

### M4 — Supabase connector _(riskiest alongside M0; own milestone; the differentiator)_

- **Goal:** typed nodes from a real schema.
- **Build:** minimal **module** system (definition = manifest + adapter; instance = configured/
  wired); the Supabase **connector** that `introspect()`s a live table → generates a typed **DB**
  node whose ports are the real columns with real types (from Supabase-generated TS types). Add
  Supabase **app auth**. Credentials via the **env bucket** (spec 3) — service key server-only,
  compiler refuses env→client wire (guardrail 1).
- **Done-when:** connect a real Supabase, introspect one table, list its rows in Preview via a
  reactive pipeline; a form insert (triggered) writes a row.
- **Verify-before-building (per `04`):** Supabase Management API/OAuth terms, `supabase gen
types` output shape, R2 access pattern. Manual-connection-with-validation is the baseline;
  do not gate on OAuth approval.

### M5 — Auto-backend inference _(capstone, not foundation)_

- **Goal:** the magic — design a form, the backend appears pre-wired.
- **Build:** given a form + submit Flow, materialize **AUTO** nodes (Validate + POST API route +
  State write + Supabase insert), dashed + badge, Accept/Detach per glossary. This only
  _orchestrates_ primitives that M0–M4 already made real — build it last on purpose.
- **Done-when:** dropping a submit on a form generates a working, accept-able backend pipeline.

### M6 — Vercel deploy + full sample app _(the proof)_

- **Goal:** the acceptance test passes.
- **Build:** Vercel **managed deploy** connector (push repo, Vercel builds); env injection by
  name at deploy; then build the whole Fintrack-class sample (auth, dashboard w/ live data, one
  CRUD resource, one search) **with zero syntax**.
- **Done-when:** a designer builds the sample, previews it against their Supabase, and deploys it
  to their Vercel — no code typed.

---

## Platform track (parallel, boring, functional)

Built alongside M0–M6 as the shell the editor plugs into. Not beautiful, just correct.

- **Platform Supabase** (separate universe from any connected Supabase — guardrail 3): auth +
  Postgres metadata. Data model: `User / Workspace / Project / Membership(role)`. Design as if
  teams exist; ship **single-workspace** (invites/teams disabled).
- **Cloudflare R2**: snapshot blobs + assets. **Save order: R2 blob first, then Postgres
  pointer** (orphan blob harmless; dangling pointer is not — `02`). Keep searchable facts in
  Postgres, not the blob. V1 may overwrite one key per project (history upgrade is additive).
- **Screens:** gated (invite/allowlist) signup → verify → workspace → project dashboard
  (create/open/rename/duplicate/delete) → editor handoff → account settings. See `08` flow 2.
- **Two auth systems never blurred:** platform auth (designer logs into loom) vs app auth
  (end-users of the generated app). Two Supabases, opposite sides of a wall.

---

## Cross-cutting concerns

- **Type registry (spec 2)** lands incrementally: curated visible vocabulary
  (`text/number/boolean/date/record/list<T>/optional<T>/enum`), inference over annotation, `tsc`
  authoritative, canvas checker is the fast red-ring approximation. Untyped boundaries
  (Code node out, untyped npm) render as `any`/`unknown`, visibly marked.
- **Errors, three tiers (`02`):** Problems (live graph-validity + lint), Build (`tsc`/codegen),
  Runtime (graph-aware Preview console mapping errors back to a wire/node). The Runtime tier is
  the forms/data-flow debugger — the differentiating UX; don't skip it after M4.
- **Security is a build-time gate, not a review step:** the compiler _refuses_ to serialize a
  secret into snapshot/R2/repo/client and refuses env→client wires (guardrails 1–4). Bake these
  as failing tests early.
- **Design system:** studio uses loom's own tokens (Archivo + JetBrains Mono, functional node
  hues, light-mode only — guardrails 19–24). The `ui` package owns them.
- **Testing:** Vitest for compiler emission (golden-file snapshots of generated repos) and IR
  ops; Playwright for the editor loop from M1; a "compile → the emitted app builds" smoke test
  as the compiler's regression net.

---

## Risk register (honest, per guardrail 27)

| Risk                                                                                             | Where | Mitigation                                                                                                          |
| ------------------------------------------------------------------------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------- |
| Compiler never emits a coherent running app                                                      | M0    | Prove on a trivial fixture first, no UI                                                                             |
| Supabase introspection → typed ports is thornier than assumed (relations, enums, nullable, JSON) | M4    | Verify `gen types` output shape early (`04`); its own milestone with real engineering budget                        |
| **Design-mode canvas is a bigger build than the whole milestone list implies**                   | M1    | It renders real React (DOM + overlay, not konva). Call it out as its own sub-project; don't let it hide inside "M1" |
| Preview runtime infra unresolved                                                                 | M1/M4 | Decide dev-DB strategy + run model before Preview is real (Open decisions)                                          |
| Scope creep toward general-purpose VPL                                                           | any   | Route the arbitrary 20% to the Code node (guardrail 7); keep node vocabulary small                                  |
| Two-canvas confusion / metaphor leak                                                             | M1–M3 | Enforce ownership discipline: artboard owns existence+appearance, Nodes owns behavior (guardrail 13)                |

---

## Open decisions to resolve (with recommended defaults)

Pulled from `03` §Open — decide at the flagged phase, not before:

1. **Preview database strategy** (before Preview, ~M1/M4): dev branch/seeded project vs writing
   to connected Supabase with a warning. _Recommend:_ connector holds a **dev + prod
   connection**; Preview uses dev.
2. **Preview run model** (before M1): server-side Vite dev server behind an iframe vs in-browser
   WebContainers. _Recommend:_ start server-side (simplest); evaluate WebContainers for zero-
   infra Preview (verify licensing per `04`).
3. **API/route node: container vs flat graph** (before M3): container keeps top-level graphs
   readable for multi-step mutations. _Recommend:_ container.
4. **studio's own stack** (before Phase 0 scaffold): _Recommend:_ Vite+React+TS (matches target).

None of these block Phase 0 + M0 — both proceed now.

---

## Immediate next actions (first working increment)

1. Scaffold the monorepo (`pnpm` + Turborepo, `tsconfig.base`, CI). — Phase 0
2. Write the **snapshot schema** spec + `@loom/ir` types + the trivial one-component fixture. — spec 1
3. Stand up `@loom/compiler` and make M0's `compile(fixture) → building repo` test go green.
4. In parallel, provision the **platform Supabase** + **R2** and land signup→dashboard→empty
   project (the shell).

M0 + the platform shell are the two things worth having running first; everything else plugs
into them.
