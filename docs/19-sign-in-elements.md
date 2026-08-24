# 19 — Sign-in elements

> An OAuth button you drag onto the screen. Companion to `17-sso.md` (what happens when it is
> pressed) and `11-editor-shell.md` (the palette it comes from).

## The section

The element palette has a **Sign in** section: one entry per provider — Google, Apple, GitHub and
the rest of the list in `17-sso.md`. Placing one puts a Button on the screen that already carries
its label and its action, because "a button that signs in with Google" is the thing being asked
for. Placing a blank Button and then wiring an action to it is the same thing done in four steps.

**It is an ordinary Button.** No new component type, no marker only the palette understands, and
nothing about it is locked: rename it, restyle it, change the provider from the action list, or
delete the action and keep the button. The vocabulary did not grow to make this possible — that
is the bar anything entering the palette has to clear (`11-editor-shell.md`).

The section says what these need before anyone places three of them: signing people in requires a
Supabase connection, and finding that out from Problems afterwards is finding out late.

## Dragging

Clicking an element drops it wherever the selection happens to be. That is right for the first
element on a screen and wrong for the fourth, so palette entries can now be **dragged onto the
artboard** — the gesture a designer already has in their hands from every other tool.

Every component entry drags, not only the sign-in ones: the mechanism is the same, and a palette
where only some items dragged would be a palette you have to learn.

The drop lands through the same `resolveDropTarget` that a drawn element and a reordered layer
use. There is one idea of where a point is in the tree, and this is not a second one — inside a
free frame the drop point becomes the child's own place, and inside a stacked frame it decides
only which slot it lands in. The same insertion line is drawn either way.

A drag carries a loom-specific payload, so a file or a text selection dragged into the canvas is
left to the browser rather than mistaken for an element.

## What the tests cover

The end-to-end specs dispatch the drag events explicitly rather than driving a pointer and letting
the browser synthesise them: `dragTo` is occasionally a frame short and drops nothing, which makes
a real behaviour look broken at random. The dispatched events carry the same `dataTransfer` and
the target's real coordinates — which the drop reads to work out where it landed, and which a
dispatched event otherwise leaves at the origin, off every screen.
