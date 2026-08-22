import type { Component, Layout, PropertyValue } from '@loom/ir';
import { ICON_NAMES } from './icons';

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
export type ComponentCategory = 'visual' | 'container' | 'input';

/** The order the palette draws them, and what each section is called. */
export const COMPONENT_CATEGORIES: readonly { id: ComponentCategory; label: string }[] = [
  { id: 'visual', label: 'Visual elements' },
  { id: 'container', label: 'Containers' },
  { id: 'input', label: 'Input forms' },
];

export interface ComponentDef {
  type: string;
  label: string;
  category: ComponentCategory;
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
  /** True when the type can start a flow from a click (its `onClick` accepts a navigate handler). */
  acceptsClickFlow?: boolean;
  /** True when the type renders its template once per row of a bound list. */
  acceptsItems?: boolean;
  defaultLayout?: Layout;
}

export const DEFAULT_LAYOUT: Layout = {
  direction: 'column',
  gap: 16,
  padding: 16,
  align: 'stretch',
  justify: 'start',
};

export const FRAME_DEF: ComponentDef = {
  type: 'Frame',
  label: 'Frame',
  category: 'container',
  keywords: ['group', 'div', 'box', 'stack', 'container'],
  isContainer: true,
  fields: [],
  defaultLayout: DEFAULT_LAYOUT,
};

/**
 * Button is the leaf that starts a flow: its `onClick` holds an event handler, which the
 * inspector edits as "navigate to <artboard>" rather than as a raw property.
 */
export const BUTTON_DEF: ComponentDef = {
  type: 'Button',
  label: 'Button',
  category: 'visual',
  keywords: ['click', 'submit', 'action'],
  isContainer: false,
  fields: [{ key: 'label', label: 'Label', control: 'text', default: 'Button' }],
  acceptsClickFlow: true,
};

export const TEXT_DEF: ComponentDef = {
  type: 'Text',
  label: 'Text',
  category: 'visual',
  keywords: ['label', 'paragraph', 'heading', 'copy'],
  isContainer: false,
  fields: [{ key: 'content', label: 'Content', control: 'text', default: 'Text' }],
};

/** The layout fields the inspector shows for any container. */
export const LAYOUT_FIELDS: readonly FieldDef[] = [
  { key: 'direction', label: 'Direction', control: 'select', options: ['column', 'row'], default: 'column' },
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
  label: 'Text field',
  category: 'input',
  keywords: ['input', 'textbox', 'string'],
  isContainer: false,
  fields: [
    { key: 'value', label: 'Value', control: 'text', default: '' },
    { key: 'placeholder', label: 'Placeholder', control: 'text', default: 'Type here' },
  ],
};

/**
 * A List renders its first child once per row of the data bound to `items` — the implicit map
 * (`04-hallucination-check.md`: loops are never nodes). Inside that template, a property can read
 * a field of the current row.
 */
export const LIST_DEF: ComponentDef = {
  type: 'List',
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
  defaultLayout: { direction: 'column', gap: 8, padding: 0, align: 'stretch', justify: 'start' },
  acceptsItems: true,
};


/** A number input. Its state is a number, so a numeric column takes it without a cast. */
export const NUMBER_FIELD_DEF: ComponentDef = {
  type: 'NumberField',
  label: 'Number field',
  category: 'input',
  keywords: ['number', 'numeric', 'quantity', 'amount'],
  isContainer: false,
  fields: [
    { key: 'value', label: 'Value', control: 'number', default: 0 },
    { key: 'placeholder', label: 'Placeholder', control: 'text', default: '0' },
  ],
};

/** A checkbox: the one component whose value is a boolean, and the source of most Gate inputs. */
export const CHECKBOX_DEF: ComponentDef = {
  type: 'Checkbox',
  label: 'Checkbox',
  category: 'input',
  keywords: ['boolean', 'toggle', 'switch', 'tick'],
  isContainer: false,
  fields: [
    { key: 'label', label: 'Label', control: 'text', default: 'Yes' },
    { key: 'value', label: 'Checked', control: 'boolean', default: false },
  ],
};

/**
 * A select. Its options are a comma-separated list, and its port stays `text`: typing the port
 * as an `enum` of those options needs the mirror to see the component's config, which is a wider
 * change than this vocabulary needs today.
 */
export const SELECT_DEF: ComponentDef = {
  type: 'Select',
  label: 'Select',
  category: 'input',
  keywords: ['dropdown', 'options', 'picker', 'choice'],
  isContainer: false,
  fields: [
    { key: 'options', label: 'Options', control: 'text', default: 'One, Two' },
    { key: 'value', label: 'Value', control: 'text', default: '' },
  ],
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
  label: 'Image',
  category: 'visual',
  keywords: ['picture', 'photo', 'img', 'graphic', 'logo'],
  isContainer: false,
  fields: [
    { key: 'src', label: 'Source', control: 'text', default: '' },
    { key: 'alt', label: 'Alt text', control: 'text', default: '' },
  ],
};

/**
 * A real link. `navigate` on a Button is a `<div>` that moves the page: not right-clickable, not
 * middle-clickable, not crawlable, and reachable by keyboard only because the button is. This
 * emits an anchor — `<Link>` when it points at a screen, `<a>` when it points at an address.
 */
export const LINK_DEF: ComponentDef = {
  type: 'Link',
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
};

/**
 * An icon, from a small curated set. Not an icon *font* and not a package: a dependency whose
 * whole job is to draw twenty shapes is a dependency the emitted app should not carry.
 */
export const ICON_DEF: ComponentDef = {
  type: 'Icon',
  label: 'Icon',
  category: 'visual',
  keywords: ['symbol', 'glyph', 'svg', 'pictogram'],
  isContainer: false,
  fields: [
    { key: 'name', label: 'Icon', control: 'select', options: [...ICON_NAMES], default: 'check' },
    { key: 'size', label: 'Size', control: 'number', default: 20 },
  ],
};

/** A textarea. Not expressible as a Text field: the difference is the shape of the answer. */
export const MULTILINE_FIELD_DEF: ComponentDef = {
  type: 'MultilineField',
  label: 'Multiline field',
  category: 'input',
  keywords: ['textarea', 'long text', 'paragraph', 'notes', 'description'],
  isContainer: false,
  fields: [
    { key: 'value', label: 'Value', control: 'text', default: '' },
    { key: 'placeholder', label: 'Placeholder', control: 'text', default: 'Type here' },
    { key: 'rows', label: 'Rows', control: 'number', default: 4 },
  ],
};

/** Radio buttons. A Select with three options is the wrong control for three options. */
export const RADIO_GROUP_DEF: ComponentDef = {
  type: 'RadioGroup',
  label: 'Radio buttons',
  category: 'input',
  keywords: ['choice', 'options', 'one of', 'pick'],
  isContainer: false,
  fields: [
    { key: 'options', label: 'Options', control: 'text', default: 'One, Two' },
    { key: 'value', label: 'Value', control: 'text', default: '' },
    { key: 'label', label: 'Question', control: 'text', default: '' },
  ],
};

/**
 * A date picker. Its value is the browser's `YYYY-MM-DD`, and its port stays `text` because that
 * string is exactly what a date column accepts — typing it as `date` would promise a conversion
 * nothing performs.
 */
export const DATE_FIELD_DEF: ComponentDef = {
  type: 'DateField',
  label: 'Date field',
  category: 'input',
  keywords: ['calendar', 'day', 'when', 'picker', 'datetime'],
  isContainer: false,
  fields: [
    { key: 'value', label: 'Value', control: 'text', default: '' },
    { key: 'min', label: 'Earliest', control: 'text', default: '' },
    { key: 'max', label: 'Latest', control: 'text', default: '' },
  ],
};

/** A slider — the right control for a bounded number, and cheap. */
export const SLIDER_DEF: ComponentDef = {
  type: 'Slider',
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
  IMAGE_DEF,
  LINK_DEF,
  ICON_DEF,
  MULTILINE_FIELD_DEF,
  RADIO_GROUP_DEF,
  DATE_FIELD_DEF,
  SLIDER_DEF,
];
const BY_TYPE = new Map(DEFS.map((d) => [d.type, d]));

export function componentDefs(): readonly ComponentDef[] {
  return DEFS;
}

export function defFor(type: string): ComponentDef | undefined {
  return BY_TYPE.get(type);
}

/** Build a new component of `type` with its schema defaults applied. */
export function createComponent(type: string, id: string): Component {
  const def = defFor(type);
  if (!def) throw new Error(`Unknown component type "${type}".`);

  const props: Record<string, PropertyValue> = {};
  for (const field of def.fields) {
    props[field.key] = { kind: 'static', value: field.default };
  }

  return {
    id,
    type: def.type,
    name: def.label,
    props,
    ...(def.isContainer ? { layout: { ...(def.defaultLayout ?? DEFAULT_LAYOUT) }, children: [] } : {}),
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
