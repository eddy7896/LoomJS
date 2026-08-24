# Product

## Register

product

## Users

UI/UX designers who read code but don't want to write app syntax. They are Figma-fluent,
understand props, state, and schema, and can look at a TypeScript file without flinching. They
came to loomJS because they want to ship a real full-stack app and own the result: the code, the
database, and the deployment.

Their context is a desktop or large tablet, a full working session, one project open. They are
building, not monitoring: the screen is where the work happens, not where a status is checked.
The job to be done is "turn the app I can already picture into a running, owned codebase without
leaving the canvas."

Because they read code, the studio does not need to hide its machinery. Types, ports, generated
output, and compiler errors can be shown directly, in the real vocabulary, without softening
layers. Density is allowed. Condescension is not.

## Product Purpose

loomJS is a web-based visual programming language with Figma-style design tools. Designers build
full-stack, data-driven web apps by designing UI on artboards (Design mode) and wiring visual
nodes (Nodes mode). The node graph is an intermediate representation; a compiler emits a real
Vite + React + TypeScript frontend and a serverless backend, wired to the user's own Supabase and
deployed to their own Vercel (BYO-backend).

Success is a designer compiling a working app they can read, edit, and ship anywhere, and never
feeling that they left the canvas to get there.

The primary surface is `apps/studio`, the editor. The `landing` surface exists as a separate
marketing site and always runs the **brand** register; name it explicitly when working there.

## Brand Personality

**Calm, literal, precise.**

Voice: name things exactly what they are. A wire is a wire, a flow arrow is a flow arrow, a node
is a function. No metaphor inflation, no invented vocabulary beyond `docs/06-glossary.md`.

Tone: an instrument, not an assistant. The studio does not celebrate, encourage, or exclaim. It
reports state accurately and gets out of the way. Errors say what broke and where, not "oops."

Emotional goal: quiet confidence. The designer should feel that the tool is not hiding anything
from them, and that nothing on screen is decoration.

## Anti-references

**Generic SaaS dashboard.** Rounded cards in a three-column grid, hero metrics, a sidebar of
fourteen icons, Inter everywhere, the same padding on every surface. This is the AI-slop default
and it is wrong for a canvas tool: loomJS has one workspace, not a set of panels to survey.

**AI-product aesthetic.** Sparkle icons, purple-to-blue gradients, chat-first surfaces, "ask
anything" bars. loomJS is deterministic compilation, not a prompt box. Nothing in the studio
should imply the output was guessed.

Related positioning, from the readme: loomJS is a language, not another app builder that traps you
in a runtime. Interface choices that read as "configurable builder" rather than "editor for a
language" work against that.

## Design Principles

1. **Never left the canvas.** Every programming concept gets a calm, literal, designerly surface
   on the canvas itself. Anything that cannot get one goes to the Code node instead of forcing
   syntax into the flow. Modals, wizards, and detours are failures of this principle.

2. **Color is functional, never decorative.** The node category hues (UI, FN, API, State, DB) are
   the only carriers of meaning in color. Red is reserved for the single primary action and the FN
   category. Editor furniture stays ink. Spending a category hue on chrome corrupts the signal.

3. **Show the machinery.** These users read code. Types, ports, compiled output, and node-to-code
   lineage are shown plainly rather than abstracted away. Trust beats reassurance: the studio earns
   confidence by being inspectable, not by looking friendly.

4. **Two modes, never blurred.** Design mode is frontend only; Nodes mode is the backend graph.
   The artboard owns component existence and appearance, Nodes mode owns behavior and wiring. Any
   interface that lets one bleed into the other is wrong even if it is convenient.

5. **Ownership is visible.** The generated repo is the point. The path from graph to real files
   stays reachable and readable in the product, not buried behind a deploy button.

## Accessibility & Inclusion

- **WCAG 2.2 AA.** Contrast on text and UI components, full keyboard paths for canvas, inspector,
  and node graph, focus never lost or invisible.
- **Node color is never the sole signal.** The five category hues always travel with a label or a
  distinguishing shape, so a colorblind user is never locked out of reading the graph. This is the
  one accessibility rule with the highest product cost if broken: color IS the graph's type system
  at a glance.
- **prefers-reduced-motion** honored throughout.
- **Tablet and up** (guardrail 24), flex-first layout, with a graceful guard below 768px rather
  than a broken canvas.
