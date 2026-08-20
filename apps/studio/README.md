# @loom/studio

The loom editor: the platform shell plus the Design and Nodes canvases, one Vite + React + TS
SPA (`docs/09-implementation-plan.md`).

## Status — M2 (flow arrows are the router)

The core loop is live, and screens now link: design something, see it running, click through it.

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
- **Schema-driven inspector** — renders whatever `@loom/components` declares for the selected
  type. Adding a component type never means editing the inspector.
- **Document state** — every edit is an atomic op applied to an immutable snapshot, which is
  what buys undo/redo (Cmd/Ctrl+Z, shift to redo) for free.
- **Preview** — the snapshot is compiled to disk and served by a *second* Vite dev server in an
  iframe, so Preview runs real compiler output. Compile failures come back as the **Build error
  tier** with the offending entity id, and the last good build stays on screen.

## Not yet

Nodes mode, bindings and triggers (M3), connectors (M4), deploy (M6). Bound properties are shown
read-only in the inspector and refuse to compile, as do `bound` flow payloads and trigger
handlers.

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

## Preview run model (M1 decision)

Server-side child Vite dev server, per `docs/09` open decision 2. In-browser bundling
(esbuild-wasm / WebContainers) stays open as a later zero-infra option; the decision that
mattered for M1 was that Preview runs **compiler output**, not an interpreter of the snapshot.
