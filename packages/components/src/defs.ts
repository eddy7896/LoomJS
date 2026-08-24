import type { Component, Layout, Port, PropertyValue, TypeRef } from '@loom/ir';
import { ICON_NAMES } from './icons';
import type { VariantAxis } from './variants';

/**
 * The component vocabulary: one definition per component type, shared by the studio
 * (palette + schema-driven inspector) and read alongside the compiler's code templates.
 * The definition describes *authoring*; the compiler template describes *emission*.
 * Keep the two in step — a type with a definition and no template is a build error.
 */

export type FieldControl = 'text' | 'number' | 'select' | 'boolean';

export interface FieldDef {
  key: string;
  label: string;
  control: FieldControl;
  /** `select` only. */
  options?: readonly string[];
  /** Used when the component is created. */
  default: string | number | boolean;
}

/**
 * Where a component sits in the palette. Editor metadata: it groups the sidebar and never reaches
 * the emitted app (`docs/11-editor-shell.md`).
 */
export type ComponentCategory = 'visual' | 'media' | 'chart' | 'container' | 'input';

/** The order the palette draws them, and what each section is called. */
export const COMPONENT_CATEGORIES: readonly { id: ComponentCategory; label: string }[] = [
  { id: 'visual', label: 'Visual elements' },
  { id: 'media', label: 'Media' },
  { id: 'chart', label: 'Charts' },
  { id: 'container', label: 'Containers' },
  { id: 'input', label: 'Input forms' },
];

/**
 * One port an element exposes when it is mirrored into Nodes mode.
 *
 * `propKey` is the whole reason this type exists. The bridge between the two modes is that drawing
 * a data wire into a mirror's `in` port writes a binding onto the real component
 * (`apps/studio/src/state/graph.ts`) — and until this field existed, the key it wrote was the
 * *port's name*. Two elements had already drifted: an Image's port was called `source` while its
 * emitter read `src`, and a Link's was called `address` while its emitter read `href`, so wiring
 * either one set a property nothing rendered. The port name belongs to the person reading the
 * graph; the prop key belongs to the emitter; they are not the same string and pretending they
 * were cost two silent bugs.
 */
export interface MirrorPort extends Port {
  /** The component property this port binds. Not the port's name — see above. */
  propKey: string;
}

/**
 * An element's face in Nodes mode: what it can send, what it can receive, and where its value
 * lives (`docs/V1-COMPLETION.md` §3).
 *
 * Three separate lists used to answer these questions — a switch for the ports, a set for the
 * field state, a boolean for the per-row rendering — and nothing kept them in agreement. Charts
 * declared they rendered per row and had no port to receive rows; upload fields held state the
 * studio did not know about. One declaration, beside the element it describes, is the fix.
 */
export interface NodeFace {
  /**
   * Ports this element exposes, derived from its **static props**, so a Select types its port as
   * an enum of the options someone actually typed rather than as bare text.
   */
  ports: (props: Record<string, unknown>) => readonly MirrorPort[];
  /** Its value lives in local state in the emitted app — the inputs, and the upload fields. */
  fieldState?: boolean;
  /** It renders its template once per row of a bound list. */
  perRow?: boolean;
}

const mirrorPort = (
  id: string,
  name: string,
  propKey: string,
  direction: Port['direction'],
  portKind: Port['portKind'],
  type: TypeRef,
): MirrorPort => ({ id, name, propKey, direction, portKind, type });

/** A value the element receives — the binding target. */
const takes = (id: string, name: string, propKey: string, type: TypeRef): MirrorPort =>
  mirrorPort(id, name, propKey, 'in', 'data', type);

/** A value the element produces — what someone typed, picked or uploaded. */
const gives = (id: string, name: string, propKey: string, type: TypeRef): MirrorPort =>
  mirrorPort(id, name, propKey, 'out', 'data', type);

/** Something that happened to the element, which a pipeline can hang off. */
const fires = (id: string, name: string, propKey: string): MirrorPort =>
  mirrorPort(id, name, propKey, 'out', 'trigger', { kind: 'trigger' });

/** Rows in. The one shape a List, a Table, a chart, a calendar and a chat all share. */
const takesRows = (): readonly MirrorPort[] => [
  takes('pt_items', 'items', 'items', { kind: 'list', of: { kind: 'record' } }),
];

/** An address in — every media element receives one, and every one of them reads `src`. */
const takesSource = (): readonly MirrorPort[] => [
  takes('pt_src', 'source', 'src', { kind: 'text' }),
];

/**
 * A chosen value out, typed by the options when there are any.
 *
 * A Select whose options are "Draft, Sent, Paid" produces one of exactly those three, and saying
 * so is what lets the checker refuse wiring it somewhere that wants a number. Falling back to
 * `text` when the options are bound or empty is honest rather than lossy: the type is genuinely
 * unknown until the app runs.
 */
const givesChoice = (props: Record<string, unknown>): readonly MirrorPort[] => {
  const raw = typeof props.options === 'string' ? props.options : '';
  const values = raw
    .split(',')
    .map((option) => option.trim())
    .filter(Boolean);
  return [
    gives(
      'pt_value',
      'value',
      'value',
      values.length > 0 ? { kind: 'enum', values } : { kind: 'text' },
    ),
  ];
};

export interface ComponentDef {
  type: string;
  label: string;
  category: ComponentCategory;
  /**
   * What this element is in Nodes mode. **Required**, and `null` is a real answer — a Shape is
   * decoration and genuinely has nothing to send. Making it required is the point: an element
   * added without answering the question is the defect this field was introduced to end, so the
   * absence has to be a type error rather than an empty switch case nobody notices.
   */
  node: NodeFace | null;
  /**
   * Words someone might search for that are not in the label — the names this control has in
   * other tools. "Dropdown" has to find Select, or the palette only helps people who already know
   * loom's vocabulary.
   */
  keywords?: readonly string[];
  /** Containers own a layout and accept children. */
  isContainer: boolean;
  /** Property schema — the inspector renders straight off this. */
  fields: readonly FieldDef[];
  /**
   * The design choices this element offers (`docs/27-variants.md`).
   *
   * Kept apart from `fields` deliberately: a field is data the app reads at run time and can be
   * wired to a node port, and an axis is a decision settled before the app runs. Mixing them would
   * have put "Style: solid" in the node graph as a port nobody would ever wire.
   */
  variants?: readonly VariantAxis[];
  /** True when the type can start a flow from a click (its `onClick` accepts a navigate handler). */
  acceptsClickFlow?: boolean;
  defaultLayout?: Layout;
  /**
   * A fixed starting size, in px, for a type with no content to size itself from. Drawing the
   * element replaces it with what was drawn (`docs/12-canvas.md`).
   */
  defaultSize?: { width: number; height: number };
}

export { DEFAULT_LAYOUT } from '@loom/ir';
import { DEFAULT_LAYOUT } from '@loom/ir';

/**
 * The size scale, shared by buttons and fields.
 *
 * One scale rather than two: a field and the button beside it have to line up, and they only do
 * that if `md` means the same height in both.
 */
const SIZE_AXIS: VariantAxis = {
  key: 'size',
  label: 'Size',
  options: ['sm', 'md', 'lg'],
  default: 'md',
};

/** The three shapes every design system converges on for a control that holds a value. */
const FIELD_STYLE_AXIS: VariantAxis = {
  key: 'variant',
  label: 'Style',
  options: ['outline', 'filled', 'underline'],
  default: 'outline',
};

export const FRAME_DEF: ComponentDef = {
  type: 'Frame',
  node: null, // Structure. A frame arranges what is inside it and has nothing of its own to send.
  label: 'Frame',
  category: 'container',
  keywords: ['group', 'div', 'box', 'stack', 'container'],
  isContainer: true,
  fields: [],
  // Plain stays plain: a layout box that suddenly grew a border would change every project that
  // already had one, and a frame is the element people use structurally.
  variants: [
    {
      key: 'variant',
      label: 'Surface',
      options: ['plain', 'card', 'panel', 'section'],
      default: 'plain',
    },
  ],
  defaultLayout: DEFAULT_LAYOUT,
};

/**
 * Button is the leaf that starts a flow: its `onClick` holds an event handler, which the
 * inspector edits as "navigate to <artboard>" rather than as a raw property.
 */
export const BUTTON_DEF: ComponentDef = {
  type: 'Button',
  node: { ports: () => [fires('pt_click', 'onClick', 'onClick')] },
  label: 'Button',
  category: 'visual',
  keywords: ['click', 'submit', 'action'],
  isContainer: false,
  fields: [{ key: 'label', label: 'Label', control: 'text', default: 'Button' }],
  // `solid` leads because the most common button on a screen is the one that does the thing, and
  // `destructive` is a variant rather than a colour someone types because "this deletes something"
  // is a meaning, and meanings belong in the vocabulary.
  variants: [
    {
      key: 'variant',
      label: 'Style',
      options: ['solid', 'soft', 'outline', 'ghost', 'destructive', 'link'],
      default: 'solid',
    },
    SIZE_AXIS,
  ],
  acceptsClickFlow: true,
};

export const TEXT_DEF: ComponentDef = {
  type: 'Text',
  node: { ports: () => [takes('pt_content', 'content', 'content', { kind: 'any' })] },
  label: 'Text',
  category: 'visual',
  keywords: ['label', 'paragraph', 'heading', 'copy'],
  isContainer: false,
  fields: [{ key: 'content', label: 'Content', control: 'text', default: 'Text' }],
  // The type scale, applied by name. Setting a size by hand still works and still wins.
  variants: [
    {
      key: 'variant',
      label: 'Style',
      options: ['body', 'display', 'title', 'subhead', 'caption', 'code', 'quote'],
      default: 'body',
    },
  ],
};

/** The layout fields the inspector shows for any container. */
export const LAYOUT_FIELDS: readonly FieldDef[] = [
  {
    key: 'direction',
    label: 'Direction',
    control: 'select',
    options: ['column', 'row'],
    default: 'column',
  },
  { key: 'gap', label: 'Gap', control: 'number', default: 16 },
  { key: 'padding', label: 'Padding', control: 'number', default: 16 },
  {
    key: 'align',
    label: 'Align',
    control: 'select',
    options: ['start', 'center', 'end', 'stretch'],
    default: 'stretch',
  },
  {
    key: 'justify',
    label: 'Justify',
    control: 'select',
    options: ['start', 'center', 'end', 'between'],
    default: 'start',
  },
];

/** A text input: the usual source of data flowing into a pipeline (spec 4). */
export const TEXT_FIELD_DEF: ComponentDef = {
  type: 'TextField',
  node: { ports: () => [gives('pt_value', 'value', 'value', { kind: 'text' })], fieldState: true },
  label: 'Text field',
  category: 'input',
  keywords: ['input', 'textbox', 'string'],
  isContainer: false,
  fields: [
    { key: 'value', label: 'Value', control: 'text', default: '' },
    { key: 'placeholder', label: 'Placeholder', control: 'text', default: 'Type here' },
  ],
  variants: [FIELD_STYLE_AXIS, SIZE_AXIS],
};

/**
 * A List renders its first child once per row of the data bound to `items` — the implicit map
 * (`04-hallucination-check.md`: loops are never nodes). Inside that template, a property can read
 * a field of the current row.
 */
export const LIST_DEF: ComponentDef = {
  type: 'List',
  node: { ports: takesRows, perRow: true },
  label: 'List',
  category: 'container',
  keywords: ['repeating group', 'rows', 'each', 'loop'],
  isContainer: true,
  fields: [
    { key: 'empty', label: 'Empty text', control: 'text', default: 'Nothing yet' },
    // 0 means "all of them". Paging what was fetched, not what exists — a server-side page needs
    // an offset the caller supplies, which is the same gap a flow payload has (`docs/11`).
    { key: 'pageSize', label: 'Rows per page', control: 'number', default: 0 },
  ],
  variants: [
    { key: 'variant', label: 'Rows', options: ['plain', 'divided', 'cards'], default: 'plain' },
  ],
  defaultLayout: { direction: 'column', gap: 8, padding: 0, align: 'stretch', justify: 'start' },
};

/** A number input. Its state is a number, so a numeric column takes it without a cast. */
export const NUMBER_FIELD_DEF: ComponentDef = {
  type: 'NumberField',
  node: {
    ports: () => [gives('pt_value', 'value', 'value', { kind: 'number' })],
    fieldState: true,
  },
  label: 'Number field',
  category: 'input',
  keywords: ['number', 'numeric', 'quantity', 'amount'],
  isContainer: false,
  fields: [
    { key: 'value', label: 'Value', control: 'number', default: 0 },
    { key: 'placeholder', label: 'Placeholder', control: 'text', default: '0' },
  ],
  variants: [FIELD_STYLE_AXIS, SIZE_AXIS],
};

/** A checkbox: the one component whose value is a boolean, and the source of most Gate inputs. */
export const CHECKBOX_DEF: ComponentDef = {
  type: 'Checkbox',
  node: {
    ports: () => [gives('pt_value', 'checked', 'value', { kind: 'boolean' })],
    fieldState: true,
  },
  label: 'Checkbox',
  category: 'input',
  keywords: ['boolean', 'toggle', 'switch', 'tick'],
  isContainer: false,
  fields: [
    { key: 'label', label: 'Label', control: 'text', default: 'Yes' },
    { key: 'value', label: 'Checked', control: 'boolean', default: false },
  ],
  // A switch is the same state wearing the shape people expect for "on or off, right now" as
  // opposed to "tick this to agree". It stays a checkbox to a screen reader, which is the point.
  variants: [
    { key: 'variant', label: 'Style', options: ['box', 'switch'], default: 'box' },
    SIZE_AXIS,
  ],
};

/**
 * A select. Its options are a comma-separated list, and its port stays `text`: typing the port
 * as an `enum` of those options needs the mirror to see the component's config, which is a wider
 * change than this vocabulary needs today.
 */
export const SELECT_DEF: ComponentDef = {
  type: 'Select',
  node: { ports: givesChoice, fieldState: true },
  label: 'Select',
  category: 'input',
  keywords: ['dropdown', 'options', 'picker', 'choice'],
  isContainer: false,
  fields: [
    { key: 'options', label: 'Options', control: 'text', default: 'One, Two' },
    { key: 'value', label: 'Value', control: 'text', default: '' },
  ],
  variants: [FIELD_STYLE_AXIS, SIZE_AXIS],
};

/**
 * An image. There was no way to put a picture on a screen at all — a hole rather than a gap.
 *
 * `alt` is a first-class field, not an afterthought: an `<img>` with no alt text is the single
 * most common accessibility failure on the web, and a builder that makes it easy to omit is a
 * builder that produces inaccessible apps by default.
 */
export const IMAGE_DEF: ComponentDef = {
  type: 'Image',
  node: { ports: () => takesSource() }, // `src`, not `source` — see MirrorPort.
  label: 'Image',
  category: 'visual',
  keywords: ['picture', 'photo', 'img', 'graphic', 'logo'],
  isContainer: false,
  fields: [
    { key: 'src', label: 'Source', control: 'text', default: '' },
    { key: 'alt', label: 'Alt text', control: 'text', default: '' },
  ],
  variants: [
    {
      key: 'variant',
      label: 'Shape',
      options: ['plain', 'rounded', 'circle', 'thumb'],
      default: 'plain',
    },
  ],
};

/**
 * A shape — rectangle, ellipse or line (`docs/12-canvas.md`).
 *
 * The vector primitives, as a **real element**: it sits in the tree, takes layout, conditions and
 * bindings like everything else, and emits inline SVG with no runtime and no asset pipeline. A
 * shape is something the app contains, not a decoration the editor invented.
 *
 * Fill and stroke name design tokens rather than colours, for the same reason every other styled
 * property does: restyling the project is a change in one place (`docs/06-glossary.md`).
 */
export const SHAPE_KINDS = ['rectangle', 'ellipse', 'line'] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

export const SHAPE_DEF: ComponentDef = {
  type: 'Shape',
  node: null, // Decoration. A rectangle carries no value and receives none.
  label: 'Shape',
  category: 'visual',
  keywords: ['rectangle', 'square', 'ellipse', 'circle', 'oval', 'line', 'vector', 'draw', 'box'],
  isContainer: false,
  // Fill, stroke and corner radius are the **style** system every other element already uses:
  // `background` is the fill, `borderColor` and `borderWidth` are the stroke, `radius` rounds the
  // corners. A second colour vocabulary here would mean two places to restyle a project.
  fields: [
    { key: 'shape', label: 'Shape', control: 'select', options: SHAPE_KINDS, default: 'rectangle' },
  ],
  // A shape with nothing drawn is nothing at all, so it arrives with a size. Everything else in
  // the vocabulary hugs its content; a shape has no content to hug.
  defaultSize: { width: 160, height: 120 },
};

/**
 * A real link. `navigate` on a Button is a `<div>` that moves the page: not right-clickable, not
 * middle-clickable, not crawlable, and reachable by keyboard only because the button is. This
 * emits an anchor — `<Link>` when it points at a screen, `<a>` when it points at an address.
 */
export const LINK_DEF: ComponentDef = {
  type: 'Link',
  node: { ports: () => [takes('pt_href', 'address', 'href', { kind: 'text' })] }, // `href`, not `address`: the emitter reads the former.
  label: 'Link',
  category: 'visual',
  keywords: ['anchor', 'href', 'url', 'hyperlink'],
  isContainer: false,
  acceptsClickFlow: true,
  fields: [
    { key: 'label', label: 'Label', control: 'text', default: 'Link' },
    // A placeholder rather than empty: a freshly placed element must compile, the same rule an
    // action follows when it is added already pointing at something real (`specs/actions.md`).
    { key: 'href', label: 'Address', control: 'text', default: 'https://' },
    { key: 'newTab', label: 'Open in a new tab', control: 'boolean', default: false },
  ],
  variants: [
    {
      key: 'variant',
      label: 'Style',
      options: ['default', 'subtle', 'button'],
      default: 'default',
    },
  ],
};

/**
 * An icon, from a small curated set. Not an icon *font* and not a package: a dependency whose
 * whole job is to draw twenty shapes is a dependency the emitted app should not carry.
 */
export const ICON_DEF: ComponentDef = {
  type: 'Icon',
  node: { ports: () => [takes('pt_name', 'name', 'name', { kind: 'text' })] }, // A glyph that changes with status.
  label: 'Icon',
  category: 'visual',
  keywords: ['symbol', 'glyph', 'svg', 'pictogram'],
  isContainer: false,
  fields: [
    { key: 'name', label: 'Icon', control: 'select', options: [...ICON_NAMES], default: 'check' },
    { key: 'size', label: 'Size', control: 'number', default: 20 },
  ],
  variants: [
    {
      key: 'variant',
      label: 'Style',
      options: ['plain', 'tinted', 'circle', 'square'],
      default: 'plain',
    },
  ],
};

/** A textarea. Not expressible as a Text field: the difference is the shape of the answer. */
export const MULTILINE_FIELD_DEF: ComponentDef = {
  type: 'MultilineField',
  node: { ports: () => [gives('pt_value', 'value', 'value', { kind: 'text' })], fieldState: true },
  label: 'Multiline field',
  category: 'input',
  keywords: ['textarea', 'long text', 'paragraph', 'notes', 'description'],
  isContainer: false,
  fields: [
    { key: 'value', label: 'Value', control: 'text', default: '' },
    { key: 'placeholder', label: 'Placeholder', control: 'text', default: 'Type here' },
    { key: 'rows', label: 'Rows', control: 'number', default: 4 },
  ],
  variants: [FIELD_STYLE_AXIS, SIZE_AXIS],
};

/** Radio buttons. A Select with three options is the wrong control for three options. */
export const RADIO_GROUP_DEF: ComponentDef = {
  type: 'RadioGroup',
  node: { ports: givesChoice, fieldState: true },
  label: 'Radio buttons',
  category: 'input',
  keywords: ['choice', 'options', 'one of', 'pick'],
  isContainer: false,
  fields: [
    { key: 'options', label: 'Options', control: 'text', default: 'One, Two' },
    { key: 'value', label: 'Value', control: 'text', default: '' },
    { key: 'label', label: 'Question', control: 'text', default: '' },
  ],
  // Cards make each choice a target the size of a row rather than a 16px circle — on a phone that
  // is the difference between a control people hit and one they miss.
  variants: [
    {
      key: 'variant',
      label: 'Layout',
      options: ['stacked', 'inline', 'cards'],
      default: 'stacked',
    },
  ],
};

/**
 * A date picker. Its value is the browser's `YYYY-MM-DD`, and its port stays `text` because that
 * string is exactly what a date column accepts — typing it as `date` would promise a conversion
 * nothing performs.
 */
export const DATE_FIELD_DEF: ComponentDef = {
  type: 'DateField',
  node: { ports: () => [gives('pt_value', 'value', 'value', { kind: 'text' })], fieldState: true },
  label: 'Date field',
  category: 'input',
  keywords: ['calendar', 'day', 'when', 'picker', 'datetime'],
  isContainer: false,
  fields: [
    { key: 'value', label: 'Value', control: 'text', default: '' },
    { key: 'min', label: 'Earliest', control: 'text', default: '' },
    { key: 'max', label: 'Latest', control: 'text', default: '' },
  ],
  variants: [FIELD_STYLE_AXIS, SIZE_AXIS],
};

/** A slider — the right control for a bounded number, and cheap. */
export const SLIDER_DEF: ComponentDef = {
  type: 'Slider',
  node: {
    ports: () => [gives('pt_value', 'value', 'value', { kind: 'number' })],
    fieldState: true,
  },
  label: 'Slider',
  category: 'input',
  keywords: ['range', 'number', 'scale', 'amount'],
  isContainer: false,
  fields: [
    { key: 'value', label: 'Value', control: 'number', default: 50 },
    { key: 'min', label: 'Minimum', control: 'number', default: 0 },
    { key: 'max', label: 'Maximum', control: 'number', default: 100 },
    { key: 'step', label: 'Step', control: 'number', default: 1 },
  ],
  variants: [SIZE_AXIS],
};

/**
 * A Table renders rows *as a table* (D8, `docs/15-schema.md`).
 *
 * A List with a Frame inside it can be made to look like one, and every project ended up doing
 * that — badly, because columns that line up across rows are exactly what a List cannot promise.
 * This is the one arrangement of data worth its own element: the columns are named once, the
 * header comes from them, and every row lines up because they are the same cells.
 */
export const TABLE_DEF: ComponentDef = {
  type: 'Table',
  node: { ports: takesRows, perRow: true },
  label: 'Table',
  category: 'container',
  keywords: ['grid', 'rows', 'columns', 'data table', 'spreadsheet'],
  isContainer: false,
  fields: [
    // Which columns, in what order. Naming them beats showing whatever the first row happened to
    // carry: a row missing a field would silently reorder every column after it.
    { key: 'columns', label: 'Columns', control: 'text', default: '' },
    { key: 'empty', label: 'Empty text', control: 'text', default: 'Nothing yet' },
  ],
  variants: [
    { key: 'variant', label: 'Rows', options: ['plain', 'striped', 'bordered'], default: 'plain' },
  ],
  defaultSize: { width: 420, height: 200 },
};

/**
 * Media (`docs/28-media.md`).
 *
 * The vocabulary could put a picture on a screen and nothing else, so any project that needed a
 * video, a soundtrack or a gallery needed a developer — which is the thing loom exists to avoid.
 *
 * Every one of these is the **browser's own element**: a `<video>` is a video player, and shipping
 * a player library to do what the browser already does would cost a megabyte and take away the
 * native controls people already know how to use.
 */

export const VIDEO_DEF: ComponentDef = {
  type: 'Video',
  node: { ports: () => takesSource() },
  label: 'Video',
  category: 'media',
  keywords: ['player', 'movie', 'clip', 'mp4', 'film', 'media'],
  isContainer: false,
  fields: [
    { key: 'src', label: 'Source', control: 'text', default: '' },
    // The frame shown before it plays. Without one a video is a black rectangle on the page until
    // somebody presses play, which is a hole in a layout rather than a picture of it.
    { key: 'poster', label: 'Poster image', control: 'text', default: '' },
    { key: 'controls', label: 'Show controls', control: 'boolean', default: true },
    // Autoplay *sets* muted when it emits: every browser blocks sound that starts by itself, so
    // the combination people expect is one that silently does not play (`docs/28-media.md`).
    { key: 'autoplay', label: 'Play automatically', control: 'boolean', default: false },
    { key: 'loop', label: 'Loop', control: 'boolean', default: false },
    { key: 'muted', label: 'Muted', control: 'boolean', default: false },
  ],
  variants: [
    { key: 'variant', label: 'Style', options: ['plain', 'rounded', 'card'], default: 'rounded' },
  ],
  // 16:9, because that is what video is. A player with no size is a 300x150 browser default.
  defaultSize: { width: 480, height: 270 },
};

export const AUDIO_DEF: ComponentDef = {
  type: 'Audio',
  node: { ports: () => takesSource() },
  label: 'Audio',
  category: 'media',
  keywords: ['sound', 'music', 'player', 'mp3', 'podcast', 'track'],
  isContainer: false,
  fields: [
    { key: 'src', label: 'Source', control: 'text', default: '' },
    { key: 'controls', label: 'Show controls', control: 'boolean', default: true },
    { key: 'loop', label: 'Loop', control: 'boolean', default: false },
  ],
  variants: [
    { key: 'variant', label: 'Style', options: ['plain', 'soft', 'card'], default: 'plain' },
  ],
  defaultSize: { width: 320, height: 54 },
};

/**
 * One picture at a time, with previous, next and dots.
 *
 * Its index is real state in the emitted component — the same mechanism a List's paging uses. A
 * List cannot hold an index, which is exactly why this is its own element rather than an
 * arrangement of one.
 */
export const CAROUSEL_DEF: ComponentDef = {
  type: 'Carousel',
  node: { ports: takesRows, perRow: true },
  label: 'Carousel',
  category: 'media',
  keywords: ['slider', 'gallery', 'slideshow', 'images', 'swipe'],
  isContainer: false,
  fields: [
    // Either a comma-separated list of addresses, or a binding to rows that carry them.
    { key: 'items', label: 'Images', control: 'text', default: '' },
    // Which column holds the address, when the images come from data. Empty means the row *is*
    // the address, which is what a list of strings looks like.
    { key: 'field', label: 'Image column', control: 'text', default: '' },
    { key: 'alt', label: 'Alt text', control: 'text', default: '' },
    // Motion nobody asked for is motion some people cannot use, so it starts at nothing.
    { key: 'interval', label: 'Auto-advance (seconds)', control: 'number', default: 0 },
    { key: 'dots', label: 'Show dots', control: 'boolean', default: true },
  ],
  variants: [
    { key: 'variant', label: 'Style', options: ['plain', 'rounded', 'card'], default: 'rounded' },
  ],
  defaultSize: { width: 480, height: 300 },
};

/**
 * A responsive grid that wraps by **width** rather than by count.
 *
 * `repeat(auto-fill, minmax(<min>px, 1fr))`: the grid works out how many columns fit, so one
 * gallery is right on a phone and on a desktop. That is the one arrangement the row/column layout
 * genuinely cannot say, which is what earns it an element.
 */
export const TILES_DEF: ComponentDef = {
  type: 'Tiles',
  node: null, // A grid over its children, like a Frame. The children carry the data, not the grid.
  label: 'Tiles',
  category: 'media',
  keywords: ['grid', 'gallery', 'masonry', 'cards', 'mosaic', 'thumbnails'],
  isContainer: true,
  fields: [
    { key: 'minWidth', label: 'Minimum tile width', control: 'number', default: 160 },
    { key: 'gap', label: 'Gap', control: 'number', default: 12 },
  ],
  variants: [
    { key: 'variant', label: 'Style', options: ['plain', 'framed', 'inset'], default: 'plain' },
  ],
  defaultLayout: { direction: 'row', gap: 12, padding: 0, align: 'stretch', justify: 'start' },
  defaultSize: { width: 480, height: 240 },
};

/**
 * A round picture that falls back to initials.
 *
 * The fallback is the whole point: an avatar bound to a row of people is an avatar that will
 * sometimes have no picture, and a broken-image icon in a list of names looks like a bug.
 */
export const AVATAR_DEF: ComponentDef = {
  type: 'Avatar',
  node: {
    ports: () => [...takesSource(), takes('pt_name', 'name', 'name', { kind: 'text' })],
  },
  label: 'Avatar',
  category: 'media',
  keywords: ['profile', 'user', 'photo', 'face', 'initials', 'picture'],
  isContainer: false,
  fields: [
    { key: 'src', label: 'Image', control: 'text', default: '' },
    // Both the initials and the alt text come from this: one fact, written once.
    { key: 'name', label: 'Name', control: 'text', default: '' },
    { key: 'size', label: 'Size', control: 'number', default: 40 },
  ],
  variants: [
    { key: 'variant', label: 'Shape', options: ['circle', 'rounded', 'square'], default: 'circle' },
  ],
};

/**
 * Someone else's page, inside yours.
 *
 * A blank `title` is refused when it compiles rather than shipped: an iframe with no title is
 * announced to a screen reader as "frame", which tells the person nothing about what is in it.
 */
export const EMBED_DEF: ComponentDef = {
  type: 'Embed',
  node: { ports: () => takesSource() },
  label: 'Embed',
  category: 'media',
  keywords: ['iframe', 'youtube', 'map', 'vimeo', 'form', 'widget', 'external'],
  isContainer: false,
  fields: [
    // A placeholder rather than empty, the same rule a Link follows: a freshly placed element has
    // to compile, or dropping one on the canvas breaks the build until it is filled in.
    { key: 'src', label: 'Address', control: 'text', default: 'https://' },
    { key: 'title', label: 'Title', control: 'text', default: 'Embedded content' },
    { key: 'allowFullscreen', label: 'Allow fullscreen', control: 'boolean', default: true },
  ],
  variants: [
    { key: 'variant', label: 'Style', options: ['plain', 'rounded', 'card'], default: 'rounded' },
  ],
  defaultSize: { width: 480, height: 270 },
};

/**
 * Uploads (`docs/29-storage.md`).
 *
 * A form could ask for a name, a number and a date, and not for a **file** — so a project needing a
 * profile picture or a receipt needed a developer. These two are ordinary inputs in every way that
 * matters: their value is text (the stored key), so it flows into a column, a pipeline or another
 * screen exactly like a text field's does.
 *
 * The upload itself never touches a bucket credential. The browser asks this app's own server for a
 * ticket that expires; the server decides the key, the type and the size limit. A limit enforced in
 * a form is a limit anyone can skip.
 */

export const FILE_FIELD_DEF: ComponentDef = {
  type: 'FileField',
  node: { ports: () => [gives('pt_value', 'value', 'value', { kind: 'text' })], fieldState: true },
  label: 'File upload',
  category: 'input',
  keywords: ['upload', 'attachment', 'document', 'pdf', 'browse', 'choose file'],
  isContainer: false,
  fields: [
    // Which bucket it lands in — a connector id, chosen in the inspector from what the project has
    // attached. Blank is a Problem rather than a guess: silently picking one would put a customer's
    // documents somewhere nobody decided on.
    { key: 'bucket', label: 'Bucket', control: 'text', default: '' },
    { key: 'label', label: 'Label', control: 'text', default: 'Choose a file' },
    // The browser's own filter. The server checks again, because this one is a courtesy.
    { key: 'accept', label: 'Accepts', control: 'text', default: '' },
    { key: 'value', label: 'Value', control: 'text', default: '' },
  ],
  // Not the field styles: the visible control is a label, not a box you type in, so "underline"
  // would name a look it cannot have. A button, or a drop-shaped tile.
  variants: [
    { key: 'variant', label: 'Style', options: ['button', 'tile'], default: 'button' },
    SIZE_AXIS,
  ],
};

export const IMAGE_FIELD_DEF: ComponentDef = {
  type: 'ImageField',
  node: { ports: () => [gives('pt_value', 'value', 'value', { kind: 'text' })], fieldState: true },
  label: 'Image upload',
  category: 'input',
  keywords: ['upload', 'picture', 'photo', 'avatar', 'logo', 'browse'],
  isContainer: false,
  fields: [
    { key: 'bucket', label: 'Bucket', control: 'text', default: '' },
    { key: 'label', label: 'Label', control: 'text', default: 'Choose an image' },
    { key: 'accept', label: 'Accepts', control: 'text', default: 'image/*' },
    { key: 'value', label: 'Value', control: 'text', default: '' },
  ],
  variants: [
    { key: 'variant', label: 'Style', options: ['tile', 'row'], default: 'tile' },
    SIZE_AXIS,
  ],
};

/**
 * Charts (`docs/30-charts.md`).
 *
 * A project could fetch a thousand rows and show them as a thousand rows. There was no way to say
 * "how did sales go this year", so every project that needed a chart needed a developer.
 *
 * They are **drawn, not installed**: inline SVG the project owns, the same rule the icons follow.
 * A charting library is a few hundred kilobytes, a version to keep up with, and an API that decides
 * what your chart may look like. Sixty lines of path arithmetic is none of those.
 *
 * Each takes rows the same way a List or a Table does — `items` bound to a query, and two columns
 * named: one for the labels, one for the values.
 */

/** The columns every chart reads, and what it says when there is nothing to draw. */
const CHART_FIELDS: readonly FieldDef[] = [
  // `items` is deliberately not a field: rows arrive by binding, the same way a Table's do. As a
  // field it would default to an empty *string*, and a chart would be handed text where it expects
  // rows — which type-checks and then falls over the first time it renders.
  { key: 'labels', label: 'Label column', control: 'text', default: '' },
  { key: 'values', label: 'Value column', control: 'text', default: '' },
  // Read out to a screen reader as well as printed: a chart with no description says nothing at
  // all to some of the people looking at the page.
  { key: 'label', label: 'Title', control: 'text', default: '' },
  { key: 'empty', label: 'Empty text', control: 'text', default: 'Nothing yet' },
];

/** Plain, or on a surface of its own. The same two a Frame offers, for the same reason. */
const CHART_SURFACE: VariantAxis = {
  key: 'surface',
  label: 'Surface',
  options: ['plain', 'card'],
  default: 'plain',
};

export const BAR_CHART_DEF: ComponentDef = {
  type: 'BarChart',
  node: { ports: takesRows, perRow: true },
  label: 'Bar chart',
  category: 'chart',
  keywords: ['graph', 'column', 'histogram', 'compare', 'chart'],
  isContainer: false,
  fields: [...CHART_FIELDS],
  variants: [
    { key: 'variant', label: 'Bars', options: ['vertical', 'horizontal'], default: 'vertical' },
    CHART_SURFACE,
  ],
  defaultSize: { width: 420, height: 260 },
};

export const LINE_CHART_DEF: ComponentDef = {
  type: 'LineChart',
  node: { ports: takesRows, perRow: true },
  label: 'Line chart',
  category: 'chart',
  keywords: ['graph', 'trend', 'time', 'series', 'area', 'chart'],
  isContainer: false,
  fields: [...CHART_FIELDS],
  // An area is a line with a floor, so it is a shape of this rather than a fifth element.
  variants: [
    { key: 'variant', label: 'Shape', options: ['line', 'smooth', 'area'], default: 'line' },
    CHART_SURFACE,
  ],
  defaultSize: { width: 420, height: 260 },
};

export const PIE_CHART_DEF: ComponentDef = {
  type: 'PieChart',
  node: { ports: takesRows, perRow: true },
  label: 'Pie chart',
  category: 'chart',
  keywords: ['donut', 'doughnut', 'share', 'proportion', 'split', 'chart'],
  isContainer: false,
  fields: [...CHART_FIELDS],
  variants: [
    { key: 'variant', label: 'Shape', options: ['pie', 'donut'], default: 'pie' },
    CHART_SURFACE,
  ],
  defaultSize: { width: 300, height: 260 },
};

/**
 * One number, large.
 *
 * Not a chart, and the thing people put at the top of every dashboard: the count a query already
 * answered with, said plainly.
 */
export const STAT_DEF: ComponentDef = {
  type: 'Stat',
  node: { ports: () => [takes('pt_value', 'value', 'value', { kind: 'number' })] }, // The number at the top of every dashboard.
  label: 'Stat',
  category: 'chart',
  keywords: ['metric', 'kpi', 'number', 'total', 'count', 'big number'],
  isContainer: false,
  fields: [
    { key: 'value', label: 'Value', control: 'text', default: '0' },
    { key: 'label', label: 'Label', control: 'text', default: 'Total' },
    { key: 'note', label: 'Note', control: 'text', default: '' },
  ],
  variants: [
    { key: 'variant', label: 'Style', options: ['plain', 'card'], default: 'card' },
    SIZE_AXIS,
  ],
};

/**
 * Calendar and chat (`docs/31-calendar-chat.md`).
 *
 * Both are the same idea: **rows, in a shape**. A calendar is rows falling on the days they belong
 * to; a chat is rows in a column with a box underneath. Neither invents a storage system — they
 * work over whatever connector the project already has, which is why chat did not need a chat
 * server to exist.
 */

export const CALENDAR_DEF: ComponentDef = {
  type: 'Calendar',
  node: {
    ports: () => [...takesRows(), fires('pt_day', 'dayPicked', 'onDayPicked')],
    perRow: true,
  },
  label: 'Calendar',
  category: 'chart',
  keywords: ['month', 'schedule', 'events', 'agenda', 'dates', 'booking', 'diary'],
  isContainer: false,
  fields: [
    { key: 'dates', label: 'Date column', control: 'text', default: '' },
    { key: 'titles', label: 'Title column', control: 'text', default: '' },
    // Both are correct, and which one depends on where you are.
    {
      key: 'weekStart',
      label: 'Week starts',
      control: 'select',
      options: ['monday', 'sunday'],
      default: 'monday',
    },
    { key: 'empty', label: 'Empty text', control: 'text', default: 'Nothing yet' },
  ],
  variants: [
    { key: 'variant', label: 'Shape', options: ['month', 'agenda'], default: 'month' },
    { key: 'surface', label: 'Surface', options: ['plain', 'card'], default: 'card' },
  ],
  defaultSize: { width: 460, height: 380 },
};

export const CHAT_DEF: ComponentDef = {
  type: 'Chat',
  node: {
    ports: () => [...takesRows(), fires('pt_sent', 'sent', 'onSend')],
    perRow: true,
  },
  label: 'Chat',
  category: 'chart',
  keywords: ['messages', 'messaging', 'conversation', 'thread', 'comments', 'inbox'],
  isContainer: false,
  acceptsClickFlow: true,
  fields: [
    { key: 'texts', label: 'Message column', control: 'text', default: '' },
    { key: 'authors', label: 'Author column', control: 'text', default: '' },
    { key: 'times', label: 'Time column', control: 'text', default: '' },
    // What the composer holds. Bindable like any other input's value, so a "save row" step reads it
    // the same way it reads a text field.
    { key: 'value', label: 'Draft', control: 'text', default: '' },
    { key: 'placeholder', label: 'Placeholder', control: 'text', default: 'Write a message' },
    { key: 'sendLabel', label: 'Send button', control: 'text', default: 'Send' },
    // Seconds, and zero means never. It is polling, and the label says so rather than claiming a
    // websocket this does not open (`docs/31-calendar-chat.md`).
    { key: 'refresh', label: 'Refresh every (seconds)', control: 'number', default: 0 },
    { key: 'empty', label: 'Empty text', control: 'text', default: 'No messages yet' },
  ],
  variants: [
    { key: 'variant', label: 'Style', options: ['bubbles', 'plain'], default: 'bubbles' },
    { key: 'surface', label: 'Surface', options: ['plain', 'card'], default: 'card' },
  ],
  defaultSize: { width: 380, height: 420 },
};

const DEFS: readonly ComponentDef[] = [
  FRAME_DEF,
  TEXT_DEF,
  BUTTON_DEF,
  TEXT_FIELD_DEF,
  NUMBER_FIELD_DEF,
  CHECKBOX_DEF,
  SELECT_DEF,
  LIST_DEF,
  TABLE_DEF,
  IMAGE_DEF,
  VIDEO_DEF,
  AUDIO_DEF,
  CAROUSEL_DEF,
  TILES_DEF,
  AVATAR_DEF,
  EMBED_DEF,
  LINK_DEF,
  ICON_DEF,
  SHAPE_DEF,
  MULTILINE_FIELD_DEF,
  RADIO_GROUP_DEF,
  DATE_FIELD_DEF,
  SLIDER_DEF,
  FILE_FIELD_DEF,
  IMAGE_FIELD_DEF,
  BAR_CHART_DEF,
  LINE_CHART_DEF,
  PIE_CHART_DEF,
  STAT_DEF,
  CALENDAR_DEF,
  CHAT_DEF,
];
const BY_TYPE = new Map(DEFS.map((d) => [d.type, d]));

export function componentDefs(): readonly ComponentDef[] {
  return DEFS;
}

export function defFor(type: string): ComponentDef | undefined {
  return BY_TYPE.get(type);
}

/**
 * The props a node face may read when it types its ports.
 *
 * **Static only**, and that is the honest answer rather than a limitation: a bound prop has no
 * value until the app runs, so a Select whose options arrive from a query cannot be typed as an
 * enum of them at design time. Those fall back to `text`, which is what they genuinely are here.
 */
export function staticProps(component: Pick<Component, 'props'>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(component.props)) {
    if (value.kind === 'static') out[key] = value.value;
  }
  return out;
}

/** Build a new component of `type` with its schema defaults applied. */
export function createComponent(type: string, id: string): Component {
  const def = defFor(type);
  if (!def) throw new Error(`Unknown component type "${type}".`);

  const props: Record<string, PropertyValue> = {};
  for (const field of def.fields) {
    props[field.key] = { kind: 'static', value: field.default };
  }
  // The variant an element arrives wearing is written down rather than left implicit: a document
  // that said nothing would silently follow loom the day loom changed its mind about defaults, and
  // a project's screens should not restyle themselves because the tool was upgraded.
  for (const axis of def.variants ?? []) {
    props[axis.key] = { kind: 'static', value: axis.default };
  }

  const size = def.defaultSize
    ? {
        size: {
          width: { mode: 'fixed' as const, px: def.defaultSize.width },
          height: { mode: 'fixed' as const, px: def.defaultSize.height },
        },
      }
    : undefined;

  return {
    id,
    type: def.type,
    name: def.label,
    props,
    /**
     * A container hugs its children, so it arrives with a layout and no size — unless it *declares*
     * one. Tiles does: a grid that wraps by width and arrives 128 pixels wide fits exactly one
     * column, which makes the element look broken rather than empty (`docs/28-media.md`).
     */
    ...(def.isContainer ? { children: [] } : {}),
    ...(def.isContainer || size
      ? {
          layout: {
            ...(def.isContainer ? (def.defaultLayout ?? DEFAULT_LAYOUT) : DEFAULT_LAYOUT),
            ...(size ?? {}),
          },
        }
      : {}),
  };
}

/**
 * The frames a screen can be drawn at.
 *
 * These are **canvas sizes, not breakpoints**. V1 emits one flex layout that adapts, and distinct
 * per-device layouts are out of scope (`docs/07-v1-scope.md`); what a preset changes is the frame
 * the designer works in and the width the Preview runs at, so a screen can be judged at the size
 * people will actually hold it. Sizes are the CSS pixel sizes of common devices, not marketing
 * resolutions.
 */
export interface ScreenPreset {
  id: string;
  label: string;
  width: number;
  height: number;
  group: 'phone' | 'tablet' | 'desktop';
}

export const SCREEN_PRESETS: readonly ScreenPreset[] = [
  { id: 'phone-sm', label: 'Phone', width: 390, height: 844, group: 'phone' },
  { id: 'phone-lg', label: 'Phone large', width: 430, height: 932, group: 'phone' },
  { id: 'tablet', label: 'Tablet', width: 834, height: 1112, group: 'tablet' },
  { id: 'tablet-lg', label: 'Tablet landscape', width: 1112, height: 834, group: 'tablet' },
  { id: 'laptop', label: 'Laptop', width: 1280, height: 800, group: 'desktop' },
  { id: 'desktop', label: 'Desktop', width: 1440, height: 900, group: 'desktop' },
];

/** The frame a screen with no size of its own is drawn at. Tablet, per the V1 target. */
export const DEFAULT_SCREEN: ScreenPreset = SCREEN_PRESETS.find((p) => p.id === 'tablet')!;

export function screenPreset(id: string | undefined): ScreenPreset | undefined {
  return SCREEN_PRESETS.find((preset) => preset.id === id);
}

/** The preset matching an exact size, so a hand-typed 390x844 still reads as "Phone". */
export function presetForSize(width: number, height: number): ScreenPreset | undefined {
  return SCREEN_PRESETS.find((preset) => preset.width === width && preset.height === height);
}
