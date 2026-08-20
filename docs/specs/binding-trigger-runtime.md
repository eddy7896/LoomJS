# Spec 4 — Binding & Trigger Runtime (v1)

> The fourth of the five "next specs" (`03-system-memory.md`), gating **M3**. It answers the two
> questions the Nodes mode raises: *how does a bound property get its data*, and *what makes a
> pipeline run*. `packages/compiler/src/emit/pipeline.ts` is authoritative; this doc is its prose
> companion.

## The two modes

| Mode | Starts when | Example |
| ---- | ----------- | ------- |
| **Triggered** | a trigger port fires (a Button's `onClick`) | submit a form, call an action |
| **Reactive** | the screen mounts, and again whenever an input changes | load a list, show a total |

A pipeline's mode is not configured — it is *derived*. A chain whose head has a trigger port wired
into it is triggered; a chain with no trigger source is reactive. One less thing to get wrong, and
it matches how the graph reads.

## Anatomy

```
[Button.onClick] --trigger--> [API route: createNote] --data--> [Text.content]
                                        ^
                              [TextField.value] --data--+
```

- **Ports** are typed and directional (`in`/`out`), and carry either `data` or `trigger`
  (`06-glossary.md`). A wire may only join `out -> in` of the *same* port kind, and the types must
  be assignable (`@loom/typesys`, spec 2). The compiler refuses anything else — a bad wire is a
  Build error with the wire's id, not a runtime surprise.
- **UI mirror nodes** are how a component appears in Nodes mode: a mirror exposes the component's
  event as a trigger out-port and its editable values as data out-ports. The component still lives
  on the artboard — the mirror is a view of it, never a second copy (guardrail 13).
- A **bound property** (`PropertyValue.kind === 'bound'`) points at a node's output port. That is
  the only way data crosses from Nodes mode into Design mode.

## What the compiler emits

For each artboard, the compiler walks the pipelines that touch it and emits, inside that
artboard's module:

1. **One state variable per node output that something binds to**, plus its loading and error
   state. React `useState` — no store, no library.
2. **A run function per pipeline**: reads the inputs, calls the server, writes the state.
3. **The wiring**: a triggered pipeline's run function is the component's event handler; a
   reactive pipeline's runs in a `useEffect` keyed on its inputs.
4. **Nothing for an unbound output.** A node whose result nobody reads emits no state.

A bound property therefore compiles to a plain variable read. There is no interpreter, no
subscription graph, no runtime library shipped with the app — the generated code is what a
developer would have written (`02-system-architecture.md`).

## Server vs client, and the wall between them

An **API route node** is a container: the function nodes inside it run **on the server**, in the
emitted Vercel function. Everything outside it runs in the browser. The container boundary *is*
the network boundary — that is the whole reason it is a container rather than a flat graph
(`03` open decision 3, resolved here).

Consequences the compiler enforces:

- A wire that crosses into an API node's body becomes part of the **request payload**; a wire out
  of it is part of the **response**. Both are typed.
- Credentials live in the env bucket and are readable **only** inside the server body. A wire from
  an env value to anything client-side is refused at compile time (guardrails 1–4). This is a
  build-time gate, not a review step.

## Failure

Every pipeline emits an error path: a failed call sets the pipeline's error state rather than
throwing into the render tree. In the studio, that surfaces as the **Runtime** tier of the error
model (`02`) — the graph-aware console maps a failure back to the node that produced it. Runtime
error *boundaries* in the generated app are explicitly out of scope for V1 (`07`).

## v1 boundaries

- One trigger source per pipeline; fan-in of triggers is v2.
- No queueing, retries, debouncing, or optimistic updates.
- No cross-artboard pipelines: a pipeline belongs to the artboard whose components it touches.
- Reactive pipelines re-run on input change only — no polling, no subscriptions (Supabase realtime
  is not V1).

## M5 addition — the screen bucket

A pipeline's result is gone the moment the call returns unless something holds it. A **State**
node (`state:write`, scope `screen`) is that something: wire an API route's `result` into its
`set` port, and anything on the artboard may bind its `value`.

- It compiles to a `useState` pair in the artboard module, and `set_…(body.result)` in the same
  success path as the fetch. **No second round trip, no store, no runtime library.**
- It is **demand-driven** like `pending` and `error`: a bucket nothing binds emits no variable,
  because the emitted app is built with `noUnusedLocals` and dead state would fail its own build.
- It runs in the **browser**. Inside an API route's body it would vanish when the response was
  sent, so the compiler refuses that placement rather than emitting a lie.
- A bound value is not always text — a bucket often holds the row an insert returned. The Text
  template asks the compiler for the bound type and routes anything non-text through a small
  `asText` helper, because an object dropped into JSX as a child crashes React at runtime.

## The expression vocabulary (typed inputs, booleans, Gate)

- **Inputs carry their own type.** A number field's state is a `number`, a checkbox's is a
  `boolean`, a select's is `text`. The value keeps that type from the input, along the wire,
  through Validate's coercion, into the column — nothing downstream has to guess what a string
  meant. An empty number box reads as `0`, never `NaN`: `NaN` would land as `null`, which is a
  different fact from "left empty".
- **Gate is the conditional, and the only control-flow node** (`docs/06-glossary.md`). It tests
  one condition on a field of the value flowing through it; when the condition does not hold the
  pipeline **stops** and the Gate's message is the failure the caller sees. It runs on the server
  for the same reason validation does — a check the browser can skip is not a check.
- **Deferred: Gate's two branch edges.** The glossary describes true/false output wires; V1 emits
  the stop-on-false shape only. A route body is an ordered pipeline, and a second branch means a
  second body — real work with no demand behind it yet. Everything a form needs ("only insert when
  the box is ticked") is the shape that shipped.
- **There is no loop node, and there will not be one.** A list is narrowed by the *query* (sort,
  limit) and rendered by the List component's implicit map, one row at a time. Iteration that
  those two cannot express belongs in a Code node (guardrail 7).
