# 04 — Hallucination Check

> A verification protocol for AI collaborators. loomJS spans several fast-moving external
> platforms and several counter-intuitive design decisions. This file lists (A) things to
> verify before asserting, and (B) known-false traps that sound plausible but were explicitly
> rejected. When in doubt, **say "I need to verify this" and gate the design on it** rather
> than asserting confidently.

## A. Verify before relying on it (external capabilities)

These change and are easy to misremember. Check live docs before designing around them.

- **Supabase Management API + OAuth partner program.** Whether loom can register as an OAuth
  app, list/connect user projects, and fetch keys programmatically — and the *terms* of that
  program — must be confirmed. The "connect like Vercel↔Supabase" flow depends on it. Do NOT
  assume approval or availability. Manual-connection-with-validation must remain the baseline.
- **Vercel integration / OAuth API.** Project creation, env-var injection, deploy triggering
  via integration. Confirm scopes and current API shape.
- **Supabase TypeScript type generation** (`supabase gen types typescript` or equivalent).
  The type-system spine assumes this exists and is ingestible. Verify the current command,
  output shape, and how it represents relations/enums/nullable/JSON columns.
- **Cloudflare R2** specifics: S3-compat surface, egress terms, object size limits, and
  whether your access pattern (many small JSON reads) fits. Confirm before pricing/architecture
  claims.
- **shadcn/ui CLI** behavior (it copies source into the repo) and its current dependency set
  (Radix, tailwind-merge, etc.) and Tailwind version assumptions.
- **Antigravity / Claude Code file conventions.** Rules files cap at 12,000 chars; Antigravity
  reads `AGENTS.md` + `GEMINI.md` and `.agents/rules/`; Claude Code reads `CLAUDE.md`. If you
  add tooling, re-verify these — they are recent and evolving.
- **Any npm package's runtime compatibility** (serverless vs browser vs native) before claiming
  it works in a Vercel function or the browser bundle.

**Rule:** never state an external capability as fact from memory. Either cite a checked source
or explicitly flag it as unverified and make the design robust to it being false.

## B. Known-false traps (plausible-sounding, explicitly rejected)

Do not propose these. They were considered and ruled out for the reasons given.

- **"Auto-generate a node from any npm package."** FALSE path. npm has no uniform,
  machine-readable shape; most packages don't map to typed ports. npm = dependency layer under
  Code nodes + hand-authored curated library modules. (Well-typed packages *may* later get a
  human-in-loop `.d.ts` scaffolder — that's an accelerator, not auto-generation.)
- **"Import any UI library and the palette auto-populates."** FALSE for arbitrary libs. Only
  styled, self-contained, prop-documented kits (shadcn, MUI) populate, via a *shipped props
  manifest*. Unstyled/compound-primitive libs (Radix, Headless UI) are dependencies, not
  palette items.
- **"Expose Radix primitives as draggable components."** FALSE. Radix is unstyled + compound
  (Dialog.Root/Trigger/Content…); it rides along under shadcn, never placed directly.
- **"Build loops / general control flow as nodes."** REJECTED. Use implicit map (list-carrying
  wire runs downstream per-item, stacked port) and a single binary Gate. Bake async
  loading/success/error into wire semantics, not as visible exception-flow nodes.
- **"Make everything expressible as nodes (general-purpose VPL)."** REJECTED — it's the anti-
  goal. The Code node is the escape hatch precisely so the node vocabulary stays small.
- **"Use plain JS output"** or **"make TypeScript optional."** REJECTED. TS is a hard dependency
  (it *is* the type system + checker).
- **"Absolute-positioned canvas that emits pixel coordinates."** REJECTED — brittle, non-
  responsive, unshippable; irreversible trap. Flex-first only. Note that **free placement on the
  canvas is not this**: a designer draws anywhere, and the gesture is read into a parent, an index
  and a size before it is stored (`docs/12-canvas.md`). Coordinates are an input method, never a
  storage format — if a gesture cannot be read as flex, it does not ship.
- **"Build live multiplayer / CRDT sync for V1."** REJECTED — deferred to Git-style async
  branch/merge. Don't add realtime sync infrastructure to V1.
- **"Store secrets in the graph / snapshot / repo so the app can use them."** SECURITY-FALSE.
  Secrets are server-only, env-bucket, name-referenced, injected at deploy. Never in
  snapshot/R2/client.
- **"loom hosts the user's app database."** FALSE — BYO-backend. loom never hosts app data.
- **"Blur platform Supabase and connected Supabase"** (or platform auth and app auth). FALSE —
  they are separate universes on opposite sides of a wall.
- **"A single monolithic JSON file holds all versions/history."** REJECTED — bloat, merge
  bottleneck, corruption risk. Content-addressed blobs in R2 + Postgres pointers.
- **"Auto-provision a Supabase project for the user."** Deferred/rejected for V1 — billing and
  data implications; users create their own.
- **"Fintrack's schema/behavior is the product spec."** FALSE — it's an illustrative sample.

## C. When you're unsure which side of a decision something falls on

Default to the **conservative** action: do not invent a primitive, do not assert an external
capability, do not pull a deferred feature into V1. Flag the uncertainty explicitly and point
to `03-system-memory.md`. A withheld addition is a minor loss; a silently-invented node type,
a leaked secret, or a scope-exploding feature is a serious one.
