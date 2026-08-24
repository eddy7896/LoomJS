# 27 — Variants: modern defaults for every element

A Button dropped on the canvas was a **browser default button** — grey, square, 1995. Every project
started by hand-styling the same six properties on every element, and two designers on the same
project hand-styled them differently. The vocabulary could say *what* an element was and never
*which kind* it was.

Shadcn and MUI answer this the same way, and the answer is right: an element has a small set of
named **variants**, one of them is the default, and picking one is a choice from a list rather than
a colour typed into a box.

## The rule

- **A variant is a named decision, exactly like a token.** The document stores `variant: "outline"`,
  never the border and background that outline currently means. Restyling every outline button in a
  project is one change in the stylesheet, not a sweep through the document.
- **One stylesheet, both sides.** The variant CSS lives in `@loom/ui` beside the tokens, is emitted
  into the project as `src/components.css`, and is injected into the studio's canvas. The canvas and
  the running app are painted by *the same bytes*. Anything else drifts, and a canvas that lies
  about what the app looks like is worse than no canvas.
- **Written in tokens, only in tokens.** No hex codes. A project that moves `color.brand` moves
  every solid button with it.
- **Variants are the floor, not the ceiling.** The style block still wins: a designer who sets a
  background on an outline button gets that background. Variants set the defaults worth having, and
  never take away the freedom to leave them.
- **Hover, focus and disabled are part of the element.** They are why this is a stylesheet and not
  an inline style object: `:hover` cannot be expressed inline, and an element that does not respond
  to a pointer does not look finished no matter how it is coloured.
- **Focus is never removed.** Every interactive variant carries a visible `:focus-visible` ring. A
  builder that ships keyboard-invisible controls by default ships inaccessible apps by default.

## Where it lives

| Piece | File |
| --- | --- |
| The stylesheet | `packages/ui/src/variants.ts` |
| The axes each element offers | `packages/components/src/defs.ts` |
| Document value → class names | `packages/components/src/variants.ts` |
| Emitted into the project | `packages/compiler/src/emit/project.ts` (`src/components.css`) |
| Drawn on the canvas | `apps/studio/src/canvas/ComponentView.tsx` |
| Picked by a designer | `apps/studio/src/inspector/Inspector.tsx` |

An **axis** is a named choice with options and a default — `variant`, `size`, `tone`. Axes are kept
apart from `fields` on purpose: a field is data the app reads at run time and can be bound to a
node port, and an axis is a design decision that is settled before the app runs. Mixing them would
have put "Style: solid" in the node graph as a port nobody would ever wire.

## The axes

### U1 — Button ✅

- **Style:** `solid` · `soft` · `outline` · `ghost` · `destructive` · `link`
- **Size:** `sm` · `md` · `lg`

`solid` is the default, because the most common button on a screen is the one that does the thing.
`destructive` is a variant rather than a token choice: "this deletes something" is a meaning, and
meanings belong in the vocabulary.

### U2 — The controls ✅

Text field, number field, multiline field, date field, select, checkbox, radio group, slider.

- **Style:** `outline` · `filled` · `underline` — the three shapes every design system converges on.
- **Size:** `sm` · `md` · `lg`, matching the button scale so a field and the button beside it line up.
- Checkbox additionally offers `switch`, which is the same state wearing the shape people expect for
  "on or off, right now" as opposed to "tick this to agree".

### U3 — Containers ✅

- **Frame:** `plain` · `card` · `panel` · `section` — a card lifts, a panel is outlined and flat, a
  section is a tinted band. Plain stays plain: a layout box that suddenly grew a border would break
  every project that already had one.
- **List:** `plain` · `divided` · `cards`
- **Table:** `plain` · `striped` · `bordered`

### U4 — The rest ✅

- **Text:** `body` · `display` · `title` · `subhead` · `caption` · `code` · `quote`. This is the type
  scale, applied by name. Setting a font size by hand still works and still wins.
- **Link:** `default` · `subtle` · `button`
- **Image:** `plain` · `rounded` · `circle` · `thumb`
- **Icon:** `plain` · `circle` · `square` · `tinted`

## What is deliberately not here

- **No variant per breakpoint.** V1 emits one adaptive layout (`docs/07-v1-scope.md`).
- **No user-authored variants.** A designer can restyle any instance and can move the tokens every
  variant is built from. Authoring a *new* named variant is a component-library feature, and the
  reusable-component work (P7) is where it belongs.
- **No dynamic variants.** An axis takes a static choice, not a binding. A button whose shape
  depends on run-time data is a conditional style, which the document already has and which is the
  honest way to say it.
