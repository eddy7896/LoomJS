# @loom/compiler

Walks a `@loom/ir` **snapshot** and emits a real **Vite + React + TypeScript** repo.
This is the core bet of loomJS (`docs/02-system-architecture.md`): compile = stitch per-type
code templates, not interpret a runtime.

## Status — M3 (the graph emits a running backend)

M0 proved `graph -> files -> runs`; M1 wired it to the editor; M2 added routing; M3 adds the
server.

| Emitted                    | Notes                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| Vite + React + TS scaffold | `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/index.css` |
| One module per artboard    | `src/artboards/<Name>.tsx`, a React function component                                           |
| `src/App.tsx`              | renders the entry artboard                                                                       |

Component vocabulary: `Frame` (flex container) and `Text`. Layout emission is the flex-first
v0 subset the snapshot schema carries — the full **layout model is spec #5** and lands before M1.

## Not yet (by design)

- **`bound` flow payloads** -> `CompileError`: they read a node port, which needs M4's typed data.
- Connectors (M4), auto-backend inference (M5), deploy (M6).

Failing loudly beats silently dropping a binding: these surface as the **Build** error tier
with the offending entity id (`CompileError.entityId`) so the editor can map back to the node.

## Usage

```ts
import { compile } from '@loom/compiler';
import { writeFiles } from '@loom/compiler/node'; // node-only entry
import { createTrivialSnapshot } from '@loom/ir';

const { files } = compile(createTrivialSnapshot());
await writeFiles(files, './out', { clean: true });
// cd out && npm install && npm run build
```

**Backend (M3).** An API route node is a container: the function nodes inside its body run in the
emitted serverless function, and the container boundary *is* the network boundary
(`docs/specs/binding-trigger-runtime.md`). Around it, the compiler emits plain React — `useState`
for each **bound** output, a `useCallback` that fetches, and either the component's event handler
(triggered) or a `useEffect` (reactive). No runtime library ships with the app.

State is demand-driven: an output nobody binds emits no variable, because the emitted app builds
with `noUnusedLocals` and dead state would fail its own `tsc`. Every wire is type-checked with
`@loom/typesys` before emission (`docs/specs/type-registry.md`).

## Tests

- `pnpm test` — fast: emission assertions + golden files (`test/__golden__/`) + error cases.
- `pnpm test:smoke` — the M0 gate: emit -> `npm install` -> `npm run build` (which runs
  `tsc --noEmit` too) -> assert the built bundle contains the rendered text. Slow (~45s) and
  networked, so it is excluded from the default run.

Update goldens with `pnpm test -u` after an intentional emission change.
