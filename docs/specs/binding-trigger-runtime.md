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

## Operator steps (Math, Compare, Logic)

Three FN kinds that each compute one value. They are the glossary's **Compute** — "a single
derived value from a small expression" — split by what they operate on; flagged here as *kinds*
inside the FN family rather than new categories, because one node with twelve operators whose
result type shifts underneath you reads worse than three that each mean one thing.

- **Shape.** Each reads named fields of the record flowing through the route, computes one
  answer, and writes it back into a named field (`Write to`) — or replaces the whole value when
  no field is named. A pipeline therefore stays one value moving forward, which is what keeps a
  route body readable top to bottom, instead of a web of wires between operand ports.
- **Math**: plus, minus, times, divided by, remainder of, smaller of, larger of. Words, never
  symbols. Dividing by zero **fails with a named error** rather than writing `Infinity` into a
  numeric column, and a non-numeric operand names the fields that were not numbers.
- **Compare**: equals, does not equal, is greater than / less than / at least / at most. Equality
  compares as text so a form's `"3"` matches a column's `3`; ordering compares as numbers,
  because `"10" < "9"` is true as text and false as arithmetic. Where a **Gate** stops the
  pipeline, a Compare hands the boolean on.
- **Logic**: and, or, over two boolean fields. `not` stays on Compute, where a one-sided
  operation belongs. A checkbox counts as checked whether it arrives as `true` or as `"true"`.
- **Emission detail that is load-bearing:** the `source` local is declared only when the step
  actually reads the record. The emitted app builds with `noUnusedLocals`, so an unconditional
  declaration would turn "left blank, right a literal" into a broken build — covered by a smoke
  gate that builds a route body holding one of every operator step.

## Derived values — the browser half of the FN family

The container boundary is the network boundary, and that cuts both ways: a function node
**inside** an API route runs on the server, and one **outside** it runs in the browser. A Compute
wired from a field's mirror into a Text is a derivation of local state, and it compiles to what a
developer would write — one `const` recomputed on render. No request, no state, no effect.

- **Demand-driven**, like every other local: the compiler starts from the properties that
  actually read something and walks *backwards* along the wires. A derivation nobody binds is not
  emitted, because a dead `const` fails the emitted app's own `noUnusedLocals` build.
- **Chains** are emitted in dependency order; a cycle is a Build error naming the nodes.
- A derivation may read a **field's mirror**, **another derivation**, or an **API route's
  result** — reading a route's result marks that route's result as bound, so the state it needs
  exists.
- **Only Compute runs in the browser.** Math, Compare and Logic read named fields of a request
  body; Validate must not be bypassable; a Gate stops a request; a Code node's body may await.
  Each of those outside a route is a Build error that says which, and why.

## Triggered derivations, and Math's two environments

**Triggered vs reactive is read from the wiring on the canvas too**, exactly as it is for
pipelines. A function node outside an API route carries a `run` trigger port:

- **nothing wired to `run`** — the value recomputes as its inputs change, and compiles to a
  `const`. It simply *is* a function of its inputs.
- **a trigger wired in** — the value is held in state and only updated when that trigger fires,
  compiling to a `useState` pair plus the function the trigger calls. The last answer stays on
  screen until the next press.

Either way a bound property reads it the same way, so wiring a button in later changes when the
value updates and nothing else.

**Math resolves its operands from whatever its environment has.** On the canvas it takes 2–5
wired inputs and folds them left to right, so `a + b + c` is one node rather than a chain of two.
Inside an API route's body there are no wires between steps — a body is one value flowing through
ordered steps — so there it reads named fields of the request body from its config. Same operator
vocabulary; the Inspector shows only the fields that apply where the node actually sits.

Division on the canvas goes through an emitted `safeDivide` helper that returns `NaN` for a zero
divisor. `Infinity` is a plausible wrong number, and a plausible wrong number is worse than a
visibly wrong one — the same judgement the server-side step makes by throwing.
