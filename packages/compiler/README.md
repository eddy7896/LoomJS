# @loom/compiler

Walks a `@loom/ir` **snapshot** and emits a real **Vite + React + TypeScript** repo.
This is the core bet of loomJS (`docs/02-system-architecture.md`): compile = stitch per-type
code templates, not interpret a runtime.

## Status — M0 (compiler skeleton)

Proves `graph -> files -> runs`. **Static UI only**, driven from tests; no editor involved.

| Emitted                    | Notes                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| Vite + React + TS scaffold | `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/index.css` |
| One module per artboard    | `src/artboards/<Name>.tsx`, a React function component                                           |
| `src/App.tsx`              | renders the entry artboard                                                                       |

Component vocabulary: `Frame` (flex container) and `Text`. Layout emission is the flex-first
v0 subset the snapshot schema carries — the full **layout model is spec #5** and lands before M1.

## Not yet (by design)

- **Bound properties** -> `CompileError` (binding/trigger runtime is spec #4, M3).
- **Event handlers** -> `CompileError` (flows are M2, triggers M3).
- Routing (M2), serverless functions (M3), connectors (M4), deploy (M6).

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

## Tests

- `pnpm test` — fast: emission assertions + golden files (`test/__golden__/`) + error cases.
- `pnpm test:smoke` — the M0 gate: emit -> `npm install` -> `npm run build` (which runs
  `tsc --noEmit` too) -> assert the built bundle contains the rendered text. Slow (~45s) and
  networked, so it is excluded from the default run.

Update goldens with `pnpm test -u` after an intentional emission change.
