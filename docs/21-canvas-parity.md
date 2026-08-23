# 21 — What the canvas draws

> Every element the palette offers, visible on the artboard. Companion to `12-canvas.md` (the
> surface) and `02-system-architecture.md` (compile = stitch templates).

## Two renderers, one vocabulary

The compiler emits JSX for the app. The canvas draws React for the editor. They are separate
programs reading the same document, and that is a deliberate trade — the canvas has no data, no
router and no server, so it cannot run what ships.

The cost is drift. A type added to one and forgotten in the other looks, to a designer, like an
element that lands as **an empty box**: placed, named, selectable, invisible. Nine were in that
state — List, Table, Image, Link, Icon, Multiline field, Radio buttons, Date field and Slider —
which is most of what had been added since the canvas renderer was written.

## What each one draws now

Each element draws the control a person will actually meet, read-only, because a designer judging
spacing needs to see the box someone will type into:

| Element         | On the canvas                                                        |
| --------------- | -------------------------------------------------------------------- |
| Multiline field | a real `textarea`, at its configured row count                        |
| Date field      | `input type="date"`                                                    |
| Slider          | `input type="range"`, with its own min, max and step                   |
| Radio buttons   | a `fieldset` with its `legend` and one radio per option                |
| Link            | an `a` with its label, **not armed** — following it would leave the editor |
| Icon            | the same inline SVG path the app renders                               |
| Image           | the picture, or a labelled place for one when it has no address yet    |
| Table           | a real table: the named columns as headers, over two ruled ghost rows  |

Two of those deserve their reason written down.

**An Image with no address is a place, not a broken icon.** An empty `img` draws as a broken
thumbnail or as nothing, and a designer arranging a page needs to see the box it will occupy.

**A Table's rows are ghosts.** The canvas has no data. Drawing plausible values would be a
screenshot of an app that does not exist, so the cells are dashes — but the *columns* are the ones
that will ship, because those come from the document. With no columns named, it says where they
will come from: the app works them out from the first row it receives.

## A List draws what a List renders

A List renders its **first child** once per row and nothing else — that is the implicit map, and
there is no loop node. The canvas drew every child, so a List with three things in it looked like
three things and shipped as one.

Now the first child is drawn as the row it is, and anything after it is drawn **dimmed and
labelled**: still there, still selectable, still movable out. Hiding them would be worse — a
designer cannot fix what they cannot see.

## Values that only exist at run time

A property can hold something the canvas cannot know: a route parameter, a binding to a node, or a
field of the current row inside a List. Those are drawn as their **source** — `{title}`, `{id}`,
`(bound)` — never as an invented value.

`item` was missing from that list, which is why a Text inside a List drew as nothing: the most
common thing anyone puts in a List, invisible. A static value that was not a string went the same
way, so a `0` or a `false` drew as an empty box too.

## The guard

Two tests, because they catch different failures.

The unit test walks **the whole vocabulary** — `componentDefs()`, not a list someone maintains —
and fails any leaf that draws as a bare empty div. A new element nobody taught the canvas about
fails on the day it is added.

The end-to-end test places every element in a real browser and checks it has a bounding box *and*
is either a control in its own right or has something inside it. Size alone was not enough: the
bug drew an empty div with a minimum height, which has a perfectly good bounding box and nothing
in it. Reverting the fix and running that spec reports all nine failures by name, which is how the
guard was checked rather than assumed.
