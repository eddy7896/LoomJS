# 12 — The Canvas: a design tool that emits flex

> How the Design canvas becomes something a designer never wants to leave — Figma's directness,
> loom's output. Companion to `11-editor-shell.md` (the shell around it) and
> `specs/layout-model.md` (what the layout actually is). Phases are **C0–C6**.

## The promise

Open a project and you get **a blank canvas and a floating toolbar**. Draw. Nothing about the tool
should feel like filling in a form that happens to produce a screen.

## The decision this document exists to make

Figma's directness comes from absolute coordinates: everything is at an x and a y, and that is why
dragging feels like moving paper. loom's whole output promise is the opposite — flex-first, no
pixel coordinates, `04-hallucination-check.md` lists "absolute-positioned canvas that emits pixel
coordinates" as an **irreversible trap**.

**Both are kept, and the reconciliation is that free placement is an input method, not a storage
format.**

- You place things **anywhere**. Drag from the toolbar, draw a rectangle, drop a card between two
  others.
- loom **reads the arrangement**: which frame you dropped into, which slot along its axis, what
  gap the spacing implies, what alignment the edges imply.
- The document stores **that reading** — parent, index, direction, gap, align, size mode — never
  the pointer's coordinates.
- The app emits flex, and stays responsive, exactly as it does today.

This is what Figma itself converged on with auto layout, arrived at from the other side. The
difference is that in loom auto layout is not a mode you switch on; it is the only thing there is,
and the canvas simply never makes you say so.

Where free placement genuinely cannot be read as flex — overlapping hero art, a badge on a corner
— the answer is **not** an absolute mode. It is a shape or an image with its own intrinsic
drawing, and overlap inside a frame is a v1.5 question recorded in `specs/layout-model.md`.

## What "vector tools" means here

A rectangle, an ellipse and a line are a **Shape** element that emits inline SVG. They are real
elements in the tree — they take layout, tokens, conditions and bindings like everything else, and
they render in the emitted app with no runtime and no asset pipeline.

That keeps the vocabulary honest: a shape is a thing the app contains, not a decoration the editor
invents. Freeform paths (the pen tool) are a bigger question — a point model, on-canvas point
editing, and a curve UI — and they are **C3's second half**, deliberately after the three
primitives prove the emission.

---

## C0 — The blank canvas ✅

- **Goal:** a new project opens on an empty screen, not on a sample heading.
- **Build:** drop the seeded "Hello loomJS" Text. One empty root frame, and a canvas centred on
  it.
- **Why:** the seed exists because the first compiler needed something to emit. It is now the
  first thing every designer deletes, and a blank page is the invitation.

## C1 — The floating toolbar ✅

- **Goal:** the tools are on the canvas, where the hand is, not in a column.
- **Build:** a floating bar centred at the bottom: **Move (V)**, **Frame (F)**, **Text (T)**,
  **Rectangle (R)**, **Ellipse (O)**, **Line (L)**, **Image (I)**, and an **Elements** popover
  holding the rest of the vocabulary with search. One-key shortcuts, `Esc` back to Move, and the
  tool returns to Move after it places something — the muscle memory every design tool shares.
- **Note:** the left rail keeps Layers, Elements and Problems. The bar is for *drawing*; the rail
  is for *what exists*. Duplicating the palette in the popover is deliberate: reaching for the
  column mid-gesture is the thing this removes.

## C2 — Draw to place ✅ _(first half)_

- **Goal:** press, drag, release — and the thing exists, the size you drew it.
- **Build:** with a tool active, a drag on the canvas draws a rect; on release the element is
  created at that size and **inserted at the flex slot the drop point implies**, reusing the same
  hit-testing the reorder drag already uses. A click with no drag places at the element's natural
  size.
- **Done-when:** a rectangle drawn 200×120 in the middle of a column lands between the two
  components it was dropped between, at 200×120, in the emitted app.
- **Still to come (C2b):** reading *gap* and *alignment* from where things were dropped — today
  the frame keeps the gap it has. This is the half of the reconciliation that makes spacing feel
  drawn rather than typed.

## C3 — Vector ✅ _(primitives)_

- **Goal:** the three shapes every design starts with.
- **Build:** a `Shape` element — rectangle, ellipse, line — with fill, stroke, stroke width and
  corner radius, all pointing at design tokens. Emitted as inline SVG.
- **Deferred (C3b):** the **pen**. A path is a point model plus on-canvas editing plus curve
  handles; the three primitives prove the emission first, and a path that cannot be edited after
  it is drawn is worse than no pen at all.

## C4 — Direct manipulation _(next)_

- **Goal:** the canvas is where you change things, not just where you see them.
- **Build:** resize handles that write **size modes** (drag an edge to fixed, double-click to hug,
  drag to the parent edge to fill); `alt`-drag to duplicate; arrow-key nudge as reorder; snap
  guides and live spacing badges between siblings.
- **Why here:** every one of these is a *reading* of a gesture into the flex model, so they need
  C2's inference to exist first.

## C5 — Frames as auto-layout _(next)_

- **Goal:** the structure the canvas inferred is visible and editable in place.
- **Build:** frame chrome showing direction, gap and padding with inline controls; "wrap in frame"
  over a selection; select-through into nested frames.

## C6 — The rest of the feel _(next)_

- **Goal:** the hundred small things that make a canvas feel like a canvas.
- **Build:** space-drag pan, zoom to fit / to selection, marquee multi-select, align and distribute
  over a multi-selection, and a components popover that can search the project's own reusable
  components once P7 exists.

---

## What stays true

- **No coordinates in the document.** Every gesture ends as a tree edit plus a layout decision.
  If a gesture cannot be read that way, it is not shipped until it can.
- **One vocabulary.** A shape is an element. It appears in Layers, takes conditions and bindings,
  and compiles like everything else.
- **The Preview is the truth.** The canvas draws real React with the project's own tokens; when
  the two disagree, the canvas is wrong.
