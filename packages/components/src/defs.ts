import type { Component, Layout, PropertyValue } from '@loom/ir';

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

export interface ComponentDef {
  type: string;
  label: string;
  /** Containers own a layout and accept children. */
  isContainer: boolean;
  /** Property schema — the inspector renders straight off this. */
  fields: readonly FieldDef[];
  /** True when the type can start a flow from a click (its `onClick` accepts a navigate handler). */
  acceptsClickFlow?: boolean;
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
  isContainer: false,
  fields: [{ key: 'label', label: 'Label', control: 'text', default: 'Button' }],
  acceptsClickFlow: true,
};

export const TEXT_DEF: ComponentDef = {
  type: 'Text',
  label: 'Text',
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

const DEFS: readonly ComponentDef[] = [FRAME_DEF, TEXT_DEF, BUTTON_DEF];
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
