# Spec 9 — Problems (v1)

> Gates P2 (`docs/10-interaction-plan.md`). Terminology follows `06-glossary.md`. Numbered 9
> because 7 (action vocabulary) and 8 (lineage) are reserved for P3 and P6.

## The problem

`02-system-architecture.md` promises three error tiers, and two of them have nowhere to live.
A refused wire flashes a toast that is gone before it is read. A Build error appears in the
Preview, one at a time, and only for the failure the compiler happened to reach first. Everything
else — an empty input, a variable nothing writes, a binding to a node that was deleted — is
silently invisible until it becomes a Build error, or worse, never does.

The panel is the home for the first tier: **a live list of everything currently wrong.**

## What a problem is

```ts
{
  id: string;                  // stable across edits, so rows do not flicker
  severity: 'error' | 'warning';
  code: string;                // 'unwired-input', 'dangling-binding', …
  message: string;             // the sentence a designer reads
  entityId?: Id;               // what to select when the row is clicked
  entityKind?: 'component' | 'node' | 'artboard';
  artboardId?: Id;             // which screen to switch to first
}
```

`id` is derived from the code and the entity, never from position in the list. A row keeps its
identity while the graph around it changes, which is what lets the panel stay still while someone
works.

## Standing problems, not events

The panel holds **state, not history.** A wire refused at the gesture left nothing wrong behind —
the wire was never created — so it stays a toast and never becomes a row. What earns a row is
something the document currently says that a person would call a mistake.

That distinction is the whole design. A panel that accumulated events would need clearing, and a
list you have to clear is a list nobody trusts.

## Why the compiler cannot be the only source

The plan's instinct was that the compiler already raises every one of these, so the panel merely
collects them. That is half true, and the other half matters:

1. **The compiler stops at the first failure.** It raises to refuse a build, not to survey. One
   `CompileError` per compile is one row, however much else is wrong.
2. **Emission is demand-driven.** A Math node nothing reads is not compiled at all, so its empty
   input port raises nothing — it is dead code, and dropping it is correct. But a half-wired node
   on the canvas is exactly what a designer wants pointed out, precisely *because* they have not
   finished wiring it to anything yet.

So problems come from two passes that meet in the panel:

- **Structural** — a walk of the document that finds every instance of each fault, whether or not
  the compiler would ever reach it. These restate rules the compiler already enforces; the
  messages are deliberately the same sentences, so the panel and the Build error never disagree.
- **Build** — one row, from actually compiling. Added only when no structural row already names
  the same entity, because the same fault reported twice reads as two faults.

The panel does not compile for itself. Emission is not cheap, and running it a second time on the
render path — once per keystroke, for one row the Preview is already holding — is a cost with
nothing behind it. `diagnose` therefore takes the verdict as an option, and the studio passes what
the Preview worked out. Three states, not two: a failure, `null` for a clean compile, and
*nothing yet* while the first compile is in flight or the Preview is closed.

## The checks

**Errors** — a true break; the project will not build, or is lying about what it does.

| Code | What it catches |
| --- | --- |
| `dangling-binding` | A property reads a node or port that no longer exists. |
| `dangling-condition` | A condition reads a node or port that no longer exists. |
| `dangling-trigger` | A button fires a node that no longer exists. |
| `dangling-flow` | A button navigates along an arrow that has been removed. |
| `unwired-input` | A function node on the canvas has an input port with nothing wired in. |
| `variable-never-written` | A variable nothing sets, so it can never hold anything. |
| `reactive-writer` | A node sets a variable but nothing triggers it, so writers would race. |
| `build` | Whatever the compiler refused, with the entity it named. |

**Warnings** — muted, because this is what half-finished work looks like and shouting at it is
worse than saying nothing (`02`: "muted for work-in-progress, sharp red for true breaks").

| Code | What it catches |
| --- | --- |
| `unread-result` | Nothing shows or keeps what a node works out. |
| `orphan-node` | A node with no wires at all. |

A node inside an API route's body is exempt from `unwired-input`: its operands are named fields of
the request, chosen in the inspector, not wires.

There is deliberately **no check for an arrow pointing at a deleted screen.** `addFlow` refuses an
unknown destination and `removeArtboard` takes every flow touching it, so the IR holds that
invariant itself; a row for it could never appear. What *is* reachable is a button still
navigating along a flow that `removeFlow` took, because removing a flow does not scrub the
handlers pointing at it — so that is the check that exists.

A node is "in use" if a wire **or a property** points at it. A variable is normally read by a
binding rather than a wire, so counting only wires would report the most-used node on the screen
as an orphan.

## Clicking a row

Selecting the entity is the entire interaction. A row for a component switches to Design mode and
selects it; a row for a node switches to Nodes mode and selects it; either first switches to the
screen that owns it. Nothing is auto-fixed — a panel that edits the document on click would be
guessing at intent, and the fix for "nothing is wired into input 2" is a decision, not a default.

## Deliberately deferred

- **Blocking Deploy on outstanding problems.** Bubble refuses to deploy with issues open, and it
  is the right end state, but Deploy does not exist yet (M6). The open decision is recorded in
  `10-interaction-plan.md` rather than settled here.
- **The Runtime tier.** Mapping a runtime failure back to the wire that carried the bad value is
  P6, and it needs the lineage spec first.
- **Quick fixes.** "Wire this for me" needs a notion of the *obvious* candidate, which is inference
  (M5) pointed at a new problem. Worth doing, later.
- **Suppressing a warning.** Until there is evidence a specific warning nags, a mute switch is a
  setting nobody asked for.

## Invariants

- A problem names an entity that exists, or names none at all — never a dangling id.
- The structural pass never throws. It runs on every keystroke, on documents mid-edit, and a
  crash there would take the editor down with it.
- Structural messages match the compiler's wording for the same fault.
- Severity is a property of the fault, not of how many there are.
