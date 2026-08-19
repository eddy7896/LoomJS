# @loom/studio

The loom editor: the platform shell plus the Design and Nodes canvases, one Vite + React + TS
SPA (`docs/09-implementation-plan.md`).

## Status — M1 (editor <-> compiler <-> Preview)

The core loop is live for **static UI**: design something, see it running.

- **Design canvas** — artboards rendered as real DOM behind a pan/zoom transform, with a
  floating selection overlay. Not a raster canvas: the artboard must render real React
  (`docs/01`), and layout comes from the compiler's own `layoutToStyle`, so the canvas and the
  Preview cannot drift.
- **Layers panel** — tree, select, reorder, delete (each one an atomic op).
- **Schema-driven inspector** — renders whatever `@loom/components` declares for the selected
  type. Adding a component type never means editing the inspector.
- **Document state** — every edit is an atomic op applied to an immutable snapshot, which is
  what buys undo/redo (Cmd/Ctrl+Z, shift to redo) for free.
- **Preview** — the snapshot is compiled to disk and served by a *second* Vite dev server in an
  iframe, so Preview runs real compiler output. Compile failures come back as the **Build error
  tier** with the offending entity id, and the last good build stays on screen.

## Not yet

Nodes mode, flows/routing (M2), bindings and triggers (M3), connectors (M4), deploy (M6).
Bound properties and event handlers are shown read-only in the inspector and refuse to compile.
Playwright E2E for the editor loop is not set up yet — store/compiler integration is covered by
Vitest.

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
