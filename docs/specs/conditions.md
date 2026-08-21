# Spec 6 — Conditions (v1)

> Gates P1 (`docs/10-interaction-plan.md`). Terminology follows `06-glossary.md`.

## The problem

Every component drawn today always renders. There is no empty state, no error message, no
signed-in-only panel — and no way to make a surface change with what is happening. Conditions are
the smallest thing that fixes all of that.

## What a condition is

**A reference to a boolean somewhere on this screen, optionally inverted.**

```ts
{ source: { nodeId, portId }, test?: 'is' | 'not' }
```

That is the entire model, and the smallness is the point. A condition is *not* an expression
language: there is no `and`, no comparison, no chained operators inside a property. Composition
happens where composition already lives — in **Compare**, **Logic** and **Compute** nodes on the
canvas, which produce a boolean that a condition then reads. Putting a second expression language
in the inspector is how a domain-specific tool becomes a general-purpose one (guardrail 7), and it
would be invisible on the canvas besides.

## What it may read

The same resolution a bound property uses, so there is one set of rules to learn:

| Source | Example |
| --- | --- |
| A **checkbox's mirror** | "show the address block when *Ship elsewhere* is ticked" |
| A **derivation's result** (Compare / Logic / Compute) | "show the empty state when *count is 0*" |
| An **API route's `pending`** | "show the spinner while it runs" |
| A **screen bucket** | "show the confirmation once a row came back" |

A source that produces something other than a boolean is read through the same truthiness rule the
emitted code uses everywhere: `true` or the string `"true"` is on, anything else is off. That
matters because a form field arrives as a string and a checkbox arrives as a boolean, and both mean
checked.

Reading a component on **another screen** is refused: its state only exists where it is rendered.

## Where a condition can be attached

1. **`visibleWhen`** on any component. False means the element is not rendered at all — not hidden
   with CSS. A hidden element that still occupies layout, still receives focus and still ships its
   contents to the browser is a bug waiting to be filed, and for an auth-gated panel it is a leak.
2. **Conditional style** — an ordered list of `{ when, style }` overrides on a component. Each one
   whose condition holds is merged over the base style, **in order**, so two conditions can set two
   different properties without fighting. Same token scale as the base style; no new vocabulary.

## How it compiles

Visibility wraps the element, so the whole subtree disappears with it:

```tsx
{isOn(field_cp_ship) ? (
  <div style={{ ... }}>…</div>
) : null}
```

Conditional style spreads over the base, in order:

```tsx
style={{ ...base, ...(isOn(derived_nd_cmp) ? { background: "var(--loom-color-brand-tint)" } : {}) }}
```

`isOn` is a three-line helper emitted into the module when something uses it. No runtime library,
no CSS classes to keep in step, nothing a developer reading the output would not have written.

## Deliberately deferred

- **Conditions on properties** ("this text says X when Y"). A Compute or a Gate already produces
  the value; a bound property reads it. Adding a third way would be three ways to say one thing.
- **Previewing a condition's effect on the canvas.** The canvas has no runtime values, so it draws
  every component and marks the conditional ones. The Preview is where conditions actually run.
  A "simulate this condition" toggle is a real idea, and a later one.
- **Transitions.** Elements appear and disappear; animating that is the motion layer's problem.

## Invariants

- A condition reading a node that produces no value on this screen is a **Build error naming the
  component** — the same tier and the same phrasing as a dangling binding.
- Visibility removes the element from the tree; it never sets `display: none`.
- Conditional style may only reference tokens the design system defines, exactly like base style.
