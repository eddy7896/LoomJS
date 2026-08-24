---
name: loomJS
description: A visual programming language with Figma-style design tools, drawn on paper, wired in signal.
colors:
  brand: "#EC3013"
  brand-hover: "#D42A0F"
  brand-tint: "#FDECE8"
  node-ui: "#7C5CFF"
  node-ui-fill: "#F2EFFE"
  node-ui-bd: "#D7CDFB"
  node-fn: "#EC3013"
  node-fn-fill: "#FDECE8"
  node-fn-bd: "#F7C8BD"
  node-api: "#12A07A"
  node-api-fill: "#E6F6F1"
  node-api-bd: "#B4E2D6"
  node-state: "#2F7DE1"
  node-state-fill: "#E9F1FD"
  node-state-bd: "#BFD8F7"
  node-db: "#D98A12"
  node-db-fill: "#FBF1DF"
  node-db-bd: "#F0D8A8"
  ink: "#1B1D21"
  ink-2: "#4B5058"
  ink-3: "#868D97"
  panel: "#FFFFFF"
  canvas: "#F6F7F9"
  hair: "#E8EAEE"
  hair-2: "#DFE2E7"
typography:
  display:
    fontFamily: "Archivo, system-ui, -apple-system, sans-serif"
    fontSize: "clamp(36px, 5.5vw, 56px)"
    fontWeight: 700
    lineHeight: 1.04
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Archivo, system-ui, -apple-system, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Archivo, system-ui, -apple-system, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Archivo, system-ui, -apple-system, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Archivo, system-ui, -apple-system, sans-serif"
    fontSize: "10px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "0.08em"
  code:
    fontFamily: "JetBrains Mono, ui-monospace, Menlo, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
rounded:
  control: "6px"
  control-lg: "8px"
  surface: "14px"
  surface-lg: "16px"
  pill: "999px"
  marquee: "2px"
spacing:
  hair: "2px"
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "12px"
  xxl: "16px"
components:
  button:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "4px 10px"
    typography: "{typography.body}"
  button-primary:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.panel}"
    rounded: "{rounded.control}"
    padding: "4px 10px"
  button-primary-hover:
    backgroundColor: "{colors.brand-hover}"
    textColor: "{colors.panel}"
  input:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "4px 6px"
  chip:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink-3}"
    rounded: "{rounded.pill}"
    padding: "0 6px"
    typography: "{typography.label}"
  panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    padding: "10px"
  artboard:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.surface}"
  node:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
    width: "220px"
  node-head-ui:
    backgroundColor: "{colors.node-ui-fill}"
    textColor: "{colors.ink}"
  node-head-fn:
    backgroundColor: "{colors.node-fn-fill}"
    textColor: "{colors.ink}"
  node-head-api:
    backgroundColor: "{colors.node-api-fill}"
    textColor: "{colors.ink}"
  node-head-state:
    backgroundColor: "{colors.node-state-fill}"
    textColor: "{colors.ink}"
  node-head-db:
    backgroundColor: "{colors.node-db-fill}"
    textColor: "{colors.ink}"
---

# Design System: loomJS

## 1. Overview

**Creative North Star: "The Drafting Table"**

loomJS is a work surface before it is an application. The canvas is paper (`canvas`, a cool
near-white), and the things you are actually making, artboards and nodes, sit on top of it as
physical objects with soft shadows underneath. Everything that is not the work is a 1px hairline
(`hair`) and a small ink label. There is no chrome competing with the drawing.

The system is deliberately compact. Interface type runs 9px to 13px, control radii are 6px to 8px,
and surface radii are 14px to 16px. This is a professional instrument for a designer who reads
code, in a full working session, on a desktop or large tablet. Density is not an accident and it is
not a bug to be softened. What density buys is a canvas that stays the largest thing on screen.

This system rejects the **generic SaaS dashboard**: rounded cards in a three-column grid, hero
metrics, a sidebar of fourteen icons, uniform padding on every surface. It equally rejects the
**AI-product aesthetic**: sparkle icons, purple-to-blue gradients, chat-first surfaces, "ask
anything" bars. loomJS emits deterministic code; nothing in the interface may imply the output was
guessed.

Light mode only. There is no dark theme and there is no toggle (guardrail 21). The drafting table
is lit.

**Key Characteristics:**

- Paper canvas, floating work, hairline everything else
- Color is category, never decoration
- 9px to 13px interface type; mono for every value, type, and identifier
- Flat at rest; a shadow means the thing genuinely floats
- Tablet and up, flex-first, with a graceful guard below 768px

## 2. Colors: Ink and Signal

Two populations of color, and they never trade jobs. **Ink** (ink, panel, canvas, hairlines) is the
substrate: it carries no meaning, only structure. **Signal** (the brand red and the five node
category hues) carries all the meaning in the product. A designer reading the graph reads type
information from hue alone, which is exactly why hue can never be spent on decoration.

### Primary

- **Loom Red** (`#EC3013`): the single primary action, and the FN node category. Nothing else. It
  appears on one button per screen at most. Its rarity is the entire reason it works as a call to
  action and as a category marker at the same time.
- **Loom Red Pressed** (`#D42A0F`): hover and active state for the primary action only.
- **Red Tint** (`#FDECE8`): the FN node header fill and the primary button's quiet background. Never
  a decorative wash.

### Secondary: the five category hues

These are the product's type system rendered as color. Each hue ships as a triple: the line color,
a pale fill for node headers, and a mid border for chips and outlines.

- **UI Violet** (`#7C5CFF`, fill `#F2EFFE`, border `#D7CDFB`): UI nodes. Mirrors of components that
  exist on an artboard.
- **FN Red** (`#EC3013`, fill `#FDECE8`, border `#F7C8BD`): Function nodes. Shares the brand red on
  purpose; a function is loom's primary verb.
- **API Green** (`#12A07A`, fill `#E6F6F1`, border `#B4E2D6`): API route nodes. Server boundary.
- **State Blue** (`#2F7DE1`, fill `#E9F1FD`, border `#BFD8F7`): State nodes. Values that persist
  across a render.
- **DB Amber** (`#D98A12`, fill `#FBF1DF`, border `#F0D8A8`): Database nodes, generated from real
  schema by the connector.

### Tertiary: status

Status reuses three category hues rather than introducing new ones. Success is API Green,
in-progress is DB Amber, error is Loom Red. This is intentional economy, not laziness: a five-hue
vocabulary that also covers status is smaller and more learnable than eight hues. Status color
always appears with a word, never alone.

### Neutral

- **Ink** (`#1B1D21`): all primary text, and all editor furniture that needs emphasis. Selection
  chrome, focus rings, and active states are ink, not brand.
- **Ink 2** (`#4B5058`): secondary text, descriptions, inactive labels that still need to be read.
- **Ink 3** (`#868D97`): the quietest step, and **not a text colour on light surfaces**: it
  measures 3.1:1 on canvas and 3.3:1 on panel. Use it for rules, dots, dividers and other non-text
  marks. Metadata, port type hints, chip text and placeholders take Ink 2.
- **Panel** (`#FFFFFF`): panels, artboards, node bodies, inputs. The things you work on and in.
- **Canvas** (`#F6F7F9`): the table itself, plus sunken areas inside nodes and panels.
- **Hairline** (`#E8EAEE`) and **Hairline 2** (`#DFE2E7`): every border and divider in the product.
  Structure is drawn with 1px, not with shadow and not with fill.

### Named Rules

**The Signal Reserve Rule.** The six signal colors are spent only on their assigned meaning: brand
red on the primary action and FN, each category hue on its category. A category hue used on a
toolbar, a badge, a hover state, or an illustration corrupts the graph's type system and is
prohibited.

**The Ink Furniture Rule.** Selection, focus, active tabs, and hover chrome are `ink`. The studio
never highlights its own furniture in brand red, because the designer must be able to find the one
red thing that is an action.

**The Never-Only-Color Rule.** A category hue never travels alone. Every node, port, and chip that
uses a category color also carries its label or a distinguishing shape, so a colorblind user reads
the graph exactly as fast. This is the highest-cost accessibility rule in the product; color IS the
type system at a glance.

## 3. Typography

**Display / Interface Font:** Archivo (fallback: system-ui, -apple-system, sans-serif)
**Code / Value Font:** JetBrains Mono (fallback: ui-monospace, Menlo, monospace)

**Character:** Archivo is a grotesque with tight apertures that holds up at 10px, which is the whole
reason it is here: this interface needs a face that stays legible at label sizes without going wide.
JetBrains Mono is not decoration, it is a signal in its own right. Anything the compiler will read
(a type, a port name, a path, a value, an identifier) is set in mono, so a designer can tell "words
about the app" from "the app's actual data" without reading either.

### Hierarchy

- **Display** (700, `clamp(36px, 5.5vw, 56px)`, 1.04, -0.035em): landing hero only. Never appears
  in the studio.
- **Headline** (700, 24px, 1.15, -0.02em): section heads on the brand surface, and the loom
  wordmark.
- **Title** (600, 13px, 1.3): panel titles, inspector section heads, node titles. The heaviest thing
  in the studio, and it is 13px. This is correct.
- **Body** (400, 13px, 1.5): the studio base size. Prose in the studio is rare by design; where it
  exists, cap it at 65 to 75ch.
- **Label** (500, 10px, 0.08em tracking, uppercase): panel group labels, node body labels, port
  section heads. Uppercase plus wide tracking is the only place this system shouts, and it shouts
  quietly.
- **Code** (400, 11px, 1.55): types, values, port names, file paths, log lines, the Code tab.

### Named Rules

**The Mono Means Machine Rule.** If the compiler reads it, it is set in JetBrains Mono. Type names,
port names, env keys, table and column names, file paths, and any literal value. If a human wrote it
to be read by a human, it is Archivo. Never mix the two inside one string for emphasis.

**The Ten-Pixel Floor Rule.** 10px uppercase labels and 9px metadata are the smallest permitted
steps. Nothing smaller ships, and nothing at those sizes is ever the only carrier of a piece of
information.

**The Readable Grey Rule.** Any text on `panel` or `canvas` is `ink-2` (`#4B5058`, 7.8:1) or
darker. `ink-3` fails AA as text and is reserved for non-text marks. On the brand surface's ink
fold, the muted step (`#9AA1AA`) clears 6.6:1 and is safe.

## 4. Elevation

Flat by default. Structure is drawn with 1px hairlines, not with shadow and not with tonal fill:
panels, rows, fields, tabs, and list items sit directly on their surface with a border. A shadow in
this system is a literal claim that the object floats above the drafting table, and it is reserved
for exactly four things: artboards, nodes, floating menus and dropdowns, and overlays.

Shadows are cool and low-contrast, tinted toward the ink hue (`rgb(20 22 26 / …)`) rather than pure
black, so they read as paper shadow rather than as a drop shadow effect.

### Shadow Vocabulary

- **Resting** (`box-shadow: 0 1px 2px rgb(20 22 26 / 8%)`): nodes at rest. Just enough to lift the
  card off the canvas.
- **Artboard** (`box-shadow: 0 1px 2px rgb(20 22 26 / 8%), 0 12px 32px rgb(20 22 26 / 8%)`): the
  double shadow that makes an artboard read as a sheet on a table. Contact shadow plus ambient.
- **Menu** (`box-shadow: 0 12px 32px rgb(20 22 26 / 16%)`): dropdowns, pickers, context menus.
  Temporarily above everything.
- **Overlay** (`box-shadow: 0 18px 48px rgb(20 22 26 / 18%)`): the rare full overlay. Highest step.
- **Selection ring** (`box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent)`):
  not elevation, a state. Ink at 30%, never brand.

### Named Rules

**The Floating Claim Rule.** A shadow says "this floats." Panels do not float, rows do not float,
cards in a list do not float. If it is attached to the layout, it gets a hairline and no shadow. If
you reach for a shadow to create hierarchy, you have skipped the hairline that was the right answer.

**The Flat Depth Test.** If two surfaces sit at the same z-height and you can tell them apart only
by shadow, the shadow is wrong. Separate them with a hairline or with the `canvas` / `panel` fill
pair instead.

## 5. Components

Compact and unadorned. Rest states are quiet: thin border, no fill, no transition. The design lives
in the border, the type, and the alignment, not in the container.

### Buttons

- **Shape:** small radius (6px). Never pill, never square.
- **Default:** `panel` background, `hair` 1px border, `ink` text, 4px 10px padding, 13px. A studio
  button is a labeled affordance, not a call to action.
- **Hover:** border darkens to `ink-3`. Background does not change.
- **Primary:** `brand` background, `brand` border, white text, same geometry. One per screen. Hover
  to `brand-hover` (`#D42A0F`).
- **Disabled:** 40% opacity, default cursor. No greyed-out fill.
- **Active / toggled:** ink background, not brand, per the Ink Furniture Rule.

### Inputs and Fields

- **Style:** `panel` background, 1px `hair` border, 6px radius, 4px 6px padding, full width, 13px.
- **Focus:** ink border plus an ink focus ring. Every interactive element must have a visible
  `:focus-visible` state; this is a WCAG 2.2 AA commitment, not a nicety.
- **Values:** any field holding a type, key, path, or literal is set in JetBrains Mono.
- **Error:** `brand` border with an adjacent message in `ink-2`. Never a red fill.

### Chips

- **Style:** `canvas` background, 1px `hair` border, pill radius (999px), 0 6px padding, 10px
  `ink-3` text. Used for port types, counts, and small metadata beside a title.
- **Category chips:** take the category fill and border pair, and always carry the category name.
  Never hue alone.

### Panels

- **Style:** `panel` background, 1px `hair` right or bottom border, 10px padding, scrolls
  independently. No radius, no shadow: panels are the frame, not the work.
- **Group labels:** 10px uppercase, 0.08em tracking, `ink-3`.
- **Empty state:** one sentence in `ink-3` at body size, stating what would appear here and the
  action that puts it there. No illustration, no icon.

### Artboards

- **Shape:** 14px radius, `panel` fill, no border.
- **Elevation:** the Artboard double shadow. This is the object that most needs to read as physical.
- **Label:** 13px `ink-3` sitting above the artboard, outside its bounds, so nothing overlaps the
  designed surface.

### Nodes (signature component)

The node card is the product's signature object and the one place where the category system becomes
visible.

- **Shape:** 14px radius, 220px minimum width, `panel` fill, 1px `hair` border, Resting shadow.
- **Head:** 6px 10px padding, category fill background, bottom hairline, radius matching the card's
  top corners. Title at 600/12px, kind label at 10px `ink-3`. The kind label is what satisfies the
  Never-Only-Color Rule.
- **Body:** `canvas` fill, 8px 10px padding, bottom hairline. Section labels are 10px uppercase.
- **Ports:** a flat row, 8px gap, 3px vertical padding, name in mono, type in a chip.
- **Selected:** `ink` border plus a 2px ink ring at 30%. Not brand.

### Motion

The studio currently ships zero transitions and zero keyframes, and that restraint is correct as a
default: a canvas tool must never animate under a drag. Where motion is added, it is state feedback
only, 120ms to 200ms, on `opacity`, `color`, `border-color`, `box-shadow`, and `transform`. Never on
layout properties. Ease out with an exponential curve. No bounce, no elastic, no entrance
choreography anywhere in the studio. `prefers-reduced-motion: reduce` removes all of it.

## 6. Do's and Don'ts

### Do:

- **Do** reserve `#EC3013` for the single primary action and the FN node category, and spend it once
  per screen at most.
- **Do** make selection, focus, and active chrome `ink` (`#1B1D21`), so the one red thing on screen
  is always an action.
- **Do** pair every category hue with its label or a distinguishing shape, every time.
- **Do** draw structure with 1px `#E8EAEE` hairlines. Reach for the hairline before the shadow.
- **Do** set anything the compiler reads (types, ports, paths, keys, values) in JetBrains Mono.
- **Do** give every interactive element a visible `:focus-visible` state and a keyboard path,
  including canvas, inspector, and node graph.
- **Do** set text on light surfaces in `ink-2` or darker. `ink-3` is a mark colour, not a text
  colour.
- **Do** vary padding by role: 10px in panels, 6px 10px in node heads, 4px 10px in controls, 4px 6px
  in inputs. Uniform padding across every surface is the SaaS dashboard tell.
- **Do** keep body prose to 65 to 75ch on the rare surfaces that have prose.

### Don't:

- **Don't** build a **generic SaaS dashboard**: no rounded cards in a three-column grid, no hero
  metric block, no icon-stack sidebar, no identical repeating card layouts. loomJS has one
  workspace, not a set of panels to survey.
- **Don't** reach for the **AI-product aesthetic**: no sparkle icons, no purple-to-blue gradients,
  no chat-first surface, no "ask anything" bar. The compiler is deterministic and the interface must
  say so.
- **Don't** use `border-left` or `border-right` greater than 1px as a colored accent stripe on
  cards, rows, callouts, or log lines. Use a full border, a category fill, or a leading label
  instead. (`apps/studio/src/index.css:2399` currently violates this and should be rewritten.)
- **Don't** use `background-clip: text` with a gradient. Emphasis is weight and size.
- **Don't** use glassmorphism or backdrop blur in the studio. The floating nav on the landing surface
  is the one deliberate exception and it does not transfer.
- **Don't** add a dark theme or a theme toggle. Light mode only (guardrail 21).
- **Don't** spend a category hue on chrome, decoration, illustration, or a hover state.
- **Don't** introduce a new hue, a new radius step, or a new font. The palette, the radius scale, and
  the Archivo plus JetBrains Mono pairing are fixed by guardrails 19 to 24.
- **Don't** use pure `#000` or a pure black shadow. Shadows are tinted `rgb(20 22 26 / …)`.
- **Don't** reach for a modal. Exhaust inline and progressive alternatives first; a modal is a
  failure of the "never left the canvas" principle.
- **Don't** animate layout properties, and never animate anything during a canvas drag.
