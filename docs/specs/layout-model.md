# Spec 5 — Layout Model (v1)

> The fifth of the five "next specs" (`03-system-memory.md`), gating **M1**. Layout is the one
> part of the document that the canvas, the inspector, and the compiler must all read the same
> way — a divergence shows up instantly as "the Preview doesn't look like the artboard."
> `packages/compiler/src/emit/layout.ts` is authoritative; this doc is its prose companion.

## The rule: flex-first, never absolute

A loom layout is a **flex box**, always. There is no x/y positioning, no z-ordering by
coordinate, no drag-anywhere placement (guardrail: flex-first, tablet-and-up). Position comes
from *order within a parent* plus the parent's flex settings. This is what makes the emitted
code readable React that a developer would have written by hand, and what keeps a future
responsive story tractable.

Consequence for the canvas: **you cannot drag a component to an arbitrary point.** Moving a
component means reordering or reparenting it (`moveComponent` op) — dragging on the canvas is a
tree operation wearing a spatial costume.

## Who owns layout

Only **containers** own a `layout` (today: `Frame`). A leaf (`Text`) has none; it is sized by
its content and positioned by its parent. `@loom/components` declares which types are
containers, so the inspector shows the Layout section for exactly those.

## The container fields

| Field | Values | CSS |
| ----- | ------ | --- |
| `direction` | `row` \| `column` | `flex-direction` |
| `gap` | number (px) | `gap` |
| `padding` | number (px) | `padding` |
| `align` | `start` \| `center` \| `end` \| `stretch` | `align-items` (`flex-start`/`flex-end` for the ends) |
| `justify` | `start` \| `center` \| `end` \| `between` | `justify-content` (`space-between` for `between`) |
| `size` | optional `{ width, height }` | see below |

Every container emits `display: flex` plus the five fields above. The vocabulary is deliberately
smaller than CSS: one visible term per concept (`06-glossary.md`), and the arbitrary remainder is
routed to the Code node rather than growing this table (guardrail 7).

## Sizing: hug / fill / fixed

`size` is per axis and optional; absent means "hug".

| Mode | Meaning | CSS |
| ---- | ------- | --- |
| `hug` | size to content | `flex-grow: 0` (flex default sizing) |
| `fill` | take the available space along the parent's axis | `flex-grow: 1` + `width`/`height: 100%` |
| `fixed` | an exact pixel size | `width`/`height: <px>` + `flex-shrink: 0` |

## Emission contract

- The compiler emits layout as an **inline style object** on the container's `<div>`. Inline
  keeps codegen deterministic and collision-free; the design-system/token pass (M4-era shadcn
  work) is what will move it to classes.
- The studio canvas imports the **same** `layoutToStyle` from `@loom/compiler` rather than
  reimplementing it. One source of truth is the whole point — canvas and Preview cannot drift.

## Out of scope (v1)

- Breakpoints / distinct mobile-tablet-desktop layouts (`07-v1-scope.md` "Out").
- Grid, absolute/sticky positioning, z-index, transforms.
- Per-child overrides (`align-self`, `order`, `flex-basis`) — order is the tree, and a child that
  needs its own alignment gets wrapped in a Frame.
- Min/max sizing and aspect ratio — additive later, not load-bearing for M1.

## Style and tokens (the design system's half)

Layout says where things sit. **Style says what they look like, and it is chosen from a token
scale rather than typed** (`docs/05-guardrails.md` 19-24). `@loom/ui` owns the scales — colour,
space, radius, type size, weight, shadow — and each token is a *named decision* with a stable id.

- A styled property in the document holds a **token reference**, and the compiler emits
  `var(--loom-color-brand)` rather than the value behind it. Restyling a project is one `:root`
  change, and the emitted code says *why* a surface is that colour.
- A **literal** is the escape hatch. It exists, and it is deliberately more effort to reach for
  than picking from the scale.
- `Snapshot.theme` holds per-project overrides keyed by token id. One entry moves every surface
  built on that token. Everything else stays where it was — an override is one decision, not a
  new palette.
- The emitted app gets `src/theme.css` (the `:root` block) and loads Archivo + JetBrains Mono.
  The **studio's canvas defines the same custom properties** on its artboard layer, so the canvas
  and the Preview resolve the same variables and cannot disagree.
- The curated property set is small on purpose: fill, text colour, size, weight, corners, shadow,
  border, alignment. Anything past that belongs to a component kit, not to loom's core.
- A token id that is not in the system is a **Build error naming the property**. An undefined
  custom property renders as nothing at all, and a silent blank is worse than a stopped build.

## Screen sizes are a frame, not a breakpoint

An artboard carries an optional `size` (width, height, and the preset it came from). Presets cover
phone, tablet and desktop at real CSS pixel sizes; any size can also be dragged from the screen's
bottom-right corner or typed in the Inspector.

**It changes nothing the compiler emits.** V1 ships one flex layout that adapts, and distinct
per-device layouts are explicitly out of scope (`docs/07-v1-scope.md`). What a size changes is the
frame the designer works in and **the width the Preview runs at**, so "does this fit on a phone"
is answered by looking rather than guessing. Calling it a breakpoint would promise responsive
behaviour the compiler does not implement.

Two details worth keeping:

- The height is a **minimum**. Content taller than the frame grows the artboard rather than being
  clipped — a designer has to be able to see what they built.
- A drag is **one op, applied on release**. The size travels in local state while the pointer
  moves, so undo steps back over the whole resize rather than one pixel of it.
