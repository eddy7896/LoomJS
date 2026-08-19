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
