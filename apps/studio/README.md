# @loom/studio

The loom editor: the platform shell plus the Design and Nodes canvases, one Vite + React + TS
SPA (`docs/09-implementation-plan.md`).

## Status — M3 (Nodes mode emits a running backend)

Design something, wire what it does, and watch it run against a real serverless function.

- **Design canvas** — artboards rendered as real DOM behind a pan/zoom transform, with a
  floating selection overlay. Not a raster canvas: the artboard must render real React
  (`docs/01`), and layout comes from the compiler's own `layoutToStyle`, so the canvas and the
  Preview cannot drift.
- **Screens** — multiple artboards side by side on the canvas, each its own route. The layers
  panel lists them; the active screen is where new components land.
- **Flow arrows** — drawn between artboards on the canvas and editable as objects. A Button's
  "On click -> Go to <screen>" *is* the arrow: setting it creates the flow and wires the handler
  in one gesture, and the compiler turns it into a react-router route. A screen can declare
  params (a dynamic segment), and a flow into it carries a value per param.
- **Layers panel** — tree, select, reorder, delete (each one an atomic op).
- **Canvas drag** — dragging a component reorders or reparents it. Layout is flex-first, so a
  drag is a tree operation, never an x/y (`docs/specs/layout-model.md`).
- **Sizing** — hug / fill / fixed per axis on any container.
- **Nodes mode** — the behaviour canvas (React Flow). UI components appear as **mirrors**, which
  are materialised into the document on their first wire rather than up front. An API route node
  is a **container**: the function steps inside it are what runs on the server. Wiring is checked
  as you draw it — an illegal wire is refused with a reason (the **Problems** tier) instead of
  failing later in the Build tier.
- **Schema-driven inspector** — renders whatever `@loom/components` declares for the selected
  type. Adding a component type never means editing the inspector.
- **Document state** — every edit is an atomic op applied to an immutable snapshot, which is
  what buys undo/redo (Cmd/Ctrl+Z, shift to redo) for free.
- **Preview** — the snapshot is compiled to disk and served by a *second* Vite dev server in an
  iframe, so Preview runs real compiler output. Compile failures come back as the **Build error
  tier** with the offending entity id, and the last good build stays on screen.

## Not yet

Connectors and app auth (M4), auto-backend inference (M5), deploy (M6). `bound` flow payloads
still refuse to compile — they need a node port to read, which is M4's typed-data territory.
State buckets, Gate/Guard/Validate nodes and the reusable-component vocabulary are also still
ahead.

## Tests

- `pnpm --filter @loom/studio test` — store + store-to-compiler integration (Vitest).
- `pnpm --filter @loom/studio test:e2e` — Playwright drives the real editor against the real
  Preview: an edit reaching the running app, layout changes, clicking a flow through to a second
  route, and a Build error keeping the last good build on screen.

## Run

```bash
pnpm --filter @loom/studio dev
```

Studio comes up on 5173 (or the next free port) and prints the Preview server's URL. The emitted
app is written to `apps/studio/.loom-preview/` — inside the app so it resolves react from the
studio's own `node_modules`, gitignored, and safe to delete.

## Preview run model (M1 decision, refined in M3)

A child Vite dev server serves the emitted app, per `docs/09` open decision 2. The studio
**compiles in the browser** and posts the emitted files to the dev server, which only writes
them: a Build error then surfaces instantly against the offending node, and the Vite plugin stays
free of workspace imports. The child server also mounts the emitted `api/*.ts` with the same
handler signature Vercel uses, so the Preview runs the real backend, not a stub.

In-browser bundling (esbuild-wasm / WebContainers) stays open as a later zero-infra option; the
decision that mattered was that Preview runs **compiler output**, never an interpreter of the
snapshot.
