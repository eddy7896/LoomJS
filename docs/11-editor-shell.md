# 11 — The editor shell (S0–S5)

> The left rail answers **what exists**; the floating toolbar on the canvas answers **what am I
> drawing** (`docs/12-canvas.md`). Both reach the same vocabulary on purpose: crossing the window
> to a column mid-gesture is what the toolbar removes.

> Plan for the studio's own interface: the left sidebar, the element palette, and the elements
> tree. Companion to `09` (M0–M6, the compiler) and `10` (P0–P7, the language). Reference imagery
> is Bubble's builder sidebar.

## Why this plan exists

Every component the studio can place is a `+ Label` button in the top toolbar. That was fine at
three components. It is at **eight** today (Frame, Text, Button, Text field, Number field,
Checkbox, Select, List) and the phases already planned add more: a Table and a Searchbox with P4,
three auth elements with P5, reusable components with P7. A row of buttons does not survive that,
and it is already the least usable surface in the editor.

Three things are missing and none of them are cosmetic:

1. **No search.** Finding an element means reading every button.
2. **No categories.** "Where do I get a checkbox" has no answer except scanning.
3. **Two places for one question.** The Layers panel says what is *on* the screen; the toolbar says
   what can be *added*. Bubble puts both in one column, and it is right to.

## What survives the translation

Bubble's sidebar is the best-solved version of this problem, and most of it transfers. Some of it
must not.

**Take:** the single left column; search over the palette; collapsible categories; the elements
tree pinned above the palette; an icon rail for the major modes.

**Leave:**

- **"Install More" / the plugin marketplace.** loom's curated vocabulary is a feature, not a
  limitation (`05` guardrail 7). A marketplace is the mechanism by which a scope ceiling stops
  existing. The escape hatch is the **Code node** and an **HTML element**, both of which emit code
  the person owns.
- **Sixty elements.** The same discipline spec 7 applied to actions applies here: an element earns
  its place only if it cannot be said with what already exists, and the 80% needs it. Most of
  Bubble's palette fails that test against a language that already has Frame + style + conditions.
- **"Built on Bubble."** Not applicable.

---

## S0 — The shell ✅ _(done)_

**Goal:** one left column that holds the tree and the palette, and an icon rail beside it.

**Build:**

- An **icon rail** down the far left, replacing the Design/Nodes tabs in the top toolbar:
  Design · Nodes · Data · Settings. (Code, API and Logs are drawn but disabled until they have
  something behind them — a rail that lies is worse than a short rail.)
- The left column becomes: **Elements Tree** (top, resizable) → **Palette** (below, scrolls) →
  **Problems** (bottom, already built in P2).
- The top toolbar keeps only what is genuinely global: brand, undo/redo, save state, Preview
  toggle. `+ Screen` went to the tree header instead, where screens are — one place, not two.
- No new component types, no schema change, no compiler change.

**Done-when:** every component that was a toolbar button can be placed from the sidebar, and the
toolbar no longer lists components.

**What it actually cost.** Almost no spec churn: the palette buttons and rail buttons kept the
accessible names the toolbar used (`+ Text field`, `Nodes`), so only the specs that reach the Data
panel needed a rail click first. Two real things did surface:

- **The canvas got 56px narrower and seven pointer-drag specs failed.** Not flakiness — at
  Playwright's 1280px default, a builder with five panels leaves the Nodes canvas fitting so far
  out that adjacent ports land within a few pixels of each other. The test viewport is now 1600×900,
  which is the window the studio is designed for; the canvas ends up wider than before.
- **A preview bug the shell did not cause but did expose** (see below).

**Preview: a new module needs a full reload.** The first time a project uses a `message` action the
compiler emits `src/state/messages.tsx` and rewrites `App.tsx` to wrap the router in its provider.
HMR applied the screen's update against an App that had not re-rendered, so the screen called a
hook whose provider was not there and the preview went blank until someone reloaded. The plugin now
counts files it has never written before and sends a full reload when that count is non-zero. HMR
is safe for a module's contents changing; it cannot absorb one appearing.

## S1 — Search and categories ✅ _(done)_

**Goal:** finding an element takes one keystroke, not a scan.

**Build:**

- A `category` and `keywords` field on `ComponentDef`, so the palette is generated from the
  vocabulary rather than hand-listed. Categories: **Visual · Containers · Input forms**, and later
  **Authentication** (P5) and **Reusable** (P7).
- Fuzzy-ish search over label + keywords ("dropdown" finds Select; "textarea" finds Multiline).
- Collapsible sections that remember their state.
- The same treatment for the **Nodes** palette, which has the identical problem and more entries.

**Done-when:** typing "check" surfaces the Checkbox from a collapsed category.

Search and categories landed with S0 — both are generated from the same two new `ComponentDef`
fields, and splitting them meant editing the same three files twice. Two things followed:

- **Collapse is remembered**, in `localStorage`. Which sections you keep shut is a preference, not
  project data: it belongs to the browser and never to the snapshot. Losing it on every reload made
  the setting not worth having.
- **Enter places the top hit**, and clears the box. Searching for a thing and then having to aim at
  it is the half of "search" that saves nobody any time. It needed no focus model after all: the
  search input already has focus, which is the whole point.

## S2 — The elements tree ✅ _(done)_

**Goal:** the tree becomes the primary way to move around a screen.

**Build:**

- Screens and their component trees in one list, as today, plus:
  - **drag to reparent and reorder** (currently only nudge-up/down buttons exist);
  - **per-row visibility toggle** (an editor-only concern — it must never write `visibleWhen`, or
    a design-time convenience would silently change the emitted app);
  - **expand/collapse all**, and a badge on rows carrying conditions or an action sequence, both
    of which already have canvas markers.
- Selecting a row selects on canvas; selecting on canvas reveals the row.

**Done-when:** a component can be dragged into a different Frame from the tree alone, in one undo.

**How the drop reads.** A container takes the drop *inside* it; anything else takes it as the
*next sibling*. Two gestures that mean different things must not look the same, so they are marked
differently — an outline for "in here", a line beneath for "after this". A row may not be dropped
into its own subtree; the tree refuses before dispatching, so a bad drag never becomes an op at all
(`applyOp` guards it too).

**Hiding is a view concern, and it was worth being strict about.** The eye never writes
`visibleWhen`: a design-time convenience that silently changed the emitted app would be the worst
kind of bug, so `hiddenInEditor` lives beside the document, takes the subtree with it on the
canvas, and is gone on reload — a project that remembered which parts you had hidden would be a
project that lies about what it contains. The eye also sits outside the hover-only actions, because
which rows are hidden has to be legible without hovering every row in turn.

**Collapse moved into the store**, which fixed a real bug rather than being tidiness. The reveal
was an effect watching the *selection changing*, so clicking an already-selected component inside a
branch you had just folded did nothing at all. Selecting now opens the rows above it whether or not
the selection changed.

---

## S3 — The palette, filled: tier one ✅ _(done)_

Everything below is **new language surface**, and each entry states what it emits. Nothing is here
because Bubble has it.

| Element | Why it earns a place | Emits |
| --- | --- | --- |
| **Image** | There is currently no way to put a picture on a screen. That is a hole, not a gap. | `<img src alt>` |
| **Link** | `navigate` on a Button is a `<div>` that moves the page. A real link is right-clickable, middle-clickable, crawlable and reachable by keyboard. Accessibility is not a v2 feature. | `<a href>` / react-router `<Link>` |
| **Icon** | Every button row needs one, and the alternative is an Image per glyph. Ships a small curated set; no icon-font dependency. | inline `<svg>` |
| **Multiline input** | A textarea is not expressible as a Text field. | `<textarea>` |
| **Radio buttons** | A Select with three options is the wrong control for three options. | `<input type="radio">` group |
| **Date/time picker** | A date column cannot be filled correctly from a text field, and typed dates are the classic source of bad data. | `<input type="date">` |
| **Slider** | Cheap, and the right control for a bounded number. | `<input type="range">` |

Each is a `ComponentEmitter` plus an entry in `defs.ts`; the smoke gate that type-checks *every*
component the studio can place already exists and covers them.

**Done-when:** the "every component" smoke gate passes with the new set, and each new input's
mirror carries the right type into the graph.

**Decisions made while building them:**

- **A Link that points at a screen emits `<Link to>`, not `<a href>`.** A full page load would
  throw away the app's state to reach a route it already has. That needed one new thing on the
  emit context — `pathExpr`, the destination as a *value* rather than as a handler that goes
  there — and `navigateExpr` is now written in terms of it, so there is one definition of where a
  flow leads.
- **A date field's port is `text`, not `date`.** The browser hands back `YYYY-MM-DD`, and that
  string is exactly what a date column accepts; typing it `date` would promise a conversion
  nothing performs.
- **A radio group starts on nothing.** Unlike a Select, which always shows something, "nothing
  chosen" is a real answer for a radio group. Its `name` is derived from the component id, because
  two groups sharing a name would let a choice in one clear the other — a bug nobody would guess
  from the canvas.
- **`alt` is always written, even when empty.** Empty alt is a decision ("this picture carries no
  meaning"), and a builder that makes it easy to omit produces inaccessible apps by default.
- **A freshly placed Link compiles.** Its address defaults to a placeholder rather than empty —
  the same rule an action follows when it is added already pointing at something real. The
  existing vocabulary gate caught this immediately.

## S4 — The palette, filled: tier two

Larger, and each depends on something else landing first.

| Element | Depends on | Note |
| --- | --- | --- |
| **HTML** | nothing | The UI escape hatch, matching the Code node's role for logic. Must be explicitly marked unsafe-by-design and never take a binding without escaping. |
| **Table** | **P4** (CRUD) | The right way to show rows; a List of Frames is what people build because nothing better exists. Belongs with the phase that makes rows editable. |
| **Searchbox** | **P4** (filter constraints) | Without a filter to drive, it is a Text field with a magnifier. |
| **Popup** / **Floating group** | nothing, but wants S2's tree | A Frame with fixed positioning and a `visibleWhen`. Worth having as a named thing because the layout is fiddly and the pattern is universal. |
| **File / picture uploader** | storage | Needs a bucket, a signed upload and a stored URL. This is its own phase, not a palette entry. |
| **Video** | nothing | An embed. Low cost, low urgency. |

---

## S5 — Responsive

The screenshots show a **Builder / Responsive** tab pair. loom has screen sizes (device presets and
drag-to-resize) but no way to say "this Frame is a row on desktop and a column on phone".

That is a genuine second mode, it touches the layout spec (`specs/layout-model.md`), and it is
large. It is listed here so it is not mistaken for part of the sidebar work, and it should be
planned properly before it is built.

---

## Rejected, with reasons

These appear in the reference and should not be built. Recording *why* is the point — otherwise
they get proposed again.

- **Shape.** A Frame with a background, a radius and a border already is one. A second way to draw
  a box would be two things to teach and two to maintain.
- **Alert.** A Text with a conditional style and a `visibleWhen` says it, and P3 already added a
  message toast for the transient case. Same argument that removed `show`/`hide` from the action
  catalogue (`specs/actions.md`).
- **Group focus.** A menu anchored to an element. Real, but it is a positioning behaviour on a
  container, not a new element — and nothing in the 80% needs it yet.
- **Map.** Needs a third-party key, a script tag and a library. It is a plugin in every tool that
  has one, and loom has no plugin system by choice.
- **Install more.** See "What survives the translation".

## Deferred to phases that already own them

- **Authentication elements** → P5.
- **Reusable elements** → P7, and `10`'s open decision 2 already recommends they follow M6.
- **Table, Searchbox** → P4, as above.

---

## Order, and why

**S0 → S1 → S2**, then **S3**, then S4 as its dependencies land.

The shell comes first because it is the thing that makes everything after it cheap: once the
palette is generated from `ComponentDef`, adding an element is one def and one emitter, and it
appears in the right category with search for free. Doing S3 first would mean adding seven more
buttons to a toolbar that is already the wrong shape.

S5 is not in that chain and should not block any of it.

## What this plan does not change

- The snapshot schema, except for two presentational fields on `ComponentDef` (`category`,
  `keywords`) which are editor metadata and never reach the emitted app.
- The compiler, for S0–S2. Not one line.
- The guardrails. A bigger palette is still a **curated** palette, and the bar in S3 is the same one
  spec 7 set for actions.
