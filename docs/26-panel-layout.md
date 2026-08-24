# 26 — Panels that hold their shape

> Where Problems lives, and why the inspector's dense rows stopped clipping themselves. Companion
> to `13-inspector.md` (the panel's design) and `11-editor-shell.md` (the rail).

## Problems is pinned

It used to sit wherever the panel above it happened to end — halfway up an empty rail, at the
bottom of a full one, and somewhere new every time the panel's content changed. The place you look
for what is wrong was never the same place twice.

It now sits at the **bottom of the rail**, always. One line of CSS does it — `margin-top: auto` —
and the panel above scrolls inside itself rather than pushing anything off the rail.

Floating was the other option offered and is worse here: a popup covers the thing it is telling you
about, and this panel is read while looking at the canvas.

## The inspector's rows wrap

The panel is narrow and gets narrower. Its rows are deliberately dense — `X 0`, `W 382`, a mark and
a value — and dense rows that can only *shrink* eventually crush what is in them. The Appearance
row was doing exactly that: opacity, a corner radius, a token picker and two icon buttons in one
line, with the radius cell squeezed until its select read **"cus"**.

Three changes, in order of how much they matter:

1. **Rows wrap.** A cell that cannot fit moves to the next line instead of being crushed. It costs
   a line and keeps every control legible at any width.
2. **A cell has a floor** — 88px, enough for a mark and a number. Below that it wraps rather than
   shrinking into something unreadable.
3. **A select sharing a cell gives way first.** It used to refuse to shrink, so the number — the
   actual value — was the thing pushed out of sight. The wrong way round.

And rounding got its own row. Four controls in one line was too many even with wrapping, and a
radius is its own decision rather than a footnote to opacity.

## Hints are quieter than what they explain

They were `--ink-2`, which is nearly body-text dark, so a panel of short controls read as a wall of
prose with some inputs in it. They are `--ink-soft` now. Muted is what muted is for.

## Measured, not eyeballed

A screenshot review catches this once. The guard catches it every time: for every element type the
palette offers, and at a narrower window as well, the test walks the inspector and fails on

- anything whose content is wider than the box holding it,
- anything reaching past the panel's own edge,
- any two controls in a row occupying the same pixels,

and separately checks that Problems' bottom edge is the rail's bottom edge, before and after the
section above it changes.

Reverting the fixes makes all three fail, which is how the guard was checked rather than assumed.
