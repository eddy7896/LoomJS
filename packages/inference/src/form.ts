import type { Component, Id, Snapshot, TypeRef } from '@loom/ir';
import type { ColumnSchema, TableSchema } from '@loom/connectors';

/**
 * Reading a design as a form (M5, first half).
 *
 * Inference never guesses at behaviour the designer did not draw. It reads what is already on
 * the artboard — inputs, a button, the names the designer gave them — and matches it against a
 * schema that is already introspected. Everything here is a pure function of the snapshot, so
 * "why did loom propose that?" is answerable by reading one function.
 */

/** One input of a recognised form, already matched to a column. */
export interface FormField {
  /** The TextField component on the artboard. */
  componentId: Id;
  /** The column it writes, which is also the port name on the generated route. */
  name: string;
  type: TypeRef;
  required: boolean;
}

export interface FormShape {
  frameId: Id;
  /** Inputs, in tree order. */
  inputs: { componentId: Id; label: string }[];
  /** The button that submits, if the form has exactly one. */
  submitId: Id | undefined;
}

/** Component types that count as an input for the purposes of recognising a form. */
const INPUT_TYPES = new Set(['TextField', 'NumberField', 'Checkbox', 'Select']);

/** `Task title` -> `task_title`: the shape a Postgres column name takes. */
export function normalizeName(input: string): string {
  return input
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * What an input is called. The component's name is the designer's own word for it, so it wins;
 * the placeholder is the fallback because it is the word the *end user* sees.
 */
export function labelOf(component: Component): string {
  if (component.name && component.name !== component.type) return component.name;
  // A checkbox has no placeholder; its label is the word the end user reads.
  for (const key of ['placeholder', 'label']) {
    const prop = component.props[key];
    if (prop?.kind === 'static' && typeof prop.value === 'string' && prop.value) return prop.value;
  }
  return component.type;
}

/**
 * Recognise a form: a frame containing at least one input and at most one button.
 *
 * Two buttons is not a refusal to be clever, it is a refusal to guess — which one submits is a
 * question only the designer can answer, and a wrong answer wires the wrong click.
 */
export function detectForm(snapshot: Snapshot, frameId: Id): FormShape | undefined {
  const frame = snapshot.components[frameId];
  if (!frame || frame.type !== 'Frame') return undefined;

  const inputs: FormShape['inputs'] = [];
  const buttons: Id[] = [];

  const walk = (id: Id): void => {
    const component = snapshot.components[id];
    if (!component) return;
    if (INPUT_TYPES.has(component.type)) {
      inputs.push({ componentId: id, label: labelOf(component) });
    }
    if (component.type === 'Button') buttons.push(id);
    for (const child of component.children ?? []) walk(child);
  };
  for (const child of frame.children ?? []) walk(child);

  if (inputs.length === 0) return undefined;
  return { frameId, inputs, submitId: buttons.length === 1 ? buttons[0] : undefined };
}

/** Columns an insert may be asked for: everything the database does not fill in itself. */
export function writableColumns(table: TableSchema): ColumnSchema[] {
  return table.columns.filter((column) => !column.generated);
}

/** Match a form's inputs to a table's columns by name. */
export function matchFields(form: FormShape, table: TableSchema): FormField[] {
  const columns = new Map(writableColumns(table).map((column) => [column.name, column]));
  const fields: FormField[] = [];

  for (const input of form.inputs) {
    const column = columns.get(normalizeName(input.label));
    if (!column) continue;
    fields.push({
      componentId: input.componentId,
      name: column.name,
      type: column.type,
      required: column.required,
    });
  }

  return fields;
}

export interface TableMatch {
  table: TableSchema;
  fields: FormField[];
  /** Inputs that matched no column — shown to the designer, never silently dropped. */
  unmatched: string[];
}

/**
 * The table this form most likely writes.
 *
 * A candidate must cover **every required column**, because an insert missing one fails at the
 * database and there would be nothing on the canvas explaining why. Among candidates, the one
 * matching the most inputs wins; ties break on name so the proposal is deterministic.
 */
export function suggestTable(form: FormShape, tables: TableSchema[]): TableMatch | undefined {
  const candidates: TableMatch[] = [];

  for (const table of tables) {
    const fields = matchFields(form, table);
    if (fields.length === 0) continue;

    const required = writableColumns(table)
      .filter((column) => column.required)
      .map((column) => column.name);
    const covered = new Set(fields.map((field) => field.name));
    if (required.some((name) => !covered.has(name))) continue;

    const matched = new Set(fields.map((field) => field.componentId));
    candidates.push({
      table,
      fields,
      unmatched: form.inputs
        .filter((input) => !matched.has(input.componentId))
        .map((input) => input.label),
    });
  }

  candidates.sort(
    (a, b) => b.fields.length - a.fields.length || a.table.name.localeCompare(b.table.name),
  );
  return candidates[0];
}
