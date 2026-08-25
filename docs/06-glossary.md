# 06 — Glossary (Canonical Terminology)

> One term per concept. Use these exact terms in code, UI labels, and docs. Naming is
> load-bearing: the promise is "a designer never feels they left the canvas," so functional
> labels stay literal. Weaving/loom metaphors are allowed only in *brand copy*, never as
> functional labels the user must decode.

## Principles

- Keep Figma's words for Figma's things (frame, component, instance, layer) — don't rename.
  **"Artboard" is not one of them**: Figma calls these Frames, and artboard is Illustrator's and
  XD's word. It survives as the TypeScript type name and a CSS class, and appears nowhere a
  designer reads — the UI says **Screen**.
- Calmest accurate word for the scary things (Gate, not `if`).
- One term per concept in the UI; synonyms allowed only in casual docs.
- Types and values render in **JetBrains Mono**; concepts in prose.

## Workspace & navigation

| Term | Meaning |
| --- | --- |
| **Canvas** | the single work surface both modes share |
| **Mode** | one of the two views of the canvas |
| **Design mode** | Figma-like UI + user-flow editor (frontend only) |
| **Nodes mode** | the backend graph editor |
| **Palette** | left panel of draggable things (components or nodes) |
| **Inspector** | right panel; edits the selected thing + shows its compiled output |

## Design mode

| Term | Meaning |
| --- | --- |
| **Screen** | one page of the app. Has a URL. (`Artboard` in the code.) |
| **Document** | a screen-sized thing meant for paper — an invoice, a report card. Printed, not routed. |
| **Frame** | a container: a box that holds other components and arranges them |
| **Component** | a frame defined once and placed many times. Instances stay in step with it. |
| **Instance** | a placement of a component. Overrides its params, never its insides. |
| **Screen slot** | the hole in a shell where the page appears. Exactly one per shell. |
| **Shell** | a component holding a screen slot — the frame a set of screens render inside. Not a second kind of object: the slot is what makes it one. |
| **Layer** | a component in a screen's tree |
| **Flow** | an arrow between screens = navigation; compiles to a route + guard. NOT a Wire. |
| **Binding** | the link from a component property to a backend node |

## Nodes mode — the graph

| Term | Meaning |
| --- | --- |
| **Node** | one unit in the graph (canonical; retire "card" as a label) |
| **Graph** | the whole set of nodes + wires (in brand copy only, optionally "the weave") |
| **Port** | an input/output socket on a node edge (inputs left, outputs right) |
| **Data port** | a port carrying a value along a wire |
| **Trigger port** | a port carrying an event/trigger (control flow); renders distinctly |
| **Wire** | a connection between ports (source-colored bezier). NOT a Flow. |
| **Pipeline** | a wired path of nodes (describes a flow, not a separate object) |

## Node categories (each owns one hue)

| Term | Tag | Hue | Meaning |
| --- | --- | --- | --- |
| **UI node** | UI | `#7C5CFF` | a component's backend-facing mirror |
| **Function** | FN | `#EC3013` | logic, validation, derivation |
| **API route** | API | `#12A07A` | an endpoint |
| **State** | STATE | `#2F7DE1` | app/session state |
| **Database** | DB | `#D98A12` | a data table (introspection-generated) |
| **Gate** | — | FN-family | a conditional — true/false output edges (only control-flow node) |
| **Code node** | — | mono glyph | escape hatch: hand-written TS body, typed ports |

Convention: spell out **Function / Database / API route** in prose; use **FN / DB / API** as
the compact header tag.

## FN vocabulary (V1)

| Term | Meaning |
| --- | --- |
| **Validate** | declarative rules → Zod (required/type/min-max/email/regex) |
| **Transform / Map** | reshape data between ports (rename/pick/format/cast) |
| **Compute** | a single derived value from a small expression |
| **Gate** | one condition, two output wires (true/false) |
| **Query / Mutation** | DB read (filter/sort/limit) / write (insert/update/delete) |
| **Guard / Auth-check** | specialized Gate: "is there a valid session?" |
| **Code node** | typed ports, hand-written TS body |

## Data, connectors & modules

| Term | Meaning |
| --- | --- |
| **Module** | the general reusable plugin unit (umbrella primitive) |
| **Module definition** | the authored template (manifest + adapter) |
| **Module instance** | a configured module placed/wired on the canvas |
| **Manifest** | a module's declarative spec (config schema, capabilities, exposed nodes) |
| **Connector** | a module that bridges to an external service (a *kind of* module) |
| **Capability** | a permission a module declares and the user approves |
| **Introspect** | a connector reading a live schema to generate typed nodes |
| **Registry** | where module definitions are published/versioned (deferred marketplace) |

Hierarchy: **every connector is a module; not every module is a connector.**

## Generation, preview & deploy (three distinct verbs — never blur)

| Term | Meaning |
| --- | --- |
| **Compile / Generate** | turn the graph into a real codebase |
| **Preview** | run the compiled app live against a dev database |
| **Deploy / Ship** | push the generated repo to a host (Vercel) |
| **Adapter / Target** | a framework or host the compiler emits to (Vite, Vercel) |
| **Source map / Lineage** | the node ↔ code mapping (the trust bridge) |

## Sync & ownership states (from the AUTO primitive)

| Term | Meaning |
| --- | --- |
| **AUTO** | a node loom generated and keeps in sync (dashed + badge) |
| **Accept** | keep an AUTO node as-is |
| **Detach** | break auto-sync by editing an AUTO node |
| **Managed** | code loom owns and regenerates each compile |
| **Ejected** | code a developer took ownership of (solid "owned" glyph) |
| **Re-adopt** | hand control back to loom |

## State scope

| Term | Meaning |
| --- | --- |
| **Variable** | the **State** node itself: many writers, one reader, last write wins |
| **Screen (local) bucket** | a variable scoped to one artboard → React local state |
| **Global (app) bucket** | a variable the whole app shares, named → one React Context above the router |
| **Env (secrets) bucket** | server-only, name-referenced, never in snapshot/repo/client |

A variable's **name** is its identity when the scope is global: two Global nodes carrying the same
name are one value, which is how the screen that computes an answer and the screen that displays it
meet. Its `set` port is the one **fan-in** port in the language, and a write is always **triggered**
— see `specs/binding-trigger-runtime.md`.

## Property value kinds

| Term | Meaning |
| --- | --- |
| **static** | a literal the designer typed |
| **bound** | a wire to a backend node (Design↔Nodes bridge) |
| **event** | a handler/flow trigger |

## Trigger modes

| Term | Meaning |
| --- | --- |
| **triggered** | pipeline fires on an event port (e.g. search submit) |
| **reactive** | pipeline runs on mount / when inputs change (e.g. dashboard list) |

## Platform

| Term | Meaning |
| --- | --- |
| **User** | a loom account (platform auth) |
| **Workspace** | container that owns projects (team-ready, single in V1) |
| **Project** | one loom project (a graph snapshot + assets in R2) |
| **Membership** | user↔workspace join carrying a role (owner/editor/viewer) |
| **Snapshot** | the serialized JSON of a whole project (save format + compiler input) |
| **Platform auth** | how a designer logs into loom |
| **App auth** | login inside the generated app (user's connected Supabase) |

## Open naming decisions (settle before hardening)

- **Node** is canonical over "card." **Graph** is the plain term; "the weave" is brand-copy only.
- Mode-name asymmetry ("Design mode" = activity, "Nodes mode" = objects) is acceptable to keep;
  if ever renamed, "Design / Logic" reads most parallel.
