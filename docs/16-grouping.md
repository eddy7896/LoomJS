# 16 — Grouping

> Picking more than one thing, and wrapping it. Companion to `12-canvas.md` (the surface) and
> `13-inspector.md` (where the buttons live).

## A group is a Frame

Not a new kind of container. A Frame already lays out, already styles, already emits, and already
appears in the tree — a second container that only the editor understood would be one more thing
to tell apart, and it would have to become a Frame at compile time anyway.

So **Group** wraps a selection in a Frame, and **Ungroup** unwraps any Frame that has something in
it — including one a designer built by hand and now wants opened up.

## The geometry is the whole problem

Inside a free frame a child carries its own coordinates. Wrapping has to move them into the new
frame's space and unwrapping has to move them back out, or everything jumps to the corner the
moment you group it. That is the bug every home-made grouping has, and it is what most of the
tests are about:

- the frame lands on the selection's **bounding box** and takes a fixed size, so it can be seen
  and grabbed;
- each child's position becomes **relative to the frame** — a child at 240 inside a frame starting
  at 200 is at 40;
- ungrouping adds the frame's position back, so nothing moves on screen.

In a **stacked** parent there are no coordinates to preserve, so the group inherits the parent's
direction and the contents go on reading the way they did.

A component with no fixed size has no width the document knows — the browser decides it — so the
bounding box falls back to a readable minimum rather than to zero. A group drawn around a
zero-width thing would be one you cannot see or grab.

## Picking more than one thing

`selection` stays the one thing the inspector edits; `also` is what else is picked. Making the
whole selection a list would mean asking "which one do I edit?" in every panel, and the honest
answer — the one you clicked last — is exactly what `selection` already means.

Shift-click adds, in the tree and on the canvas alike. Shift-clicking the primary one **promotes
the next in line** rather than clearing everything: a shift-click that emptied the selection would
undo work rather than adjust it. ⌘G groups, ⇧⌘G ungroups, and the buttons say so, because a
shortcut nobody was told about is not a feature.

Group says *why* it cannot run — two things minimum, in the same frame — rather than greying out.
"Why is this disabled" is the question a disabled button always raises and never answers.

## What this found

Dragging the resize handle of a Text **threw**. `setLayout` refused any component without a layout,
on the grounds that layout belongs to containers — but that stopped being true when elements gained
sizes, since a Shape or a Table carries a layout to hold one. It now starts from the default layout
instead, and the test that encoded the old rule was rewritten to state the new one rather than
deleted.
