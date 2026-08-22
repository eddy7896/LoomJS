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

**Both are kept, as a choice made per frame.**

A frame is either a **drawing board** or an **auto layout**:

| | Free | Auto layout |
| --- | --- | --- |
| Holding | each child where it was put | children arranged along an axis |
| Emits | `position: relative` + absolute children | flex, with gap and alignment |
| At another width | keeps its shape | reflows |
| Made by | drawing anything; the default for a new screen | one click in the inspector |

The first version of this document said free placement was "an input method, not a storage
format" — draw anywhere, and loom infers the flex slot. That was the right instinct about
*emission* and the wrong answer for **drawing**: a designer composing a screen puts something at a
place and means it, and a canvas that immediately relocates it into a column is arguing with the
gesture. So the inference is gone, and the choice is explicit and visible instead.

What that costs is stated plainly in the inspector: a frame placed by hand keeps its shape at any
width, and auto layout is what makes it reflow. Nothing is hidden, and either mode is one click
away on any frame — including a screen's own root.

The guardrail in `04-hallucination-check.md` still stands where it matters: loom never emits a
pixel canvas *behind the designer's back*. Absolute positioning happens where it was asked for,
inside a frame that says so, and a frame handed back to auto layout drops the coordinates rather
than carrying two descriptions of itself.

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

## C3b — Screens are frames ✅

- **Goal:** stop showing a seam that was never a real division.
- **The fact underneath:** a screen has always been a frame plus routing metadata — a name, a
  size, params, a guard, an entry flag. The document already stored it that way; only the editor
  showed it as two things, so a designer had to know which of "Home" and "Root" held the padding
  and which held the size.
- **Build:**
  - **One row** in the tree per screen, carrying the screen's name, its entry chip, its size, and
    the root frame's children beneath it. Dropping onto that row drops into the screen.
  - **One panel** in the inspector: name, entry, size, route params and guard, *and* the frame's
    background, padding, direction and alignment.
  - **A frame drawn on the open canvas is a new screen.** Same tool, same gesture; the only
    difference is that nothing was underneath it. A frame drawn inside a screen is a group.
  - **The frame tool carries a size:** free, or one of the screen presets (Phone, Tablet, Laptop,
    Desktop…). The same choice applies either way — a frame the shape of a phone inside a screen,
    or a phone-shaped screen on the canvas.
- **Not done, deliberately:** merging them in the **IR**. Deleting `Artboard` and marking
  top-level frames as screens would move ops, the compiler, the router and forty tests, and it
  would buy the same felt result as this. A screen also has three things a frame genuinely cannot
  — a URL with params, a guard, and a design-time size that emits no CSS — and keeping those off
  every Button's schema is worth one extra object in the document. Revisit if nested screens or
  an infinite canvas ever become real requirements.
- **Follows:** "promote this frame to a screen" is now a small, obvious feature — it is the same
  operation the canvas already performs when a gesture lands on nothing.

## C3c — The Preview, as a window ✅

- **Goal:** stop charging the canvas a column for something nobody looks at continuously.
- **Build:** the Preview floats over the canvas — dragged by its bar, resized from its corner,
  collapsed to the bar, closed and reopened from the toolbar. Where it was left is remembered.
- **The app always renders at its real width.** A device preset sizes the frame and the stage
  **scales** it to fit the window; it is never squeezed into whatever space the window has,
  because a preview that lies about the viewport is worse than no preview. Two honest modes:
  - **This screen** (default) — follows the artboard being designed.
  - **A device** — Phone, Tablet, Laptop, Desktop, drawn inside a mockup that can be turned off.
  - **Fluid** — the frame *is* the window, so dragging the corner resizes the viewport itself.
    That is the one that answers "does this hold up at 320 pixels".
- **Each device is drawn as the thing it is.** A phone with its island, home bar and side buttons;
  a tablet with a thin uniform bezel and a camera; a laptop as a lid with the deck it closes onto.
  The proportions are the real ones, because seeing a screen inside the thing it will be held in
  is how a designer judges whether a header is reachable by a thumb or a footer is buried under a
  home bar. The hardware is drawn *around* the app, never over it — except the island and the home
  bar, which occlude exactly as they do on the device.
- **With no device around it, the app is drawn like a screen on the canvas** — same corner radius,
  same lift, same ground. It is the same screen, so it should not look like a different one.
- **The load race, fixed at the root.** A build that lands while the Preview page is still loading
  reaches nobody: the page has already asked for its modules, and its hot-update channel is not
  open yet to hear the correction — so the first edit after opening appeared to do nothing until a
  second edit repaired it. The frame now records which build it went to fetch and loads again if
  the app moved on while it was in the air. It terminates on its own: a load with no build behind
  it is the last one.

## C4 — Free placement, rulers, grid and guides ✅

- **Goal:** the canvas stops arguing with the gesture.
- **Build:**
  - `layout.mode` on every frame — `free` or `stack` — and `position` on a child of a free frame.
    A new screen, and any frame drawn on the canvas, starts free.
  - Dragging inside a free frame **moves** rather than reorders; dragging in an auto-layout frame
    still finds a slot, because that is what a slot is for.
  - **Rulers** along both edges, in the document's own pixels, with each screen marked on them.
  - A **grid** on the screen itself, under everything, at a step the designer sets.
  - **Guides**, *pulled* out of a ruler — press, drag onto the canvas, let go, with a dashed line
    showing where it will land; let go without leaving the ruler and nothing is dropped. Moved by
    dragging, removed by dragging off the screen.
  - **Snapping** to guides first and the grid second, with a reach measured in *screen* pixels so
    the pull feels the same at any zoom. All three toggle from the canvas.
  - **Resize handles** on the selection — eight of them, corners and edges. They write a fixed
    size; a handle on the top or left edge also moves the box, because that edge cannot move
    without the origin moving with it. They snap like everything else, and the whole drag is one
    undo rather than one per pixel.
- **Where each thing lives:** rulers, grid and snap are **editor state** — how a person works,
  remembered per browser. Guides are **document** state, kept beside the screen they belong to,
  because a guide is a decision about that composition and should be there tomorrow and for
  whoever opens the project next. None of it emits a line of CSS.

## C5 — Direct manipulation _(next)_

- **Goal:** the canvas is where you change things, not just where you see them.
- **Build:** resize handles that write **size modes** (drag an edge to fixed, double-click to hug,
  drag to the parent edge to fill); `alt`-drag to duplicate; arrow-key nudge as reorder; snap
  guides and live spacing badges between siblings.
- **Why here:** every one of these is a *reading* of a gesture into the flex model, so they need
  C2's inference to exist first.

## C6 — Frames as auto-layout _(next)_

- **Goal:** the structure the canvas inferred is visible and editable in place.
- **Build:** frame chrome showing direction, gap and padding with inline controls; "wrap in frame"
  over a selection; select-through into nested frames.

## C7 — The rest of the feel _(next)_

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
