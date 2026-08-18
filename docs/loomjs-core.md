---
description: loomJS core guardrails and anti-hallucination rules. Always on.
activation: Always On
---

# loomJS — Core Rules (Always On)

These are hard constraints for any agent working on loomJS. They override convenience.
Full detail in `/docs`. This file is the always-loaded minimum.

## Identity guardrails
- loomJS is a **domain-specific visual programming language for data-driven web apps**, not
  a general-purpose one. Do NOT try to make arbitrary logic expressible as nodes. The
  pressure-release valve for the hard 20% is the **Code node** (typed ports, hand-written
  TypeScript body). If a feature pushes toward general-purpose visual programming, stop and
  flag it.
- **BYO-backend:** loom never hosts app data. The user connects their own Supabase and
  deploys to their own Vercel. loom brokers their credentials; it does not own their infra.
- **Compile = generate a real, owned repo.** Never design a locked-in runtime. Never hide
  the generated code — reversibility and lineage are the trust model.

## Security guardrails (do not violate)
- **Secrets are server-only.** Credentials live in the encrypted **env bucket**, referenced
  by name. NEVER write a secret into: the project snapshot JSON, the R2 blob, the generated
  repo, or any client/UI-side node. The compiler must REFUSE to wire an env value into a
  client-side node.
- The Supabase **service key** is server-only; the **anon key** may reach the client. Keep
  them distinct.
- **Two Supabases, never blurred:** platform Supabase (loom's own users/workspaces/metadata)
  vs. the user's connected Supabase (their app). Never route data across that wall.
- **Never commit `.env` or keys.** Values are injected into Vercel/Preview at deploy time by
  name reference only.
- Ask for explicit confirmation before: deleting a user project, writing to a connected
  database during Preview, or altering migrations.

## Anti-hallucination rules
- **Verify external API capabilities against live docs before relying on them.** Especially:
  Supabase Management API + OAuth partner program, Vercel integration/OAuth API, Cloudflare
  R2, and Supabase's TS type generation. Do NOT assume a capability exists. If unverified,
  say so and gate the design on it.
- **There is no reliable way to auto-generate a good node from an arbitrary npm package.**
  npm has no uniform machine-readable shape. npm = dependency layer under Code nodes +
  hand-authored curated library modules. Never propose "search npm → auto-node."
- **You cannot auto-populate the palette from an arbitrary UI library.** Only *styled,
  self-contained, prop-documented* kits (shadcn, MUI) populate via a shipped props manifest.
  Unstyled/compound-primitive libraries (Radix, Headless UI) ride along as dependencies and
  are NOT exposed as draggable palette items.
- **Do not invent** node types, port types, connectors, buckets, or terminology beyond the
  glossary (`docs/06-glossary.md`). Extend only by explicit proposal.
- Multiplayer/live co-editing is **deferred** (v2, Git-style async). Do not build CRDT/OT or
  realtime sync into V1. But keep the document branch-ready: stable ids + atomic ops.
- Fintrack is a **sample app**, not the product spec. Do not hardcode finance assumptions.

## Type & code rules
- **TypeScript is a hard dependency.** All generated app code and Code node bodies are TS.
  Never emit plain JS. Untyped boundaries (Code node output, untyped npm) are `any`/`unknown`
  and must be visibly marked.
- Ingest **Supabase-generated TS types** as the data spine; `tsc` is the authoritative check.
  loom's live canvas checker is approximate (fast red-ring feedback) — `tsc` is truth.
- Visible type vocabulary is a curated subset: `text`, `number`, `boolean`, `date`,
  `record`, `list<T>`, `optional<T>`, `enum`. Full TS lives only in emitted code, never on
  the canvas.

## Layout & design rules
- **Flex-first, never absolute positioning.** Every Frame is a flex container. Emits real,
  responsive CSS. Target **tablet width and up**; below ~768px emit a graceful guard screen.
- **Color is functional (node category), never decorative.** Red `#EC3013` is reserved for
  the primary action + FN category. Stay on the design system; invent no colors/fonts/chrome.
- Type: Archivo (interface) + JetBrains Mono (code/values/types). Light-mode only.

## Scope discipline
- Anything in the V1 "out" list (`docs/07-v1-scope.md`) is a **v2 branch, not a gap**. Do not
  pull deferred features (Next.js/RSC, Firebase, Docker deploy, custom CI/CD engine, public
  marketplace, React Native, breakpoints, multiplayer) into V1 without explicit sign-off.
