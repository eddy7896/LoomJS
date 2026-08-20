# Spec 2 — Type Registry & Live Checker (v1)

> The second of the five "next specs" (`03-system-memory.md`), gating **M3** and **M4**.
> `packages/typesys` is authoritative; this doc is its prose companion.

## Two type systems, one authority

| Layer | Job | Authority |
| ----- | --- | --------- |
| **Curated vocabulary** (`TypeRef` in `@loom/ir`) | what a designer sees on a port | the editor |
| **TypeScript** in the emitted code | what is actually true | `tsc`, always |

The canvas checker is a **fast approximation** that draws the red ring while you wire; `tsc` on the
emitted repo is the verdict (`02-system-architecture.md`). When they disagree, `tsc` wins and the
canvas rule is the bug.

## The visible vocabulary

`text`, `number`, `boolean`, `date`, `record`, `list<T>`, `optional<T>`, `enum(...)`, plus the
boundary types `trigger`, `any`, `unknown`. That is the whole surface. It is deliberately smaller
than TypeScript: one visible term per concept (`06-glossary.md`), and anything richer is routed
through the Code node rather than growing this list (guardrail 7).

## Assignability

`isAssignable(from, to)` decides whether a wire may exist. The rules, in order:

1. `unknown` accepts nothing except `unknown`; it is the *untyped boundary* marker — visible, and
   deliberately inert until narrowed.
2. `any` is assignable both ways. It exists for Code-node output and untyped npm, and it is always
   rendered as visibly untyped rather than silently permissive.
3. Identical primitives are assignable.
4. `T` is assignable to `optional<T>` — but `optional<T>` is **not** assignable to `T`. A nullable
   column reaching a required input is exactly the class of bug this catches.
5. `list<A>` accepts `list<B>` when `B` is assignable to `A` (covariant; the emitted code is
   read-mostly).
6. `enum(a|b)` is assignable to `enum(a|b|c)` (a subset of members) and to `text`, but `text` is
   not assignable to an `enum`.
7. `record` is opaque in v1 — shape checking arrives with the Supabase-typed nodes (M4).
8. `trigger` joins only `trigger`, and never carries data.

## Inference over annotation

Nodes declare port types; designers do not annotate. Types come from:

- **Component definitions** (`@loom/components`) for mirror ports.
- **Connector introspection** for DB nodes — Supabase-generated TS types are ingested and mapped
  into the vocabulary (M4, the hard part).
- **Literal inference** for static values a designer types into the inspector.
- **`any`** for a Code node's output or an untyped npm boundary, marked as such in the UI.

## The three failure surfaces

1. **Problems** — the live checker: this wire cannot exist, this required input is empty. Instant,
   graph-local, never blocks editing.
2. **Build** — the compiler refuses to emit (an incompatible wire that slipped through, a bound
   property with no source), or the emitted `tsc` fails. Carries the entity id.
3. **Runtime** — the emitted app failed while running (spec 4).

## v1 boundaries

- No generics, unions (beyond `enum`), intersections, or user-defined named types.
- No structural checking of `record` — deferred to the connector work.
- The `tsc` bridge runs over the **emitted repo**, not incrementally in the editor; the editor's
  checker stays a cheap approximation on purpose.
