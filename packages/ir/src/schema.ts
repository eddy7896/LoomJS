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

/**
 * Bumped to 2 by the V1 completion plan's IR wave (`docs/V1-COMPLETION.md` §5), which landed
 * every shape the remaining phases need in one go rather than churning the format twenty times.
 *
 * **Every addition is optional**, so a version-1 document is already a valid version-2 one — which
 * is why `migrateSnapshot` can carry one forward by stamping the number rather than rewriting
 * anything. Refusing a document loudly is the right answer to a change that loses data, and the
 * wrong answer to one that cannot.
 */
export const SCHEMA_VERSION = 3 as const;

/** Versions this build can still open. Anything older is refused, and says so.  */
export const READABLE_VERSIONS = [1, 2, 3] as const;

export const IdSchema = z.string().min(1);
export type Id = z.infer<typeof IdSchema>;

// ---------------------------------------------------------------------------
// Type vocabulary (curated; full TS lives only in emitted code)
// ---------------------------------------------------------------------------

export type TypeRef =
  | { kind: 'text' }
  | { kind: 'number' }
  /**
   * A number that is not a float. Money is the reason: `0.1 + 0.2` is not `0.3` in IEEE 754, and
   * a builder that stores an invoice total in a double has chosen that for everyone using it
   * (`docs/V1-COMPLETION.md` C8). `scale` is the digits kept after the point.
   */
  | { kind: 'decimal'; scale: number }
  /** A decimal that knows what it is denominated in. Two currencies never add. */
  | { kind: 'money'; currency: string }
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
    z.object({ kind: z.literal('decimal'), scale: z.number().int().min(0).max(20) }),
    z.object({ kind: z.literal('money'), currency: z.string().min(1) }),
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
  z.object({
    kind: z.literal('setVariable'),
    nodeId: IdSchema,
    value: ValueSourceSchema,
    ...withCondition,
  }),
  z.object({
    kind: z.literal('setField'),
    componentId: IdSchema,
    value: ValueSourceSchema,
    ...withCondition,
  }),
  /** Back to what it *started* as — a number field to its initial number, not to "". */
  z.object({ kind: z.literal('clearField'), componentId: IdSchema, ...withCondition }),
  z.object({
    kind: z.literal('message'),
    text: z.string(),
    tone: z.enum(['ok', 'error']).optional(),
    ...withCondition,
  }),
  z.object({ kind: z.literal('openUrl'), url: z.string(), ...withCondition }),
  /**
   * Hand the person a file (`docs/V1-COMPLETION.md` §4.5). The thirteenth, and it earns the slot
   * on spec 7's own terms: an export is started by a click, produces no value anything downstream
   * reads, and navigates nowhere — every property of an action and none of a node. A node whose
   * output nothing consumes is the shape of a mistake.
   *
   * `csv` takes the rows to write, so `value` is required for it and the compiler refuses one
   * without it. `pdf` **prints the screen the person is on**, so it takes nothing: getting to the
   * invoice is what `navigate` is for, and it already carries the params. A second mechanism for
   * "which document, with what data" would be the same decision made twice.
   */
  z.object({
    kind: z.literal('download'),
    value: ValueSourceSchema.optional(),
    format: z.enum(['csv', 'pdf']),
    /** What the file is called, without the extension. */
    filename: z.string().optional(),
    ...withCondition,
  }),
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
  /**
   * Sign in through a provider (A2). It carries a **name**, never a credential: the client id and
   * secret live in the Supabase project, configured by whoever owns it.
   *
   * Unlike the other two this one *leaves the page* — OAuth is a redirect — so nothing can follow
   * it in a sequence, and the compiler says so rather than emitting steps that never run.
   */
  z.object({
    kind: z.literal('signInWith'),
    provider: z.string(),
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

/**
 * The two widths a layout may differ at (`docs/V1-COMPLETION.md` L3).
 *
 * **Two, and deliberately not a breakpoint system.** The base is the layout; `sm` is what it
 * becomes on a phone. Every builder that offered five breakpoints taught its users to maintain
 * five layouts, and the flex-first default already handles most of the range on its own — this is
 * for the cases where a row genuinely has to become a column.
 */
export const BreakpointSchema = z.enum(['sm']);
export type Breakpoint = z.infer<typeof BreakpointSchema>;

const LayoutBaseSchema = z.object({
  /** Absent means `stack`: every document written before free placement existed reads as one. */
  mode: LayoutModeSchema.optional(),
  direction: z.enum(['row', 'column']),
  gap: z.number(),
  padding: z.number(),
  align: z.enum(['start', 'center', 'end', 'stretch']),
  justify: z.enum(['start', 'center', 'end', 'between']),
  size: z.object({ width: SizeModeSchema, height: SizeModeSchema }).optional(),
});

/**
 * One flat override level, never a nested one: a `sm` layout cannot itself carry a `sm`. Depth
 * here would buy nothing and cost a document nobody could reason about.
 */
export const LayoutSchema = LayoutBaseSchema.extend({
  responsive: z.object({ sm: LayoutBaseSchema.partial().optional() }).optional(),
});
export type Layout = z.infer<typeof LayoutSchema>;

/**
 * The layout a component gets when it needs one and has none.
 *
 * A leaf element carries a layout as soon as it carries a size — a Shape or a Table is not a
 * container and has one — so this is what "give it a box" starts from. `@loom/components` builds
 * its own defaults on top of this rather than beside it, so there is one answer to what a fresh
 * layout is.
 */
export const DEFAULT_LAYOUT: Layout = {
  direction: 'column',
  gap: 16,
  padding: 16,
  align: 'stretch',
  justify: 'start',
};

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
 * An effect on a surface.
 *
 * These are **compositions**, not raw CSS: "glass" is a backdrop blur, a translucent tint and a
 * hairline together, because that is the thing a designer means by it. Each one emits plain CSS
 * that a developer opening the repo would recognise, and nothing here needs a runtime.
 *
 * Several may stack — two shadows, or a blur under a noise — and they emit in the order they are
 * listed, which is the order the panel shows them in.
 */
export const EffectSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('shadow'),
    x: z.number(),
    y: z.number(),
    blur: z.number(),
    spread: z.number(),
    /** Any CSS colour, usually with alpha — a shadow is rarely a flat token. */
    color: z.string(),
    /** Inner shadows are the same property with one word added. */
    inset: z.boolean().optional(),
  }),
  /** The layer itself, blurred. */
  z.object({ kind: z.literal('blur'), radius: z.number() }),
  /**
   * Frosted glass: what is *behind* the layer is blurred, and the layer holds a translucent tint
   * over it. Needs something behind it to be worth anything, which the panel says.
   */
  z.object({
    kind: z.literal('glass'),
    blur: z.number(),
    tint: z.string(),
    /** 0-100, how much of the tint sits over the blur. */
    opacity: z.number().min(0).max(100),
  }),
  /**
   * A grain overlay, drawn by the browser from an SVG filter rather than shipped as an image —
   * no asset, no request, and it scales with the box.
   */
  z.object({
    kind: z.literal('noise'),
    opacity: z.number().min(0).max(100),
    /** Higher is finer grain. */
    scale: z.number(),
  }),
]);
export type Effect = z.infer<typeof EffectSchema>;

/**
 * The curated visual vocabulary. Small on purpose: every property here is one a designer reaches
 * for constantly, and anything beyond it belongs to a component kit rather than to loom's core
 * (`docs/02-system-architecture.md`).
 */
const StyleBaseSchema = z.object({
  background: StyleValueSchema.optional(),
  textColor: StyleValueSchema.optional(),
  fontSize: StyleValueSchema.optional(),
  fontWeight: StyleValueSchema.optional(),
  /**
   * Corner rounding. A token names a decision in the system; a literal carries any CSS the box
   * accepts, including four different corners — `12px 12px 0 0` is one value, not four fields.
   */
  radius: StyleValueSchema.optional(),
  /** The shadow token, kept for every document written before `effects` existed. */
  shadow: StyleValueSchema.optional(),
  /** Shadows, blurs, glass and grain, in the order they are drawn. */
  effects: z.array(EffectSchema).optional(),
  borderColor: StyleValueSchema.optional(),
  /** Plain px. A border is one, two or none — a scale would be ceremony. */
  borderWidth: z.number().optional(),
  align: z.enum(['start', 'center', 'end']).optional(),

  /**
   * The properties a designer expects to reach for on any object, which are *not* design-system
   * decisions: how see-through a thing is, which way round it faces, and whether it crops what it
   * holds. A token scale for "37% opacity" would be ceremony — these are per-object choices, and
   * they emit plain CSS a developer would recognise.
   */
  opacity: z.number().min(0).max(100).optional(),
  /** Degrees, clockwise. Emitted as a transform, so it never disturbs the layout around it. */
  rotation: z.number().optional(),
  flipX: z.boolean().optional(),
  flipY: z.boolean().optional(),
  /** A frame that crops what overflows it. */
  clip: z.boolean().optional(),
});

/** The same one flat override level a layout gets, for the same reason. */
export const StyleSchema = StyleBaseSchema.extend({
  responsive: z.object({ sm: StyleBaseSchema.optional() }).optional(),
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
export const GuardSchema = z.object({
  redirectTo: IdSchema,
  /**
   * "Only for these roles" (`docs/V1-COMPLETION.md` O2). Absent means any signed-in person.
   *
   * Like the guard it sits on, this is a router-level convenience and **not** the security
   * boundary — the boundary is the row-level-security policy the project emits (O3). A client can
   * always ask; what it gets back is the database's decision, not this one's.
   */
  requireRole: z.array(z.string()).nonempty().optional(),
});
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

/**
 * What a search engine and a social card are told about a screen (`docs/V1-COMPLETION.md` L4).
 *
 * **Static, in V1.** A bound title — "Invoice #123" — would need the route's own data before the
 * page renders, which is the server-rendering question this deliberately does not open. Saying so
 * is better than a `meta` field that silently only works when the value is a literal.
 */
export const MetaSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  /** An absolute URL to the card image. */
  image: z.string().optional(),
});
export type Meta = z.infer<typeof MetaSchema>;

/**
 * What an artboard *is*.
 *
 * A `screen` is a route in the app. A `document` is a page meant for paper — an invoice, a report
 * card, a statement — laid out at a page size with margins, and reached by printing rather than by
 * navigating. Absent means `screen`, so every project written before this reads as one.
 */
export const ArtboardKindSchema = z.enum(['screen', 'document']);
export type ArtboardKind = z.infer<typeof ArtboardKindSchema>;

/** A paper size, in millimetres, plus how much of it stays empty. */
export const PageSchema = z.object({
  preset: z.enum(['a4', 'letter', 'legal', 'a5']).optional(),
  width: z.number().positive(),
  height: z.number().positive(),
  orientation: z.enum(['portrait', 'landscape']).optional(),
  margin: z.number().min(0),
});
export type Page = z.infer<typeof PageSchema>;

export const ArtboardSchema = z.object({
  id: IdSchema,
  name: z.string(),
  root: IdSchema,
  params: z.array(ParamSchema).optional(),
  size: ScreenSizeSchema.optional(),
  /** Absent means anyone may open the screen. */
  guard: GuardSchema.optional(),
  guides: GuidesSchema.optional(),
  /** Absent means `screen`. */
  kind: ArtboardKindSchema.optional(),
  /** Required when `kind` is `document`; meaningless otherwise. */
  page: PageSchema.optional(),
  /**
   * The shell this screen renders inside (R2). Absent means it is the whole page.
   *
   * Points at a **component definition** — one that happens to contain a screen slot. A shell used
   * to be its own kind of thing, and it was the same three fields with a different name.
   */
  shellId: IdSchema.optional(),
  /**
   * Crawlable without a session (L4). A public route is prerendered to real HTML at build time;
   * a private one stays behind the app shell. Absent means private, because the safe default for
   * "should a stranger see this" is no.
   */
  public: z.boolean().optional(),
  meta: MetaSchema.optional(),
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

/**
 * `tool` is the fifth, and it was added rather than squeezed into `db` (T1,
 * `docs/22-api-connectors.md`).
 *
 * A tool call is not a database read: it has no table, no row and no schema, and calling it one
 * would make every rule about tables mean two things. What it shares with `db` is where it runs —
 * inside an API route, on the server, because the credential must not reach a browser.
 */
/**
 * `event` is the seventh, and it answers a different question from the other six.
 *
 * The rest say what a node *does*. This one says **who starts it**: a realtime subscription, an
 * inbound webhook and a schedule are all things the outside world begins, rather than things
 * something upstream fires. That is the first thing a reader needs to know about a graph they did
 * not draw, so it earns a category rather than three `fn` kinds.
 *
 * It carries a rule, which is what makes it a category and not a label: **an `event` node has no
 * data `in` ports.** It is a source. A fourth kind has to satisfy that or it does not belong here.
 */
export const NodeCategorySchema = z.enum(['ui', 'fn', 'api', 'state', 'db', 'tool', 'event']);
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
// Node groups (G2) — editor metadata, never emitted
// ---------------------------------------------------------------------------

/**
 * A named box drawn around some nodes (`docs/16-grouping.md`).
 *
 * Purely how the graph is *read*: "these four are the sign-up flow". It changes nothing about what
 * runs, and the compiler never looks at it — the thing that already groups nodes for execution is
 * an API route's body, and this is deliberately not that.
 *
 * It lives in the document rather than in the browser because it is a fact about the project that
 * a colleague opening it should see, not a preference like which panels are collapsed.
 */
export const NodeGroupSchema = z.object({
  id: IdSchema,
  title: z.string(),
  /** Members, by node id. A group whose nodes are all gone is dropped with them. */
  nodeIds: z.array(IdSchema),
});
export type NodeGroup = z.infer<typeof NodeGroupSchema>;

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

/**
 * One schema change that was applied, kept so the repo can carry it (`docs/15-schema.md`).
 *
 * The studio makes schema changes against a live database, which is fine while one person is
 * designing and useless the moment there is a second environment. So every change is *also*
 * recorded here and emitted as a numbered `.sql` file the user owns — the same statements, in the
 * same order, runnable against a database that has never seen this project.
 *
 * It records what *was run*, not what should be: a migration whose statements were edited
 * afterwards would describe a schema nobody has.
 */
export const MigrationSchema = z.object({
  id: IdSchema,
  /** Sequence number, from 1, in the order they were applied. */
  index: z.number().int().positive(),
  /** What it did, in the words the panel used — becomes the filename and the comment. */
  description: z.string(),
  /** ISO 8601, so an ordering survives a merge between two people's work. */
  appliedAt: z.string(),
  /** Exactly what ran, in order. */
  statements: z.array(z.string()),
});
export type Migration = z.infer<typeof MigrationSchema>;

// ---------------------------------------------------------------------------
// Reusable components, and the shells that are one of them (R1, R2)
// ---------------------------------------------------------------------------

/**
 * A component defined once and placed many times (`docs/V1-COMPLETION.md` R1) — and, when it holds
 * a screen slot, the shell a set of screens render inside (R2).
 *
 * **These were two concepts and are now one**, because the second was the first with a different
 * name: `LayoutDefinition` was `{ id, name, root }` and this is that plus params. What made a
 * shell a shell was never its shape, it was the `Outlet` in its tree — so that is what decides it
 * now, and a definition holding one is used as a shell rather than placed as an instance.
 *
 *
 * `root` is a subtree that lives in `components` like any other, and is not on any artboard — the
 * definition is the thing, the instances are references to it. `params` are the only way in: an
 * instance may override those and nothing else, which is exactly the boundary that makes this a
 * component rather than a group somebody copied. Wiring into a definition's internals from outside
 * would make every instance's behaviour depend on where it happened to be placed.
 */
export const ComponentDefinitionSchema = z.object({
  id: IdSchema,
  name: z.string(),
  root: IdSchema,
  params: z.array(ParamSchema).optional(),
});
export type ComponentDefinition = z.infer<typeof ComponentDefinitionSchema>;

// ---------------------------------------------------------------------------
// Tenancy (O1) — who the rows belong to
// ---------------------------------------------------------------------------

/**
 * How this project knows which organisation a row belongs to (`docs/V1-COMPLETION.md` O1).
 *
 * loom does not invent a tenancy model or keep one of its own: it **names the tables the project
 * already has**, so the generated app and the emitted row-level-security policies agree about
 * where to look. That is the same rule the connectors follow everywhere else — map what is there
 * rather than wrap it.
 *
 * Absent means a single-tenant app, which is most of them.
 */
export const TenancySchema = z.object({
  /** The organisations themselves. */
  orgTable: z.string().min(1),
  /** Which people belong to which organisation, and as what. */
  membershipTable: z.string().min(1),
  /** The column on every tenanted table naming its owner. */
  tenantColumn: z.string().min(1),
  /** The column on the membership row holding the role. */
  roleColumn: z.string().min(1).optional(),
});
export type Tenancy = z.infer<typeof TenancySchema>;

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
  /**
   * Components defined once and instanced (R1). Their `root` subtrees live in `components` above,
   * reachable from here rather than from any artboard.
   */
  definitions: z.record(z.string(), ComponentDefinitionSchema).optional(),

  /**
   * The role names this app knows (O2). An option set and nothing more: "admin", "teacher".
   *
   * Deliberately not a permission model. What a role may *do* is decided by the row-level-security
   * policies the project emits and by the conditions on its own canvas — a second place that also
   * decided it is how an authorization bug gets a hiding place.
   */
  roles: z.array(z.string()).optional(),
  /** How rows are scoped to an organisation (O1). Absent means single-tenant. */
  tenancy: TenancySchema.optional(),
  nodes: z.record(z.string(), NodeSchema),
  wires: z.record(z.string(), WireSchema),
  flows: z.record(z.string(), FlowSchema),
  connectors: z.record(z.string(), ConnectorInstanceSchema),
  /**
   * Schema changes this project has made, oldest first. Absent in a project that has never
   * changed a schema, which is most of them.
   */
  migrations: z.array(MigrationSchema).optional(),
  /** Named boxes drawn around nodes. Editor metadata: nothing here reaches the emitted app. */
  nodeGroups: z.record(z.string(), NodeGroupSchema).optional(),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

// ---------------------------------------------------------------------------
// Serialization (validate on the way in AND out)
// ---------------------------------------------------------------------------

export function serializeSnapshot(snapshot: Snapshot): string {
  return JSON.stringify(SnapshotSchema.parse(snapshot));
}

export function deserializeSnapshot(json: string): Snapshot {
  return SnapshotSchema.parse(migrateSnapshot(JSON.parse(json)));
}

/**
 * Carry an older document forward to the current version.
 *
 * P0 promised a version guard that "either migrates or refuses loudly," and until now there was
 * only ever one version, so only the refusing half existed. This is the other half.
 *
 * **1 → 2** is a stamp and nothing else. Every field the IR wave added is optional
 * (`docs/V1-COMPLETION.md` §5), so a version-1 document already satisfies the version-2 schema —
 * there is no data to move, no default to invent, and inventing one would be the bug. Anything
 * this does not recognise is returned untouched, and `SnapshotSchema.parse` refuses it by name
 * rather than this function guessing.
 */
export function migrateSnapshot(document: unknown): unknown {
  if (typeof document !== 'object' || document === null) return document;

  let next = document as Record<string, unknown>;
  const version = next.schemaVersion;
  if (typeof version !== 'number' || version < 1 || version >= SCHEMA_VERSION) return document;

  /**
   * **1 → 2** is a stamp and nothing else. Every field the IR wave added is optional
   * (`docs/V1-COMPLETION.md` §5), so a version-1 document already satisfies the version-2 schema —
   * there is no data to move, and inventing a default would be the bug.
   */
  if (version < 2) next = { ...next, schemaVersion: 2 };

  /**
   * **2 → 3** merges shells into components, and this one does move data.
   *
   * A shell was `{ id, name, root }` and a component definition is that plus params, so every
   * layout becomes a definition and every screen's `layoutId` becomes a `shellId` pointing at it.
   * Nothing is lost: what made a shell a shell was the `Outlet` in its tree, which is still there.
   */
  if (version < 3) {
    next = { ...next, schemaVersion: 3 };

    // Only touch what is actually there. A document with no shells should come back byte-for-byte
    // what it was, plus a number — inventing an empty `definitions` key would make a stamp look
    // like a rewrite in every diff and every round-trip test.
    const layouts = next.layouts as Record<string, unknown> | undefined;
    if (layouts && Object.keys(layouts).length > 0) {
      next.definitions = { ...((next.definitions ?? {}) as Record<string, unknown>), ...layouts };
    }
    delete next.layouts;

    const artboards = (next.artboards ?? {}) as Record<string, Record<string, unknown>>;
    if (Object.values(artboards).some((artboard) => artboard.layoutId)) {
      next.artboards = Object.fromEntries(
        Object.entries(artboards).map(([id, artboard]) => {
          if (!artboard.layoutId) return [id, artboard];
          const { layoutId, ...rest } = artboard;
          return [id, { ...rest, shellId: layoutId }];
        }),
      );
    }
  }

  return next;
}

/** Can this build open a document of that version at all? */
export function canOpenVersion(version: unknown): version is (typeof READABLE_VERSIONS)[number] {
  return READABLE_VERSIONS.includes(version as (typeof READABLE_VERSIONS)[number]);
}
