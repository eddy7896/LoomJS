# Spec 1 — Snapshot Schema (v1)

> The first and highest-leverage of the five "next specs" (`03-system-memory.md`). The snapshot
> is the **save format**, the **compiler input**, and the **versioning atom** at once. This spec
> is the prose companion to the runtime schema in `packages/ir/src/schema.ts` — the code is
> authoritative; if they diverge, fix the code and update this doc.

## What a snapshot is

The serialized JSON of one whole project's document: its artboards, the components on them, the
Nodes-mode graph (nodes + wires), the navigation flows between artboards, and connector _config_
(never credentials). Platform metadata (owner, name, timestamps) lives in Postgres; the snapshot
is the R2 blob it points at (`02-system-architecture.md`, `08-flows.md` flow 2).

## Load-bearing invariants

1. **Stable, prefixed ids on every entity** (`cp_…`, `nd_…`, `ab_…`, `wr_…`, `fl_…`). Ids are
   generated, never positional. This is what makes atomic ops, undo/redo, and a future semantic
   branch/merge cheap (`03` deferred-but-cheap-now hygiene).
2. **Entities live in id-keyed maps** (`Record<Id, T>`), not nested trees or arrays. Tree
   structure (a frame's children) is expressed as `children: Id[]` referencing the flat map —
   O(1) lookup and disjoint id-sets for trivial union merges later.
3. **No secret ever enters the snapshot.** A `ConnectorInstance` carries `credentialRef` — a
   _name_ into the encrypted env bucket — never the value (`05-guardrails.md` #1). The compiler
   and the save path both rely on this being structurally impossible to violate.
4. **Types use the curated visible vocabulary only** (`text`, `number`, `boolean`, `date`,
   `record`, `list<T>`, `optional<T>`, `enum`, plus `trigger`/`any`/`unknown`). Full TS lives in
   emitted code; `@loom/typesys` (spec 2) will elaborate `TypeRef`.
5. **Validate in and out.** `serializeSnapshot`/`deserializeSnapshot` run the zod schema on both
   directions, so a malformed snapshot never reaches the compiler or R2.

## Shape (v1)

```
Snapshot {
  schemaVersion: 1
  id, name
  entryArtboard?: Id
  artboards:   Record<Id, Artboard>
  components:  Record<Id, Component>
  nodes:       Record<Id, Node>
  wires:       Record<Id, Wire>
  flows:       Record<Id, Flow>
  connectors:  Record<Id, ConnectorInstance>
}
```

- **Artboard** `{ id, name, root: Id, params?: Param[] }` — one screen; `root` is its top Frame;
  `params` are inputs declared for incoming flows (master→detail).
- **Component** `{ id, type, name?, props: Record<string, PropertyValue>, layout?, children? }` —
  an instance of a property schema. `type` is a component-type name (`Frame`, `Text`, `Input`,
  `Button`, kit components). `children` (frames only) references the flat map.
- **PropertyValue** — the Design↔Nodes seam, one of:
  - `static` — a literal the designer typed.
  - `bound` — `{ source: PortRef }`, a wire to a backend node's output.
  - `event` — `{ handler }`, either `navigate`(flowId) or `trigger`(PortRef).
- **Layout** — flex-first only (`direction`, `gap`, `padding`, `align`, `justify`, optional
  `size` with `hug|fill|fixed`). No absolute coordinates, ever. Provisional until layout spec 5.
- **Node** `{ id, category (ui|fn|api|state|db), kind, ports: Port[], position, mirrorOf?, config? }`
  — a graph unit. UI mirror nodes set `mirrorOf` to their component id.
- **Port** `{ id, name, direction (in|out), portKind (data|trigger), type: TypeRef }`.
- **Wire** `{ id, from: PortRef, to: PortRef }` — a data/trigger connection between ports.
- **Flow** `{ id, from, to, payload?, guard? }` — a navigation arrow between artboards;
  compiles to a route (+ guard); `payload` maps values to the destination's params.
- **ConnectorInstance** `{ id, moduleId, config?, credentialRef? }` — config only; credential by
  name.

## Atomic ops

Live editing applies fine-grained atoms (`addComponent`, `setProp`, `addWire`, …) via a pure
`applyOp(snapshot, op) -> snapshot`; a save produces a new validated snapshot. Ops must stay
fine-grained — a coarse "replaced whole graph" op would make semantic merge impossible (`02`).
Deleting a component also deletes its mirror node (ownership discipline).

## Deliberately deferred

- **Op _log_ persistence / CRDT.** V1 keeps ops in memory for undo/redo only; it does not persist
  an oplog. Snapshots are the source of truth; ops are derived (`03`).
- **Content-addressed history.** V1 may overwrite one R2 key per project; keeping every key is the
  additive upgrade to history/branch/merge — not built now.
- **`exactOptionalPropertyTypes`-level rigor on optional fields** — revisit if it catches real bugs.

## Open questions (resolve as their consumer lands)

- Payload/param typing rules for flows (checked against destination `params`) — with type registry.
- Whether `config` blobs (Validate rules, Code body) get their own typed sub-schemas per node kind
  — likely yes, incrementally, as each node's compiler is written.
- Route/API node as a container holding an internal ordered pipeline vs a flat graph (`03` open) —
  will add a `container`/`children` concept to `Node` if container wins.
