# 13 — The Inspector

> The right-hand panel, as a design tool's design panel. Companion to `12-canvas.md` (the surface
> it edits) and `05-guardrails.md` (the design system it edits *through*).

## The shape

Figma's Design panel is the reference, and the reason is not fashion: it is the densest arrangement
of object properties that stays readable, and every designer already knows where to look in it.

- The **name** sits in the header beside the type, editable in place.
- Everything else is a **titled, collapsible section**, in the order a designer reaches for it:
  Position, Layout, Appearance, Fill, Stroke, Effects, Text, Properties, On click, Conditions.
- Inside a section, controls sit in **dense pairs with a mark in front** — `X 0`, `W 382`, `% 100`.
  The mark is the label; a column of words beside a column of numbers is what makes a panel long.
- What a designer collapses **stays collapsed**, across selections and reloads. The panel settles
  into the shape of the work rather than resetting every time something is clicked.

## What is deliberately not copied

**The palette.** The mockup is dark; loom is light-mode only, and red is reserved for the primary
action and the FN node category (`05-guardrails.md` 19-24). The structure is the borrowed part.

**Nothing about colour, in the end — but the order is the argument.** The first version of this
panel offered tokens *only*, on the grounds that a hex box turns a design system back into a
styling panel. That was half right. A designer composing a screen needs a colour before they know
whether it deserves a name, and a tool that refuses until they decide is a tool they fight.

So the picker opens on **the project's own swatches**, with the custom controls underneath and a
line saying what the difference is: a token is a decision the whole project follows, a custom
colour is a value on one object. Tokens stay first, stay the default, and still emit
`var(--loom-…)`; a custom colour is stored as the literal it is. The same shape applies to corner
rounding — the scale first, a number beside it.

**Grid flow.** Figma offers grid; loom emits flex, and a grid control that produced rows of flex
would be a picture of a layout the app does not have (`specs/layout-model.md`).

**Export.** There is nothing to export: the project *is* a repo, and shipping it is Deploy.

## What each section is allowed to offer

| Section | Shown for | Writes |
| --- | --- | --- |
| Position | a child of a **free** frame | `position`, `rotation`, `flipX`/`flipY` |
| Layout / Size | containers / everything else | `layout.mode`, direction, gap, padding, align, size |
| Appearance | everything | `opacity`, `radius`, `clip` (containers), editor visibility |
| Fill · Stroke · Effects | everything | `background`, `borderColor` + width, `shadow` |
| Text | Text, Button, Link, Checkbox | `textColor`, `fontSize`, `fontWeight`, `align` |
| Properties | whatever the type declares | the component's own props |
| On click · Conditions · Backend | where they mean something | actions, conditions, inference |

A control is only offered where it means something: a rectangle is not asked how it stacks the
children it cannot have, and a child of an auto-layout frame is not offered coordinates it does not
own. **Alignment is a one-off calculation**, not a rule that keeps holding — a rule that keeps
holding is what auto layout is for.

## Effects

Each entry is a **composition a designer names**, not a CSS property they assemble:

| Effect | What it emits |
| --- | --- |
| Drop shadow · Inner shadow | `box-shadow`, stacking in the order added |
| Glass | `backdrop-filter: blur(…)`, a translucent tint over it, and the hairline edge that makes glass read as glass |
| Noise | a grain overlay the browser draws from an SVG filter — no asset, no request, and it scales with the box — blended over the fill |
| Layer blur | `filter: blur(…)`, which is the layer itself rather than what is behind it |

Asking someone to remember that "glass" means three properties is how a design tool turns into a
stylesheet. Everything here is still ordinary CSS in the emitted app: no runtime, no library,
nothing to install.

## The properties this added

Three per-object properties, and they are per-object on purpose: no token scale stands behind "37%
opacity" or "15 degrees".

- `opacity` — 0-100, emitted only when it is not 100.
- `rotation`, `flipX`, `flipY` — one CSS `transform`. Painted rather than laid out, so the box a
  thing occupies never moves and they stay safe inside a frame that arranges its children.
- `clip` — `overflow: hidden` on a container.
