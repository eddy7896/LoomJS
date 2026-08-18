# 05 — Guardrails

> Hard constraints for anyone (human or AI) building loomJS. These override convenience and
> cleverness. A change that violates a guardrail is wrong even if it "works."

## Security guardrails (highest priority)

1. **Secrets are server-only.** Credentials live in the encrypted **env bucket**, referenced by
   name. NEVER serialize a secret into: the project snapshot JSON, the R2 blob, the generated
   repo, or the browser bundle. The compiler MUST refuse to wire an env value into any
   client-side (UI) node, with a clear error.
2. **Anon key vs service key.** The Supabase anon key may reach the client (normal config); the
   service key is env-bucket, server-only. Keep them distinct in every design.
3. **Two Supabases, never blurred.** Platform Supabase (loom's users/workspaces/metadata) vs.
   the user's connected Supabase (their app data). Never route data across that wall. Likewise
   platform auth ≠ generated-app auth.
4. **Never commit `.env` or keys.** Env values are injected into Vercel/Preview at deploy from
   the encrypted store, by name reference only.
5. **Account-level OAuth tokens are higher-stakes than project keys.** Minimal scopes, encrypted
   at rest, refresh + revocation + audit. Learn credential handling on project keys first.
6. **Confirm before destructive or data-touching actions:** deleting a user project, writing to
   a connected database during Preview, mutating migrations, deploying to production.

## Scope guardrails

7. **loomJS is a domain-specific VPL, not general-purpose.** If a request pushes toward "express
   any algorithm as nodes," stop and route it to the **Code node** instead. Keep the node
   vocabulary small on purpose.
8. **Anything on the V1 "out" list is a v2 branch, not a gap** (`07-v1-scope.md`). Do not pull
   deferred features (Next/RSC, Firebase, Docker, custom CI/CD, marketplace, React Native,
   Vue/Svelte, breakpoints, live multiplayer) into V1 without explicit sign-off.
9. **Don't build the module/plugin abstraction before 2–3 real connectors exist.** Extract the
   manifest from real examples; don't predict it.
10. **Don't over-build multiplayer-readiness.** Only the *free-anyway* hygiene (stable ids,
    atomic ops — which also give undo/redo and clean diffs) is in scope now. No CRDT layer.

## Metaphor & model guardrails

11. **Keep the two-mode split.** Design mode = frontend only; Nodes mode = the backend graph.
    Never leak backend graph editing into Design mode or vice versa.
12. **Preserve the metaphors:** nodes = functions, wires = data flow, flow arrows = navigation,
    compile = generate real code. Don't rename or muddy these.
13. **Ownership discipline:** the artboard owns component existence + appearance; Nodes mode owns
    behavior/wiring. You never create a UI node in Nodes mode — only wire ones design produced.
14. **Flow (navigation arrow, Design mode) ≠ Wire (data connection, Nodes mode).** Two different
    things; never call one the other.
15. **Class/instance separation is the recurring spine** — honor it everywhere: component
    type/instance, module definition/instance, managed/ejected code, property definition/value.

## Type & code guardrails

16. **TypeScript everywhere.** Generated app code and Code node bodies are TS. Never emit plain
    JS. Untyped boundaries are `any`/`unknown` and must be visibly marked.
17. **Don't invent a type language.** Adopt TS, ingest Supabase-generated types, expose only the
    curated visible vocabulary on the canvas. `tsc` is authoritative.
18. **Don't invent node types, port types, connectors, buckets, or terminology** beyond
    `06-glossary.md`. Extend only by explicit proposal, never silently.

## Design-system guardrails (do not invent colors/fonts/chrome)

19. **Color is functional (node category), never decorative.** Node hues are fixed:
    UI `#7C5CFF` · FN `#EC3013` · API `#12A07A` · State `#2F7DE1` · DB `#D98A12`.
20. **Red `#EC3013` is reserved** for the single primary action + the FN category. Don't spend it
    elsewhere.
21. **Surface tokens are fixed:** canvas `#F6F7F9`, panels `#FFFFFF`, borders `#E8EAEE`, ink
    `#1B1D21`, muted `#4B5058`/`#868D97`, radius 13–16px, soft shadows, **light-mode only**.
22. **Type is fixed:** Archivo (interface) + JetBrains Mono (code, values, types).
23. **When shadcn (or any kit) is enabled, brand tokens DRIVE its Tailwind theme** — one styling
    system, not two fighting.
24. **Layout is flex-first, never absolute; tablet-and-up**, with a graceful sub-768px guard.

## Process guardrails for AI collaborators

25. **Verify external APIs against live docs before asserting** (see `04-hallucination-check.md`).
    Never state an external capability as fact from memory.
26. **Read `03-system-memory.md` before proposing anything that feels decided.** Don't re-argue
    settled trade-offs; if you think a decision is wrong, say so explicitly and cite the entry.
27. **Be the honest collaborator, not the enthusiastic one.** Surface the hard part, the trap,
    and the trade-off — don't just affirm. Feasibility and irreversibility matter more than
    ambition.
28. **When unsure, choose the conservative action** and flag it. A withheld addition is minor; a
    leaked secret, an invented primitive, or a scope explosion is serious.
