# 03 — System Memory (Decision Log)

> This is the project's persistent memory. **Read before proposing anything that feels
> already-decided.** Each entry records the decision *and the reasoning*, so trade-offs
> aren't re-argued. "Deferred" means *chosen out with a reason*, not forgotten.

## Format

`[STATUS] Decision — Reasoning. (Reversibility / cost note where relevant.)`
STATUS ∈ SETTLED · DEFERRED · OPEN.

## Identity & scope

- **[SETTLED] loomJS is a domain-specific VPL for data-driven web apps, not general-purpose.**
  General-purpose visual programming becomes unreadable past a threshold (Blueprints/Node-RED
  graveyard). The Code node absorbs the arbitrary 20%. This is a *policy*, not just a feature.
- **[SETTLED] BYO-backend.** loom owns building; user owns app infra (their Supabase/Vercel).
  Offloads data liability, matches OSS future, makes "you own it" literal. Trade: onboarding
  UX becomes the hard problem.
- **[SETTLED] Compile = generate a real, owned repo.** Reversibility + lineage is the trust
  model; never a locked-in runtime, never hide the code.
- **[SETTLED] Fintrack is a sample, not the spec.** Don't encode finance assumptions.

## Stack

- **[SETTLED] Frontend target: Vite + React + TypeScript SPA + react-router.** Simplest to
  emit; avoids teaching the graph Next.js/RSC server/client boundaries.
- **[SETTLED] Backend target: Vercel serverless functions (`/api`).** One place for logic
  (not scattered into Supabase edge functions). API node = one real endpoint.
- **[SETTLED] Database/auth: user's own Supabase (Postgres, relational).** Supabase supplies
  auth + RLS + TS type generation → flagship V1 connector.
- **[SETTLED] Deploy: Vercel managed (V1).** No Docker in V1.
- **[SETTLED] Project storage: Cloudflare R2 for graph snapshots + assets; Postgres for
  metadata + pointer.** R2 = zero egress (read-heavy), S3-compatible, versioning-ready.
- **[SETTLED] TypeScript is a hard, non-optional dependency** of generated apps and Code nodes.
  Gains a full type system + `tsc` checker for free. No plain-JS output, ever.

## Core mechanics

- **[SETTLED] Component = property-schema instance; inspector = schema renderer.** One system
  for native + imported components (no origin-based special-casing).
- **[SETTLED] Property value kinds: static / bound / event.** `bound` is the Design↔Nodes seam.
- **[SETTLED] Every UI component gets a mirror node; data-props → data ports, events → trigger
  ports; inputs bidirectional; frames aggregate children into a composed object port.**
- **[SETTLED] Two pipeline trigger modes: triggered + reactive.** Required for dashboards
  (reactive) and forms/search (triggered) to coexist. Mode inferable from event-wire presence.
- **[SETTLED] Ownership discipline: artboard owns existence/appearance; Nodes mode owns
  behavior.** Prevents two-canvas confusion.
- **[SETTLED] Connectors are modules that are node factories; introspection generates typed
  per-table nodes.** "Access all data" falls out of introspection.
- **[SETTLED] Module = definition (manifest + adapter) vs instance (configured/wired).**
  Same class/instance pattern as component type/instance, managed/ejected.
- **[SETTLED] Type layer = adopt TS + ingest Supabase-generated types; curated visible
  vocabulary; inference over annotation; `tsc` authoritative.**
- **[SETTLED] Three state buckets: screen / global(app) / env(secrets, server-only).**
- **[SETTLED] Flow arrows are the router; can carry a payload; destination declares input
  params.** → dynamic routes, master→detail.
- **[SETTLED] Errors in three timing tiers: Problems(live) / Build(compile) / Runtime(preview,
  graph-aware).** Linting rides in the live tier.
- **[SETTLED] Layout is flex-first, never absolute; tablet-and-up; graceful sub-768px guard.**
  Absolute output is the irreversible design-tool trap.
- **[SETTLED] Reusable UI components in V1; reusable sub-graphs (custom nodes / user functions)
  fast-follow (v1.5).**

## Credentials, security, OAuth

- **[SETTLED] Secrets are server-only, in an encrypted env bucket, referenced by name; never in
  the snapshot/R2/repo/client.** Compiler refuses to wire env → client node. Anon key =
  client-safe; service key = env.
- **[SETTLED] Two Supabases, never blurred: platform vs. connected.** Two auth systems: platform
  auth vs. generated-app auth.
- **[SETTLED] Credential store is source-agnostic; acquisition is pluggable (`manual` now,
  `oauth` later).** Makes the OAuth upgrade additive.
- **[SETTLED] OAuth plan: authorization + retrieval for both Supabase & Vercel; provisioning +
  deploy for Vercel; Supabase provisioning deferred.** Never make launch depend on partner
  approval — manual-with-validation ships first and is the permanent OSS/fallback path.

## Platform

- **[SETTLED] Platform built on Supabase; data model = User/Workspace/Project/Membership.**
- **[SETTLED] Design as if teams exist, ship single-workspace in V1.** Cheap hygiene to keep
  collaboration door open (mirrors the multiplayer deferral logic).
- **[SETTLED] Closed beta with gated signup (invite codes/allowlist).**

## Deferred (v2+ — chosen out, with reason)

- **[DEFERRED] Live multiplayer / CRDT-OT co-editing → Git-style async branch/merge.** Worthless
  before the compiler works; forces a distributed foundation before the model stabilizes. Keep
  the doc branch-ready now (stable ids + atomic ops) so re-adding is cheap, NOT a rewrite.
- **[DEFERRED] Snapshot version history / content-addressed store / branch / merge / visual
  diff.** V1 may overwrite one R2 key per project; upgrade is additive.
- **[DEFERRED] Next.js / RSC frontend target.** Adds server/client-boundary modeling weight.
- **[DEFERRED] Firebase (NoSQL) connector.** Document model warps the relational DB node; a
  second, differently-shaped node. Relational (Supabase) first.
- **[DEFERRED] Docker / container deploy (Cloud Run, Render, Fly, self-host).** Different adapter
  class from Vercel-managed.
- **[DEFERRED] Custom CI/CD engine.** Emit a GitHub Actions workflow / use Vercel git-deploy;
  don't build a pipeline engine.
- **[DEFERRED] Public module/plugin marketplace.** Dogfood first-party connectors on the same
  API first; open authoring later.
- **[DEFERRED] React Native / mobile.** Different rendering primitives (no DOM/CSS); IR spine
  makes it addable later without rewrite.
- **[DEFERRED] Non-React frameworks (Vue/Svelte).** Second component model = different product.
- **[DEFERRED] Responsive breakpoints (mobile/tablet/desktop distinct layouts).** Flex-first
  makes this additive later.
- **[DEFERRED] `.d.ts`-based assisted node scaffolder (human-in-loop).** Only for well-typed
  packages; v2 authoring accelerator, never "search-and-appears."
- **[DEFERRED] Runtime error boundaries in generated apps, testing/test-emission, schema
  migrations/evolution, app-shell/nested layouts, role-based access in generated apps.**
- **[DEFERRED] Supabase auto-provisioning (create project for user).** Billing/region/data
  implications; users create their own project deliberately.

## Open (needs a decision before/at build)

- **[OPEN] Preview database strategy:** dev branch/seeded project vs. writing to the connected
  Supabase (warn user). Clean answer = connector holds a dev + prod connection. Decide before
  Preview is real. *(Still open as of M4: the Preview writes to whatever project is connected.)*
- **[SETTLED — M3] Route/API node is a container.** The nodes inside its body run on the server;
  everything outside runs in the browser. The container boundary *is* the network boundary, which
  is also the line a server-only credential may not cross. See
  `specs/binding-trigger-runtime.md`.
- **[SETTLED — M0-M4] The five named specs are written**: `specs/snapshot-schema.md`,
  `specs/type-registry.md`, `specs/connector-credentials.md`,
  `specs/binding-trigger-runtime.md`, `specs/layout-model.md`.

## Implementation decisions taken while building M0-M5

Recorded here because they constrain everything downstream. Each was taken at the phase named.

- **[M1] Preview run model: a child Vite dev server** serving the emitted app in an iframe. The
  studio compiles *in the browser* and posts the emitted files to the dev server, which only
  writes them — a Build error then surfaces against the offending node with no round trip.
- **[M2] Routes are derived, never authored.** Each artboard is a route, the entry artboard is
  `/`, and an artboard that declares params gets a dynamic path. A flow arrow carrying an empty
  value is a Build error, not an empty URL segment.
- **[M3] Pipeline state is demand-driven.** An output nobody binds emits no variable — the
  emitted app builds with `noUnusedLocals`, so dead state would fail its own `tsc`.
- **[M4] Introspection reads the PostgREST OpenAPI document** at `{project}/rest/v1/`, not the
  Management API. Every project serves it, it needs only a URL and a key the designer already
  has, and it keeps manual-connection-with-validation as the baseline that `04` demands. The
  parser is defensive: an unrecognised column type becomes `unknown`, never a guess. Ingesting
  `supabase gen types` output stays a later accelerator, not the spine.
- **[M4] Emitted server code uses `@supabase/postgrest-js`, not `@supabase/supabase-js`.**
  The umbrella package builds a realtime client on import, which needs Node 22's native
  WebSocket and is dead weight in a stateless function. Same query API; one fewer reason for a
  generated app to break on a runtime it did not choose.
- **[M4] Introspected schema is cached in the document**, because table and column names are not
  secret. That is what lets the compiler and the canvas type ports offline.
- **[M5] AUTO is provenance, not a mode.** An inferred pipeline is ordinary nodes carrying a mark;
  the compiler emits it identically whether it is proposed, accepted, or detached. The mark exists
  for the canvas and for regeneration, and **Detach simply deletes it** — an unmarked node is one
  the designer owns. See `specs/snapshot-schema.md` §M5.
- **[M5] The whole proposal is one unit.** Accept/Detach/regenerate operate on a group id shared
  by every node and wire from one inference run, and generating is a single undo step. A pipeline
  half-owned by loom and half by the designer would be unreadable.
- **[M5] Inference matches by name and refuses to guess.** A form's fields are matched to columns
  by normalised name; a table is only proposed if the form covers **every required column**; two
  buttons means no proposal, because which one submits is not loom's call. Every refusal carries
  the sentence the designer sees.
- **[M5] Inference never creates UI.** It reads the artboard and writes only behaviour, so the
  ownership discipline holds (guardrail 13): mirrors it materialises are views of existing
  components and are deliberately *not* marked AUTO.
- **[M5, correcting M4] Schema introspection runs on the dev server, not in the browser.** A
  hosted Supabase project serves its PostgREST OpenAPI document only to the `service_role` key
  ("Only the `service_role` API key can be used for this endpoint"), and that key may never enter
  a browser. The studio tries the call directly — a self-hosted project or a stub answers the anon
  key — and on a 401/403 relays it through `POST /__loom/introspect`, which uses the key the dev
  server holds and returns **only the document**. Verified against a real project; the anon key
  alone cannot read it. On the platform (M6) the same relay is a server route.
- **[M5] Validation runs on the server**, inside the route's body, because that is the only place
  it cannot be bypassed. It also coerces — an `<input>` yields strings and a number column will
  not take one — and omits an empty optional column rather than writing an empty string.

- **[M5.1] The expression vocabulary is typed at the input.** NumberField, Checkbox and Select
  join TextField; each holds its own type in state rather than a string everything downstream has
  to parse. Select's port stays `text` — typing it as an `enum` of its options needs the mirror to
  read the component's config, which is a wider change than the vocabulary needed.
- **[M5.1] Gate ships as stop-on-false, not as two branch edges.** One condition, and the request
  ends with the Gate's message when it does not hold. Branching needs a second body inside the
  container; the deferral is recorded in `specs/binding-trigger-runtime.md` rather than implied.
- **[M5.1] "Loops" are answered by the query and the implicit map, deliberately.** A read carries
  sort and limit; a List renders one row at a time. No loop node — that is the general-purpose VPL
  graveyard (`04-hallucination-check.md`), and the arbitrary case is the Code node.

- **[M5.1] Operator nodes carry their operands in config, not on extra ports.** Math, Compare and
  Logic read named fields of the record flowing through and write the answer into a named field.
  A route body is an ordered pipeline of one value; giving each operator two data-input ports
  would turn a readable column of steps into a web of wires for no gain. Flagged as *kinds* of
  the glossary's Compute rather than new node categories.
- **[M5.1] Arithmetic fails loudly.** Divide by zero and non-numeric operands raise named errors
  instead of writing `Infinity` or `NaN` into a column — a plausible wrong number is worse than a
  stopped request.

- **[M5.1] A function node outside an API route runs in the browser.** The container boundary is
  the network boundary in both directions, so a Compute wired from a field into a Text compiles to
  one `const` — no request, no state. Only Compute qualifies: the record-shaped steps, Validate,
  Gate and Code each belong inside a route, and each says so by name when placed outside one.

- **[M5.1] Canvas derivations follow the same triggered/reactive rule as pipelines.** A `run`
  port left unwired means the value recomputes with its inputs (a `const`); a trigger wired in
  means it is held in state until fired. Read from the wiring, never configured.
- **[M5.1] Math takes wired operands on the canvas and config fields inside a route body.** Two
  environments, one operator vocabulary: a canvas has wires, a route body has one value flowing
  through ordered steps. The Inspector shows only the fields that apply where the node sits.

- **[M5.2] Style is token-first, and `@loom/ui` finally exists.** A styled property stores a token
  id and emits `var(--loom-…)`; the project's overrides become the app's `:root`. That is the
  difference between a design system and a pile of hex codes, and it is what makes "change the
  brand" one edit rather than a search-and-replace.
- **[M5.2] The canvas defines the same custom properties the emitted app does.** Design mode
  renders real DOM, so without the variables it would draw unstyled boxes and quietly disagree
  with the Preview. Both now resolve one source.
- **[M5.2] The studio's own chrome is on loom's brand at last**, and the node hues match
  `docs/Design System/DesignDoc.html` (FN was rendering orange rather than `#EC3013`). Selection
  chrome is deliberately ink, not brand: red is reserved for the primary action and the FN
  category.

- **[P0] The document persists, behind a storage interface.** Autosave is `serializeSnapshot` on
  a debounce, so the save format's validation runs on the way out and a document that could not be
  reloaded can never be written. Local storage today; the platform's R2-blob-then-Postgres-pointer
  order (`02`) swaps in without touching the editor.
- **[P0] A document this build cannot read is refused, never half-loaded.** The schema version is
  checked before parsing so the refusal names both numbers, and the saved document is left alone.
  A designer editing the remains of a partial load is worse than one starting fresh.
- **[P0] Opening a document starts history empty.** Undo must not walk back into a session the
  designer was not part of.

- **[P1] A condition is a reference to a boolean, not an expression.** Composition happens in
  Compare, Logic and Compute nodes on the canvas; the inspector only *points at* the result. A
  second expression language in a property is how a domain-specific tool becomes a general-purpose
  one, and it would be invisible on the canvas besides. See `specs/conditions.md`.
- **[P1] Invisible means not rendered.** `visibleWhen` removes the element from the tree rather
  than setting `display: none` — a hidden element that still occupies layout, still takes focus and
  still ships its contents is a bug waiting to be filed, and for an auth-gated panel it is a leak.
- **[P1] The condition picker materialises what it offers.** A checkbox can be conditioned on the
  moment it is drawn; its mirror is created when the condition is picked. Requiring a trip to Nodes
  mode to wire a box to nothing first would be a rule nobody could guess.
- **[P1] The canvas marks conditional components rather than hiding them.** Design mode has no
  runtime values, so it draws everything and outlines what is conditional; the Preview is where
  conditions actually run. Simulating a condition on the canvas is a later idea, deliberately.
- **[P1.1] A screen bucket is the merge point: many writers, one reader, last write wins.** Found
  by building a calculator in the studio — two number fields, four operation buttons, and one Text
  per operation because every property binds exactly one port. The bucket already existed for
  pipeline results; opening it to browser-side function nodes is what makes "four operations, one
  answer" sayable. See `specs/binding-trigger-runtime.md`.
- **[P1.1] A bucket write is always triggered.** A reactive writer runs on every render, so two of
  them race on each keystroke and the bucket holds whichever React evaluated last — a value nobody
  can predict from the canvas. Refusing it at compile time is what keeps "last write wins" a rule
  a person can reason about, rather than a race.
- **[P1.1] `set` is the one fan-in port in the language.** Every other input port takes a single
  value and rewiring replaces it, which is what makes a graph readable: follow the wire back and
  there is exactly one answer. The editor enforces the same exception it compiles, because
  replacing on each wire would silently unwire the operation drawn before.
- **[P1.1] A trigger whose result nothing consumes is a Build error, not dead code.** Demand-driven
  emission had been dropping the derivation and leaving the button's handler pointing at nothing;
  the message now names the real fix — bind the result, or wire it into a bucket — instead of
  reporting a routing problem the reader does not have.
- **[P2] The Problems panel holds state, not history.** A wire refused at the gesture left nothing
  wrong behind, so it stays a toast and never becomes a row. Only what the document *currently*
  says earns a row — which is what lets the list never need clearing, and a list you have to clear
  is a list nobody trusts. See `specs/problems.md`.
- **[P2] The compiler cannot be the only source of problems.** It stops at the first failure
  because its job is to refuse a build rather than survey one, and emission is demand-driven, so a
  half-wired node nothing reads is never compiled at all. A structural walk finds every instance;
  the compiler contributes one row. Structural messages reuse the compiler's own sentences so the
  two can never disagree.
- **[P2] One compile per keystroke, shared.** The panel takes the Build verdict as an argument
  rather than compiling for itself. Found while building: `diagnose` ran a full codegen inside a
  `useMemo`, duplicating the Preview's.
- **[P2] Nothing is auto-fixed on click.** A row selects its entity and stops there. A panel that
  edited the document on click would be guessing at intent, and the fix for "nothing is wired into
  input 2" is a decision, not a default.
- **[P2] One gesture is one undo.** Drawing a wire can also replace an old wire and set a property
  on the mirrored component; those are one act. `connect` now batches them, because stepping back
  through them one dispatch at a time left the document in states nobody drew.
- **[P2] The editor never leaves a reference to something it just deleted.** `removeNode` already
  scrubbed bindings and triggers but not conditions — a condition reading a deleted node can never
  hold, so the component would silently never appear again.
- **[P3] Eight actions, and the number is the product.** Bubble has roughly sixty. Deciding which
  eight *is* the design work; a ninth needs an argument, not a ticket. The bar: an action earns its
  place only if it cannot be said with what already exists, and the 80% needs it. See
  `specs/actions.md`.
- **[P3] `show` / `hide` was proposed and rejected.** A component's visibility is already
  `visibleWhen` reading a boolean, so "show the confirmation" is `setVariable` plus a condition —
  one mechanism, already built, and it composes. A second imperative way would mean two sources of
  truth for one question, and the canvas could not show which one won.
- **[P3] A failed pipeline stops the sequence.** "Save, then navigate" must not navigate when the
  save failed; continuing would show someone a success they did not get. Bubble continues on
  failure — this is a deliberate divergence, and `run_…` reports success so a sequence can act on
  it.
- **[P3] An old handler is a one-action sequence.** `navigate` and `trigger` keep the shapes they
  had as standalone handlers, so every document written before spec 7 reads unchanged — no
  migration, and no second representation to keep alive.
- **[P3] The wire and the `trigger` action are one fact in two views.** Drawing the wire appends a
  step rather than owning the property; removing either removes only that step. The wire is what
  makes "this button runs that pipeline" readable from across the graph, and the Inspector adds the
  order and the rest.
- **[P3] The toast lives above the router, not in the screen.** Found by building the done-when:
  "save, confirm, navigate" unmounts the screen — and a per-screen toast with it — a frame after
  the confirmation appears. A message outlives the screen that sent it.
- **[P3] The sequence is edited inline, never in a modal.** loom's protection against workflow
  spaghetti is that behaviour is visible and wired, and that protection dies the moment an action
  list hides behind a dialog.
- **[P4] A row identity is the primary key from introspection, never a designer's problem.** A
  table with no primary key refuses update and delete by name — the alternative is a query that
  rewrites every row, which is the worst failure a builder could ship.
- **[P4] Every column is optional on an update.** Changing one field is the common case; demanding
  the rest would make an edit form re-send data it never showed. `undefined` means "not on this
  form", which is not the same as "set it to null".
- **[P4] A search is a filter whose value the screen supplies.** An input filter becomes a port,
  which becomes a route input — the value someone typed travels the road a form field already
  travels, so search needed no machinery of its own. An empty box narrows nothing rather than
  matching nothing.
- **[P4] A write invalidates a read of the same table, per table, on the same screen.** A counter
  bumped by the write and named in the read's dependencies: what a developer would write by hand,
  demand-driven like every other local. Cross-screen invalidation is not attempted.
- **[P4] A List pages what was fetched, not what exists.** Server-side paging needs an offset the
  caller supplies, and nothing on a screen can hand one over yet. Slicing is honest for the
  hundreds of rows a `limit` already caps and costs no round trip.
- **[C] The Preview is a window, not a column.** It floats over the canvas, collapses to its bar
  and remembers where it was left. A docked panel charged the canvas a third of its width whether
  or not anyone was looking at the running app.
- **[C] The Preview server reports how many pages heard a build.** The studio cannot see from
  its own side whether a hot update was delivered, and a guess became a reload loop while typing.
  The write already knows how many connections it had, so it says — and a build nobody heard is
  the only thing that reloads the frame, at most once a second.
- **[C] The tools always win a click.** The floating toolbar sits above the Preview window, and
  the window opens away from it. A panel that swallows a press on the tools is a trap, whatever
  the z-order happens to be that day.
- **[C] A build error is never folded away.** The Preview collapses to keep the canvas clear, and
  hiding *why nothing works* behind that would make a broken build look like a quiet one.
- **[C] A mockup is judgement, not decoration.** The device around the app is drawn to real
  proportions so a designer can see whether a header is reachable by a thumb or a footer is buried
  under a home bar. With no device chosen, the app is drawn exactly like a screen on the canvas.
- **[C] A device preview is scaled, never squeezed.** The app renders at the device's real CSS
  width and the stage scales it to fit the window. A preview that quietly reflows the app to the
  panel's width is answering a question nobody asked. "Fluid" is the honest opposite: the frame is
  the window, so resizing it resizes the viewport.
- **[C] A page cannot be hot-updated into a build that landed while it was loading.** The frame
  records the build it went to fetch and loads again if the app moved on meanwhile. Earlier
  attempts to fix this from the dev server — replaying to the next client to connect — did not
  fire, and the client side is where the information actually is.
- **[C] A screen is a frame with a route, and the editor now says so.** One row in the tree, one
  panel in the inspector. They were always one object; the seam was in the UI, and it made people
  hunt for padding in the wrong half. The IR keeps `Artboard` separate because a URL, a guard and
  a design-time size have no business on every Button's schema — the merge is where a designer
  looks, not where the compiler reads.
- **[C] The same frame gesture makes a screen or a group, decided by what is underneath it.** Drawn
  on the open canvas it is a screen; drawn inside one it is a frame. That is the whole difference
  between them, made visible.
- **[C] A screen drawn from a preset is named for the app, not the device.** "Screen 2", not
  "Phone" — the size chip already says what shape it is, and a screen's name is what it is called
  in the app.
- **[C] Free placement is a per-frame mode, and it is the default for a new screen.** The earlier
  answer — draw anywhere, infer the flex slot — was right about emission and wrong about drawing:
  someone composing a screen puts a thing somewhere and means it, and a canvas that relocates it
  into a column is arguing with the gesture. A frame is either a drawing board (`position:
  relative` with absolute children) or an auto layout (flex); the inspector says which and what it
  costs, and switching to auto layout drops the coordinates rather than keeping two descriptions.
- **[C] "Live" means the running page has this build, not that the studio finished posting it.**
  The dev server reports how many pages heard each write, and the Preview stays "compiling" until
  one did. A preview that says live while showing the app from before the last edit is the studio
  telling a small lie at exactly the moment someone is checking their work.
- **[C] A build nobody heard is said again, never forced through with a reload.** A reload throws
  away whatever the person has done in the running app — a half-filled form, a message they were
  reading — which is usually the very thing they were about to look at. The repeat names only the
  modules that actually changed: naming every emitted file would name `main.tsx`, which nothing
  can hot-swap, and the page would reload anyway.
- **[C] The Preview serves nothing while a build is being written.** A page that asks for its
  modules mid-write can end up holding half of one build and half of another; a few milliseconds
  of waiting removes the in-between state entirely.
- **[C] The inspector takes Figma's shape, not its palette.** Titled collapsible sections, dense
  paired controls with a mark in front of each number, the name in the header — the densest
  arrangement of object properties that stays readable, and one every designer already knows. The
  colours stay loom's: light-mode only, red reserved for the primary action (`docs/13-inspector.md`).
- **[C] Custom colours are allowed, and the system still comes first.** The earlier "no hex field"
  rule was half right: a hex box does weaken a design system, and a tool that refuses a colour
  until the designer has named it is one they fight. The picker opens on the project's swatches,
  with the custom controls underneath and one line explaining the difference. Tokens remain the
  default and still emit `var(--loom-…)`; a custom colour is stored as the literal it is. Corner
  rounding follows the same shape — the scale first, a number beside it.
- **[C] An effect is a composition a designer names, not a property they assemble.** Glass is a
  backdrop blur, a translucent tint and a hairline edge; noise is grain the browser draws from an
  SVG filter rather than an image the app has to carry. Each emits ordinary CSS, so the escape
  hatch stays open and nothing ships a runtime.
- **[C] Opacity, rotation and clipping are per-object, not tokens.** No scale stands behind "37%"
  or "15 degrees". They emit plain CSS, and rotation is painted rather than laid out, so the box a
  thing occupies never moves.
- **[C] A control is only offered where it means something.** A rectangle is not asked how it
  stacks children it cannot have; a child of an auto-layout frame is not offered coordinates it
  does not own.
- **[C] The canvas is the app's document, not the studio's.** Design mode draws the app's markup
  inside the studio, so the studio's element styles landed on it — a Text field inherited
  `width: 100%` from the inspector's inputs and stretched across the screen. Inside a screen the
  studio's styling is rolled back to the browser's and the emitted app's base is applied instead.
  A canvas that lies about what an input looks like is worse than no canvas.
- **[C] A drag is one undo, not sixty.** Moving and resizing arrive as an op per pointer event, so
  the first op of a gesture pushes history and the rest replace the snapshot in place. Without it,
  dragging a box across a screen would take a minute of pressing undo to take back.
- **[C] Rulers, grid and snapping are the designer's; guides are the project's.** How someone
  works is remembered per browser. A guide is a decision about a particular composition, so it
  lives in the document beside its screen — still there tomorrow, and for whoever opens it next.
  Neither emits anything.
- **[C] Free placement is an input method, not a storage format.** The canvas lets a designer
  draw anywhere; the gesture is read into a parent, an index along that frame's axis and a size,
  and only that is stored. This is what lets loom feel like a design tool without breaking the
  flex-first guardrail — Figma arrived at the same place from the other side with auto layout, and
  in loom there is no mode to switch on because there is nothing else.
- **[C] A shape is an element, not a decoration the editor invented.** Rectangle, ellipse and line
  emit inline SVG, take layout and conditions like everything else, and paint from the same style
  block every other element uses. A second colour vocabulary for shapes would mean two places to
  restyle a project.
- **[C] The pen is deferred until a path can be edited after it is drawn.** A point model plus
  on-canvas handles is the work; three primitives prove the emission first, and a curve nobody can
  adjust afterwards is worse than no pen.
- **[C] A new project has nothing in it — not even a screen.** A seeded screen decides someone's
  size, name and count before they have said anything, and drawing a frame is how every screen
  after it is made. An empty project is a state rather than a failure: the compiler still refuses
  to emit an app with no screens, and the studio says "nothing to run yet" instead of showing that
  refusal as an error.
- **[C] The selection chrome cannot depend on a ref alone.** Writing a ref does not re-render, so
  the overlay drew only when something else happened to re-render right after the node arrived —
  and when nothing did, a freshly drawn component had no handles at all. The seeded sample heading existed because the first compiler
  needed something to emit, and it had become the first thing every designer deletes.
- **[C] The Preview remounts once on its first build.** A hot update only reaches a page already
  listening, and the Preview's page loads while that first build is still being written — so the
  first edit appeared to do nothing until a second edit repaired it. One remount at the start
  removes the race; every build after it is a hot update.
- **[P5] The app's session lives in HttpOnly cookies, not in the browser.** The tutorial answer
  is supabase-js with tokens in `localStorage`, and it means any script reaching the page can take
  the token. In the one feature whose job is keeping a person's data theirs, the weaker option is
  indefensible — so signing in is a request to the app's own server, and the browser only ever
  learns who it is, never how to prove it.
- **[P5] A project with users answers its database as the person asking.** The caller's token goes
  on the request and row-level security decides; the service-role key is not used by those routes.
  Letting a designer wire the current user's id into a filter was rejected: that id would travel
  from the browser, so anyone could send someone else's, and it would look right in the editor
  while handing out other people's rows.
- **[P5] The current user is a value, not a subsystem.** One node with `signed in`, `email`, `id`
  and `error` ports. Auth-gated visibility is then `visibleWhen` (spec 6) with nothing new behind
  it, and showing who is here is an ordinary binding.
- **[P5] A screen guard is a convenience; the server is the boundary.** It keeps a signed-out
  visitor off a screen built for someone else, and it renders nothing while the session is still
  unknown. Someone who types the URL still sees nothing, because every request they make is
  answered as whoever they are.
- **[P5] Sign-in failure says one sentence for both causes.** Telling an unknown address apart
  from a wrong password tells a stranger which addresses have accounts.
- **[P5] Signing up with email confirmation on is a success that signs nobody in.** Supabase
  answers with a user and no session; the app is told so rather than left looking signed out for a
  reason nobody can see.
- **[P4] A guardrail test should assert the thing it means.** The credential check scanned for the
  word "key" and fired on a cached schema saying `primaryKey`. It was wrong in both directions — a
  leaked key need not contain the word — so it now checks for credential-shaped *values*.

- **[P1.2] A variable is one node with two scopes, not two nodes.** `screen` is one artboard's
  `useState`; `global` is the same merge point held in a React Context above the router. Same fan-in
  `set` port, same last-write-wins, same refusals — only how far the value reaches changes, so a
  designer who has learned one has learned both. See `specs/binding-trigger-runtime.md`.
- **[P1.2] A global variable's identity is its name, not its node id.** Two Global nodes carrying
  the same name are one value. A node id is not something a designer can type on another screen, so
  the name is the only thing that can make "the screen that computes it" and "the screen that shows
  it" meet — and it is what the canvas draws on the node.
- **[P1.2] A writer belongs to the screen holding the button that fires it.** Writes are always
  triggered, so this is well defined, and without it a screen that only displays a global would try
  to emit the other screen's function node — reading fields that do not exist there. A screen
  variable written from another screen is a Build error naming the fix ("make it global"), never a
  `useState` that silently never updates.
- **[P1.2] Reading a variable back is supported, and the trigger rule is why.** `total = total +
  amount` reads inside the handler the button already calls, so there is one answer at one moment
  rather than a render loop. The M5.1 deferral is lifted; what stays deferred is a cycle *through
  two* variables, which has no demand behind it yet.
- **[P1.2] Demand is transitive and app-wide.** A variable read by a demanded function node is
  demanded too, and a global is emitted when any screen reads it — but a screen that only writes one
  still emits the write. The emitted app builds with `noUnusedLocals`, so each screen destructures
  only the halves it uses: the value where it displays, the setter where it writes.

## The next specs to write (highest-leverage, in dependency order)

1. **Snapshot schema** — canonical project JSON (artboards, components, graph, wires, bindings,
   stable ids). It's the save format + compiler input + versioning atom.
2. **Type registry + live checker** (with Supabase-generated-type ingestion).
3. **Connector credential model** (source-agnostic, env-bucket, manual/oauth strategies).
4. **Binding/trigger runtime** (how a bound property gets its data; triggered vs reactive).
5. **Layout model** (flex container spec).
