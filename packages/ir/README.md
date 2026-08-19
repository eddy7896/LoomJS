# @loom/ir

The loomJS **snapshot schema** and its atomic-op layer — the intermediate representation the
compiler reads and the platform saves.

- `schema.ts` — the zod schema + inferred types for a `Snapshot` (artboards, components, nodes,
  wires, flows, connectors) plus `serializeSnapshot` / `deserializeSnapshot` (validate in _and_
  out).
- `ids.ts` — stable, prefixed id generation (`cp_…`, `nd_…`).
- `ops.ts` — fine-grained atomic operations + a pure `applyOp` reducer (undo/redo + future
  semantic merge foundation).
- `fixtures.ts` — `createEmptyProject` and the `createTrivialSnapshot` used to bring up the M0
  compiler skeleton.

Load-bearing rules (see `docs/specs/snapshot-schema.md`): entities live in id-keyed maps; **no
secret ever enters the snapshot** (connectors reference credentials by name); types use the
curated visible vocabulary only.

```bash
pnpm --filter @loom/ir test
```
