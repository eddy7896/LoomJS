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

**A hex field on the fill.** Figma edits colour per object; loom edits it *once*, in the system. A
fill names a token and the swatch shows what that token currently resolves to, so moving the token
moves every surface built on it. A hex box here would quietly turn the design system back into a
styling panel.

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

## The properties this added

Three per-object properties, and they are per-object on purpose: no token scale stands behind "37%
opacity" or "15 degrees".

- `opacity` — 0-100, emitted only when it is not 100.
- `rotation`, `flipX`, `flipY` — one CSS `transform`. Painted rather than laid out, so the box a
  thing occupies never moves and they stay safe inside a frame that arranges its children.
- `clip` — `overflow: hidden` on a container.
