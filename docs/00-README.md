# loomJS — AI Context Documentation

This suite is the durable, tool-readable memory of the loomJS project. It exists so that
AI collaborators (and humans) work from the same settled decisions instead of relitigating
them or hallucinating capabilities.

## How the two agentic tools consume this

- **Claude Code** reads `/CLAUDE.md` (root) at session start.
- **Google Antigravity** (and Cursor) read `/AGENTS.md` (root) at session start, plus any
  `Always On` rules in `/.agents/rules/`. `loomjs-core.md` there is the always-loaded minimum
  (guardrails + anti-hallucination), kept under the 12,000-char rule limit.
- Both entry files are concise and **route into `/docs`** for detail. Load the doc your task
  needs.

## File map

```
/CLAUDE.md                     entry point for Claude Code
/AGENTS.md                     entry point for Antigravity + Cursor (cross-tool standard)
/.agents/rules/loomjs-core.md  Antigravity always-on rule (condensed guardrails + hallu-check)
/docs/
  00-README.md                 this index
  01-system-context.md         vision, BYO-backend, the two modes, reframe history
  02-system-architecture.md    layers, compiler-as-IR, connectors, data flow, storage, platform
  03-system-memory.md          DECISION LOG — settled / deferred / open, with reasoning
  04-hallucination-check.md    verify-before-asserting protocol + known-false traps
  05-guardrails.md             hard constraints (security, scope, metaphor, design, process)
  06-glossary.md               canonical terminology (one term per concept)
  07-v1-scope.md               V1 in/out line + milestone build order
```

## Reading order for a new collaborator

1. `01-system-context.md` — understand what loomJS is and why.
2. `07-v1-scope.md` — understand what V1 is (and isn't).
3. `03-system-memory.md` — absorb the settled decisions before proposing anything.
4. `05-guardrails.md` + `04-hallucination-check.md` — the constraints you must not cross.
5. `02-system-architecture.md` — the how, when you're ready to build.
6. `06-glossary.md` — keep open; use the exact terms.

## Maintenance

- When a decision changes, update `03-system-memory.md` **first** (it's the source of truth),
  then propagate to the affected docs and entry files.
- Keep `AGENTS.md` and `/.agents/rules/*.md` **under 12,000 characters each** (Antigravity limit).
- The next design work is the "next specs" list at the end of `03-system-memory.md`:
  snapshot schema → type registry → connector credential model → binding/trigger runtime →
  layout model. None are written yet.
- This suite supersedes the original single `Claude.md` (which described the earlier single-user
  Fintrack-app-builder framing). Keep the original only as historical reference.
```
