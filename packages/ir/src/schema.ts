import { z } from 'zod';

/**
 * The loomJS snapshot schema (v1).
 *
 * A Snapshot is the serialized JSON of a whole project. It is simultaneously the
 * save format, the compiler input, and the versioning atom (see docs/03-system-memory.md
 * and docs/specs/snapshot-schema.md).
 *
 * Design rules baked in here:
 *  - Stable ids on every node/component/artboard/wire/flow. Entities live in id-keyed
 *    maps (Record<Id, T>) so atomic ops are O(1) and branch/merge stays cheap later.
 *  - No secrets, ever. Connectors reference credentials by NAME (credentialRef) into the
 *    env bucket; the value never lives in the snapshot (docs/05-guardrails.md #1).
 *  - Types use the curated visible vocabulary only; @loom/typesys will elaborate later.
 */

export const SCHEMA_VERSION = 1 as const;

export const IdSchema = z.string().min(1);
export type Id = z.infer<typeof IdSchema>;

// ---------------------------------------------------------------------------
// Type vocabulary (curated; full TS lives only in emitted code)
// ---------------------------------------------------------------------------

export type TypeRef =
  | { kind: 'text' }
  | { kind: 'number' }
  | { kind: 'boolean' }
  | { kind: 'date' }
  | { kind: 'record' }
  | { kind: 'enum'; values: string[] }
  | { kind: 'list'; of: TypeRef }
  | { kind: 'optional'; of: TypeRef }
  | { kind: 'trigger' }
  | { kind: 'any' }
  | { kind: 'unknown' };

export const TypeRefSchema: z.ZodType<TypeRef> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('text') }),
    z.object({ kind: z.literal('number') }),
    z.object({ kind: z.literal('boolean') }),
    z.object({ kind: z.literal('date') }),
    z.object({ kind: z.literal('record') }),
    z.object({ kind: z.literal('enum'), values: z.array(z.string()) }),
    z.object({ kind: z.literal('list'), of: TypeRefSchema }),
    z.object({ kind: z.literal('optional'), of: TypeRefSchema }),
    z.object({ kind: z.literal('trigger') }),
    z.object({ kind: z.literal('any') }),
    z.object({ kind: z.literal('unknown') }),
  ]),
);

// ---------------------------------------------------------------------------
// Shared references
// ---------------------------------------------------------------------------

/** Points at a specific port on a specific node. */
export const PortRefSchema = z.object({ nodeId: IdSchema, portId: IdSchema });
export type PortRef = z.infer<typeof PortRefSchema>;

/** A bound property points at a backend node's output port (the Design<->Nodes seam). */
export type Binding = PortRef;

// ---------------------------------------------------------------------------
// Property values (static / bound / event) — the seam between the two modes
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Conditions (spec 6) — a reference to a boolean, optionally inverted
// ---------------------------------------------------------------------------

/**
 * A condition is **a reference to a boolean somewhere on this screen**, and nothing more. There is
 * no `and`, no comparison, no chained operator: composition happens in Compare, Logic and Compute
 * nodes on the canvas, which produce a boolean this then reads (`docs/specs/conditions.md`).
 * A second expression language in the inspector is how a domain-specific tool becomes a
 * general-purpose one, and it would be invisible on the canvas besides.
 */
export const ConditionSchema = z.object({
  source: PortRefSchema,
  /** `is` shows when the value is on; `not` inverts it. Words, because a flag reads as noise. */
  test: z.enum(['is', 'not']).optional(),
});
export type Condition = z.infer<typeof ConditionSchema>;

// ---------------------------------------------------------------------------
// Actions (spec 7) — the eight things a click can do
// ---------------------------------------------------------------------------

/**
 * Where an action's value comes from. Deliberately the two simplest sources and no expression
 * language: a literal someone typed, or a port on the graph. Anything more interesting is what a
 * Compute node is for (`docs/specs/actions.md`).
 */
export const ValueSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('static'), value: z.unknown() }),
  z.object({ kind: z.literal('bound'), source: PortRefSchema }),
]);
export type ValueSource = z.infer<typeof ValueSourceSchema>;

/** Every action may carry a condition, so "navigate only if it saved" needs no branch construct. */
const withCondition = { when: ConditionSchema.optional() };

/**
 * **The eleven.** Bubble has roughly sixty; the number here is the product decision, and a twelfth
 * needs an argument rather than a ticket (`docs/specs/actions.md`). Eight were the original
 * catalogue; the three auth actions arrived with P5, already argued for in `docs/10`.
 *
 * `navigate` and `trigger` keep the shapes they had as standalone handlers, so every document
 * written before sequences existed reads as a one-action sequence — no migration, and no second
 * representation to keep alive.
 */
export const ActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('navigate'), flowId: IdSchema, ...withCondition }),
  z.object({ kind: z.literal('trigger'), target: PortRefSchema, ...withCondition }),
  z.object({ kind: z.literal('setVariable'), nodeId: IdSchema, value: ValueSourceSchema, ...withCondition }),
  z.object({ kind: z.literal('setField'), componentId: IdSchema, value: ValueSourceSchema, ...withCondition }),
  /** Back to what it *started* as — a number field to its initial number, not to "". */
  z.object({ kind: z.literal('clearField'), componentId: IdSchema, ...withCondition }),
  z.object({
    kind: z.literal('message'),
    text: z.string(),
    tone: z.enum(['ok', 'error']).optional(),
    ...withCondition,
  }),
  z.object({ kind: z.literal('openUrl'), url: z.string(), ...withCondition }),
  z.object({ kind: z.literal('copy'), value: ValueSourceSchema, ...withCondition }),
  /**
   * App auth (spec 10). These sign in the **app's** users, never the designer — two universes on
   * opposite sides of a wall (guardrail 3). Like `trigger`, they can fail, and a failure stops the
   * sequence: "sign in, then go to the dashboard" must not reach the dashboard on a wrong password.
   */
  z.object({
    kind: z.literal('signIn'),
    email: ValueSourceSchema,
    password: ValueSourceSchema,
    ...withCondition,
  }),
  z.object({
    kind: z.literal('signUp'),
    email: ValueSourceSchema,
    password: ValueSourceSchema,
    ...withCondition,
  }),
  z.object({ kind: z.literal('signOut'), ...withCondition }),
]);
export type Action = z.infer<typeof ActionSchema>;
export type ActionKind = Action['kind'];

/**
 * An event holds an ordered list of actions — or, for anything written before spec 7, a single
 * action standing on its own. Read both through `actionsOf`.
 */
export const EventHandlerSchema = z.union([
  z.object({ kind: z.literal('actions'), actions: z.array(ActionSchema) }),
  ActionSchema,
]);
export type EventHandler = z.infer<typeof EventHandlerSchema>;

/** The sequence an event runs, however it happens to be written down. */
export function actionsOf(handler: EventHandler): Action[] {
  return handler.kind === 'actions' ? handler.actions : [handler];
}

export const PropertyValueSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('static'), value: z.unknown() }),
  z.object({ kind: z.literal('bound'), source: PortRefSchema }),
  z.object({ kind: z.literal('event'), handler: EventHandlerSchema }),
  /** Reads one of the destination artboard's declared params (route data, not a node port). */
  z.object({ kind: z.literal('param'), name: z.string() }),
  /** Reads a field of the current row, inside a List's template (implicit map, docs/04). */
  z.object({ kind: z.literal('item'), field: z.string() }),
]);
export type PropertyValue = z.infer<typeof PropertyValueSchema>;

// ---------------------------------------------------------------------------
// Layout (flex-first, never absolute). Provisional v0 — full spec is #5.
// ---------------------------------------------------------------------------

export const SizeModeSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('hug') }),
  z.object({ mode: z.literal('fill') }),
  z.object({ mode: z.literal('fixed'), px: z.number() }),
]);
export type SizeMode = z.infer<typeof SizeModeSchema>;

/**
 * How a frame arranges what is inside it (`docs/12-canvas.md`).
 *
 * `stack` is auto layout: children follow one another along an axis, and the app reflows. `free`
 * is the drawing board: each child keeps the place it was put, and the frame emits
 * `position: relative` with absolutely placed children.
 *
 * Free is what a designer reaches for while composing, and it is honest about the cost — a screen
 * laid out freely does not reflow at another width. Any frame can be switched to `stack` to get
 * that back, which is why this is a per-frame mode rather than a decision for the whole product.
 */
export const LayoutModeSchema = z.enum(['stack', 'free']);
export type LayoutMode = z.infer<typeof LayoutModeSchema>;

export const LayoutSchema = z.object({
  /** Absent means `stack`: every document written before free placement existed reads as one. */
  mode: LayoutModeSchema.optional(),
  direction: z.enum(['row', 'column']),
  gap: z.number(),
  padding: z.number(),
  align: z.enum(['start', 'center', 'end', 'stretch']),
  justify: z.enum(['start', 'center', 'end', 'between']),
  size: z.object({ width: SizeModeSchema, height: SizeModeSchema }).optional(),
});
export type Layout = z.infer<typeof LayoutSchema>;

// ---------------------------------------------------------------------------
// AUTO provenance (M5) — nodes loom generated and keeps in sync
// ---------------------------------------------------------------------------

/**
 * Marks an entity as **AUTO**: generated by inference from a form, drawn dashed with a badge,
 * and regenerated while the form it was inferred from changes (`docs/06-glossary.md`).
 *
 * One inference run stamps every node and wire it materialises with the same `group`, so the
 * whole pipeline can be accepted, detached, or regenerated as one unit — a half-detached
 * pipeline would be a document nobody could reason about.
 *
 * `proposed` is awaiting the designer's Accept/Detach. `accepted` stays under loom's control.
 * **Detach removes the mark entirely** — an ownerless node is just a node the designer owns,
 * which is exactly what Detach means.
 */
export const AutoMarkSchema = z.object({
  group: IdSchema,
  state: z.enum(['proposed', 'accepted']),
  /** The component the pipeline was inferred from (the form's frame). */
  sourceId: IdSchema.optional(),
});
export type AutoMark = z.infer<typeof AutoMarkSchema>;

// ---------------------------------------------------------------------------
// Style (token-first; the design system's half of a component)
// ---------------------------------------------------------------------------

/**
 * One styled property. A **token** reference is the normal case and the whole point: the document
 * records the decision ("brand"), not the value, so moving the brand moves every surface built on
 * it (`docs/05-guardrails.md` 19-24). A literal is the escape hatch, deliberately more effort to
 * reach for than picking from the scale.
 */
export const StyleValueSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('token'), token: z.string() }),
  z.object({ kind: z.literal('literal'), value: z.string() }),
]);
export type StyleValue = z.infer<typeof StyleValueSchema>;

/**
 * The curated visual vocabulary. Small on purpose: every property here is one a designer reaches
 * for constantly, and anything beyond it belongs to a component kit rather than to loom's core
 * (`docs/02-system-architecture.md`).
 */
export const StyleSchema = z.object({
  background: StyleValueSchema.optional(),
  textColor: StyleValueSchema.optional(),
  fontSize: StyleValueSchema.optional(),
  fontWeight: StyleValueSchema.optional(),
  radius: StyleValueSchema.optional(),
  shadow: StyleValueSchema.optional(),
  borderColor: StyleValueSchema.optional(),
  /** Plain px. A border is one, two or none — a scale would be ceremony. */
  borderWidth: z.number().optional(),
  align: z.enum(['start', 'center', 'end']).optional(),
});
export type Style = z.infer<typeof StyleSchema>;

/** One conditional override: this style, merged over the base, while the condition holds. */
export const ConditionalStyleSchema = z.object({
  when: ConditionSchema,
  style: StyleSchema,
});
export type ConditionalStyle = z.infer<typeof ConditionalStyleSchema>;

// ---------------------------------------------------------------------------
// Design mode: components + artboards
// ---------------------------------------------------------------------------

/** A component is an instance of a property schema. `children` (frames only) holds ids. */
export const ComponentSchema = z.object({
  id: IdSchema,
  type: z.string(),
  name: z.string().optional(),
  props: z.record(z.string(), PropertyValueSchema),
  layout: LayoutSchema.optional(),
  style: StyleSchema.optional(),
  /** Where this sits inside a `free` parent. Ignored by a `stack` parent, which owns the order. */
  position: z.object({ x: z.number(), y: z.number() }).optional(),
  /** Absent means always rendered. False means not rendered at all — never `display: none`. */
  visibleWhen: ConditionSchema.optional(),
  /** Overrides merged over `style`, in order, for each condition that holds. */
  conditionalStyles: z.array(ConditionalStyleSchema).optional(),
  children: z.array(IdSchema).optional(),
});
export type Component = z.infer<typeof ComponentSchema>;

/** An input param an artboard declares for incoming flows (master->detail). */
export const ParamSchema = z.object({ name: z.string(), type: TypeRefSchema });
export type Param = z.infer<typeof ParamSchema>;

/**
 * The frame a screen is drawn at. **Editor intent, not a breakpoint** — V1 emits one flex layout
 * that adapts, and distinct mobile/tablet layouts are explicitly out of scope
 * (`docs/07-v1-scope.md`). Choosing "Phone" changes the canvas and the Preview width, so a
 * designer can see their screen at the size people will hold it; it changes no emitted CSS.
 */
export const ScreenSizeSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** The preset this came from, kept so the picker can show it as chosen rather than "Custom". */
  preset: z.string().optional(),
});
export type ScreenSize = z.infer<typeof ScreenSizeSchema>;

/**
 * "Only for signed-in people, and send everyone else there" (spec 10).
 *
 * A router-level convenience rather than a security boundary: the boundary is the server, which
 * answers every request as whoever is asking. This keeps a signed-out visitor from landing on a
 * screen built for someone else and seeing its empty shape.
 */
export const GuardSchema = z.object({ redirectTo: IdSchema });
export type Guard = z.infer<typeof GuardSchema>;

/**
 * The lines a designer lines things up against, in the screen's own pixels.
 *
 * In the document rather than in the editor's settings, because a guide is a decision about
 * *this composition* — it should still be there tomorrow, and for whoever opens the project next.
 * It emits nothing: the app has never heard of it.
 */
export const GuidesSchema = z.object({ x: z.array(z.number()), y: z.array(z.number()) });
export type Guides = z.infer<typeof GuidesSchema>;

export const ArtboardSchema = z.object({
  id: IdSchema,
  name: z.string(),
  root: IdSchema,
  params: z.array(ParamSchema).optional(),
  size: ScreenSizeSchema.optional(),
  /** Absent means anyone may open the screen. */
  guard: GuardSchema.optional(),
  guides: GuidesSchema.optional(),
});
export type Artboard = z.infer<typeof ArtboardSchema>;

// ---------------------------------------------------------------------------
// Nodes mode: nodes, ports, wires
// ---------------------------------------------------------------------------

export const PortSchema = z.object({
  id: IdSchema,
  name: z.string(),
  direction: z.enum(['in', 'out']),
  portKind: z.enum(['data', 'trigger']),
  type: TypeRefSchema,
});
export type Port = z.infer<typeof PortSchema>;

export const NodeCategorySchema = z.enum(['ui', 'fn', 'api', 'state', 'db']);
export type NodeCategory = z.infer<typeof NodeCategorySchema>;

export const NodeSchema = z.object({
  id: IdSchema,
  category: NodeCategorySchema,
  /** category-specific: fn kinds (validate/transform/compute/gate/query/mutation/guard/code), ui 'mirror', ... */
  kind: z.string(),
  name: z.string().optional(),
  ports: z.array(PortSchema),
  position: z.object({ x: z.number(), y: z.number() }),
  /** ui mirror nodes link back to the component they mirror. */
  mirrorOf: IdSchema.optional(),
  config: z.unknown().optional(),
  /** Present when loom generated this node by inference (M5). */
  auto: AutoMarkSchema.optional(),
});
export type Node = z.infer<typeof NodeSchema>;

export const WireSchema = z.object({
  id: IdSchema,
  from: PortRefSchema,
  to: PortRefSchema,
  /** Present when loom generated this wire by inference (M5). */
  auto: AutoMarkSchema.optional(),
});
export type Wire = z.infer<typeof WireSchema>;

// ---------------------------------------------------------------------------
// Navigation: flows (arrows between artboards)
// ---------------------------------------------------------------------------

/**
 * One value carried along a flow into a destination param. `static` is a literal chosen in the
 * editor; `bound` reads a backend node's output port and needs the binding runtime (M3).
 */
export const FlowPayloadSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('static'), param: z.string(), value: z.unknown() }),
  z.object({ kind: z.literal('bound'), param: z.string(), source: PortRefSchema }),
]);
export type FlowPayload = z.infer<typeof FlowPayloadSchema>;

export const FlowSchema = z.object({
  id: IdSchema,
  from: IdSchema,
  to: IdSchema,
  /** payload carried to the destination's declared params. */
  payload: z.array(FlowPayloadSchema).optional(),
  guard: IdSchema.optional(),
});
export type Flow = z.infer<typeof FlowSchema>;

// ---------------------------------------------------------------------------
// Connectors (config only; credentials are name-referenced, never inlined)
// ---------------------------------------------------------------------------

export const ConnectorInstanceSchema = z.object({
  id: IdSchema,
  moduleId: z.string(),
  config: z.unknown().optional(),
  /** NAME into the encrypted env bucket. NEVER the secret itself. */
  credentialRef: z.string().optional(),
});
export type ConnectorInstance = z.infer<typeof ConnectorInstanceSchema>;

// ---------------------------------------------------------------------------
// The snapshot root
// ---------------------------------------------------------------------------

export const SnapshotSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: IdSchema,
  name: z.string(),
  entryArtboard: IdSchema.optional(),
  /**
   * Token overrides for this project, keyed by token id (`color.brand`). Absent means loom's
   * defaults. One entry here restyles every component built on that token.
   */
  theme: z.record(z.string(), z.string()).optional(),
  artboards: z.record(z.string(), ArtboardSchema),
  components: z.record(z.string(), ComponentSchema),
  nodes: z.record(z.string(), NodeSchema),
  wires: z.record(z.string(), WireSchema),
  flows: z.record(z.string(), FlowSchema),
  connectors: z.record(z.string(), ConnectorInstanceSchema),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

// ---------------------------------------------------------------------------
// Serialization (validate on the way in AND out)
// ---------------------------------------------------------------------------

export function serializeSnapshot(snapshot: Snapshot): string {
  return JSON.stringify(SnapshotSchema.parse(snapshot));
}

export function deserializeSnapshot(json: string): Snapshot {
  return SnapshotSchema.parse(JSON.parse(json));
}
