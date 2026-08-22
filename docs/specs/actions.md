# Spec 7 — Action Vocabulary (v1)

> Gates P3 (`docs/10-interaction-plan.md`). Terminology follows `06-glossary.md`.

## The problem

A click can currently do exactly one thing: navigate, or fire one pipeline. Every real form needs
four — save, clear, confirm, go — and there is no way to say that. This is the single largest gap
between loom and a tool someone could ship an app with.

## The decision this spec exists to make

Bubble has roughly sixty actions. **loom has eight.** Which eight *is* the design work, and the
number is the product: a large catalogue is how a visual tool becomes a worse general-purpose
programming language (guardrail 7, `10`'s first guiding principle). A ninth needs an argument, not
a ticket.

The bar: **an action earns its place only if it cannot be said with the actions and nodes that
already exist, and it is needed by the 80% — forms, CRUD, auth, dashboards.**

## The eight

| Action | What it does | Emits |
| --- | --- | --- |
| `navigate` | Go along a flow arrow, carrying its payload. | `navigate("/notes/1")` |
| `trigger` | Run a pipeline or a derivation and wait for it. | `await run_nd_save()` |
| `setVariable` | Put a value in a variable. | `set_state_nd_done(true)` |
| `setField` | Put a value in an input. | `set_field_cp_title("")` |
| `clearField` | Return an input to its starting value. | `set_field_cp_title("")` |
| `message` | Show the person a sentence. | `showMessage({ text, tone })` |
| `openUrl` | Open an address in a new tab. | `window.open(url, "_blank", "noopener,noreferrer")` |
| `copy` | Put a value on the clipboard. | `void navigator.clipboard.writeText(...)` |

`setField` and `clearField` are separate rather than one action with an empty value, because
"clear" means *back to what it started as* — a number field returns to its initial number, not to
the empty string, and a select returns to its first option.

Auth actions arrived with **P5**, taking the catalogue to **eleven**: `signIn`, `signUp` and
`signOut` (`docs/specs/app-auth.md`). They earn their place the same way `trigger` does — nothing
already in the list can sign a person in — and they behave like it too: each is a request that can
fail, and a failure stops the sequence, so "sign in, then go to the dashboard" cannot reach the
dashboard on a wrong password.

## What was proposed and rejected

**`show` / `hide`.** The plan listed it, and it does not survive the bar. A component's visibility
is already `visibleWhen` reading a boolean (spec 6). "Show the confirmation" is `setVariable(done,
true)` plus `visibleWhen: done` — one mechanism, already built, and it composes with everything
else that produces a boolean. A second, imperative way to make a component visible would mean two
sources of truth for one question, and the canvas could not show which one won.

That is the whole discipline in miniature: the ninth action failed because the eighth plus an
existing node already said it.

## Where a sequence lives

An event property holds **an ordered list of actions**:

```ts
{ kind: 'event', handler: { kind: 'actions', actions: Action[] } }
```

A single `navigate` or `trigger` handler — everything written before this spec — is *itself* a
valid action, so an old document reads as a one-action sequence with no migration and no second
representation to maintain.

Each action may carry a **condition** (spec 6), so "navigate only if it saved" is expressible
without a branching construct:

```ts
{ kind: 'navigate', flowId: 'fl_done', when: { source: { nodeId, portId } } }
```

## Order, and what stops it

Actions run **in order, top to bottom**, in one `async` handler. A `trigger` is awaited, so
everything after it genuinely happens after it — that is the entire point of the ordered list.

**A failed pipeline stops the sequence.** "Save, then navigate" must not navigate when the save
failed; continuing would show the person a success they did not get. So `run_…` reports whether it
succeeded, and a `trigger` action that comes back false ends the handler. Bubble continues on
failure; this is a deliberate divergence, and it is the safer default.

Nothing else can fail in a way worth stopping for: setting a variable, clearing a field and opening
a tab either work or are not worth abandoning the rest for. `copy` is best-effort — a browser that
refuses clipboard access should not swallow the confirmation that follows.

## Keeping it on the canvas

loom's protection against workflow spaghetti is that behaviour is **visible and wired**, and that
protection dies the moment a sequence hides in a modal (`10`, principle 2). So:

- The sequence is edited **in the Inspector**, inline and always visible when the component is
  selected — never behind a dialog.
- A `trigger` action still draws its **wire** on the Nodes canvas. The wire is what makes "this
  button runs that pipeline" readable from across the graph; the Inspector adds the order and the
  rest of the steps.
- A component whose event holds more than one action is **marked on the canvas**, so a sequence is
  never invisible from the outside.

The wire and the action list are one fact in two views: drawing a trigger wire appends a `trigger`
action, and deleting the action removes the wire.

## How it compiles

```tsx
onClick={async () => {
  if (!(await run_nd_save())) return;
  set_field_cp_title("");
  set_field_cp_body("");
  showMessage({ text: "Saved", tone: "ok" });
  navigate("/notes");
}}
```

A handler with exactly one action and nothing to await stays the inline arrow it is today —
`onClick={() => void run_nd_save()}` — because a block around one statement is ceremony around
nothing. **A `trigger` is awaited only when something follows it**, for the same reason: the whole
point of waiting is that the next step happens afterwards, and with no next step the handler would
become `async` for nothing.

`message` emits a toast host — a context, a `useState`, a `<div>` and a timeout — **above the
router**, in `src/state/messages.tsx`. It started inside the screen's own module, and that was
wrong for the very sequence this feature exists to serve: "save, confirm, **navigate**" unmounts
the screen, and its toast with it, a frame after the confirmation appears. A message outlives the
screen that sent it, so it lives one level up, exactly like a global variable.

## Deliberately deferred

- **Named / reusable sequences.** Duplication starts the moment sequences exist, and `10` says to
  re-examine the `07` deferral here rather than assume it. The answer is *not yet*: a reusable
  sequence needs a signature, which is the reusable sub-graph problem, and it should follow the
  reusable **component** work rather than lead it.
- **Loops over a list.** The List template's implicit map covers rendering; "do this for each row"
  is a v1.5 question.
- **Custom events** (one sequence firing another). Worth having, and cheap once named sequences
  exist. Not before.
- **Scheduling / delays.** A `wait` action is the first step toward workflows nobody can reason
  about, and no form needs it.

## Invariants

- An action names an entity that exists, or the compiler refuses the build naming the component.
- The order in the document is the order in the emitted function. Always.
- A trigger wire and its `trigger` action are created and destroyed together. Drawing the wire
  **appends** a step; removing either removes only that step, never the rest of the sequence.
- A failed `trigger` ends the sequence; nothing after it runs.
- An action is added already pointing at something real. A row that says "choose a thing" is a row
  that compiles to an error, so a kind with nothing to point at is not offered at all.
