import { columnPortId, type ColumnSchema, type TableSchema } from '@loom/connectors';
import { createComponent } from '@loom/components';
import { newComponentId, type Component, type Id } from '@loom/ir';
import { dispatch, getState, selectComponent } from './store';
import { addBodyStep, addGraphNode, connect, ensureMirror, setNodeConfig } from './graph';
import { addDbStep, connectedTables } from './connectors';

/**
 * A form, built from a table's columns (D8, `docs/15-schema.md`).
 *
 * Everyone builds this form. A field per column, labelled, in the order the columns come, with a
 * button that writes the row — and building it by hand is fifteen clicks and three chances to wire
 * a field to the wrong column. The schema already says what the fields are, so loom lays them out.
 *
 * What it makes is **ordinary components**. There is no Form element with special behaviour: it is
 * a Frame, some labels, some inputs and a Button, each of them editable afterwards exactly like
 * one placed by hand. A generator that produced something only it could edit would be a worse
 * version of the thing it saved you from.
 */

/** The input that suits a column, from what the column holds. */
export function fieldTypeFor(column: ColumnSchema): string {
  switch (column.type.kind) {
    case 'number':
      return 'NumberField';
    case 'boolean':
      return 'Checkbox';
    case 'date':
      return 'DateField';
    case 'record':
    case 'list':
      // No control edits a structure, so it is text the designer can put JSON into rather than a
      // field that pretends to understand it.
      return 'MultilineField';
    default:
      return 'TextField';
  }
}

/** The columns a form asks for: everything the database will not fill in by itself. */
export function askableColumns(table: TableSchema): ColumnSchema[] {
  return table.columns.filter((column) => !column.primaryKey && !column.generated);
}

/** `created_at` reads as "Created at" on a label; nobody wants to type that twice. */
export function labelFor(name: string): string {
  const words = name.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

interface Placed {
  component: Component;
  parentId: Id;
}

/** Build a component of `type`, with props applied, ready to dispatch. */
function make(type: string, name: string, props: Record<string, unknown>): Component {
  const component = createComponent(type, newComponentId());
  component.name = name;
  for (const [key, value] of Object.entries(props)) {
    component.props[key] = { kind: 'static', value } as Component['props'][string];
  }
  return component;
}

export interface GeneratedForm {
  frameId: Id;
  /**
   * Fields that were laid out but could not be wired, and why.
   *
   * A generator that quietly leaves a field connected to nothing produces a form that looks
   * finished and drops what you type into it. The known case is a date: a DateField's value is
   * the browser's `YYYY-MM-DD` **text**, and loom will not call text a date on the way into a
   * date column, because that is a conversion nothing here performs.
   */
  unwired: { column: string; reason: string }[];
}

/**
 * Lay out a form for a table, wire it to a route that writes the row, and select it.
 *
 * Returns undefined when there is nowhere to put it, or nothing to ask for — a project with no
 * screen has no artboard to place into, and that is the panel's business to say rather than this
 * throwing.
 */
export function generateForm(tableName: string, parentId?: Id): GeneratedForm | undefined {
  const snapshot = getState().snapshot;
  const table = connectedTables(snapshot).find((candidate) => candidate.name === tableName);
  const root = parentId ?? snapshot.artboards[getState().activeArtboardId]?.root;
  if (!table || !root) return undefined;

  const columns = askableColumns(table);
  if (columns.length === 0) return undefined;

  // 1. The frame that holds it, stacked so the fields read down the page.
  const frame = createComponent('Frame', newComponentId());
  frame.name = `${labelFor(table.name)} form`;
  frame.layout = {
    direction: 'column',
    gap: 10,
    padding: 16,
    align: 'stretch',
    justify: 'start',
  };
  dispatch({ type: 'addComponent', component: frame, parentId: root });

  // 2. A label and an input per column, in the order the schema lists them.
  const placed: Placed[] = [];
  const fields = new Map<string, Id>();

  for (const column of columns) {
    const label = make('Text', `${labelFor(column.name)} label`, {
      content: labelFor(column.name),
    });
    const input = make(fieldTypeFor(column), labelFor(column.name), {
      placeholder: labelFor(column.name),
    });

    placed.push({ component: label, parentId: frame.id }, { component: input, parentId: frame.id });
    fields.set(column.name, input.id);
  }

  const button = make('Button', 'Save', { label: 'Save' });
  placed.push({ component: button, parentId: frame.id });

  for (const entry of placed) {
    dispatch({ type: 'addComponent', component: entry.component, parentId: entry.parentId });
  }

  // 3. The route that writes the row. Its input ports *are* the insert step's columns, which is
  // what makes the wiring below a matter of names rather than of guessing.
  const route = addGraphNode('api', 'route');
  const step = addDbStep(route, table.name, 'insert');
  if (!step) return { frameId: frame.id, unwired: [] };

  // 4. Wire each field to the column it was made for, and the button to the route. A refusal
  // here is reported rather than swallowed: a field wired to nothing looks finished and is not.
  const unwired: GeneratedForm['unwired'] = [];

  for (const [column, componentId] of fields) {
    const mirror = ensureMirror(componentId, { x: 0, y: 0 });
    if (!mirror) {
      unwired.push({ column, reason: 'This field has nothing to wire from.' });
      continue;
    }

    /**
     * A date column takes a date, and a DateField hands back the browser's `YYYY-MM-DD` — which
     * is text. loom will not call text a date, so the form puts the conversion in: the same
     * "Read as date" step a designer would have wired by hand.
     */
    const wantsDate = table.columns.find((entry) => entry.name === column)?.type.kind === 'date';
    const from = wantsDate ? addBodyStep(route, 'compute') : undefined;
    if (from) {
      setNodeConfig(from, { op: 'toDate' });
      connect({ nodeId: mirror, portId: 'pt_value' }, { nodeId: from, portId: 'pt_input' });
    }

    const result = connect(
      from ? { nodeId: from, portId: 'pt_result' } : { nodeId: mirror, portId: 'pt_value' },
      { nodeId: route, portId: columnPortId(column) },
    );
    if (!result.ok) unwired.push({ column, reason: result.reason ?? 'It could not be wired.' });
  }

  const clicker = ensureMirror(button.id, { x: 0, y: 0 });
  if (clicker) connect({ nodeId: clicker, portId: 'pt_click' }, { nodeId: route, portId: 'pt_run' });

  selectComponent(frame.id);
  return { frameId: frame.id, unwired };
}

/**
 * A table on screen, reading a table in the database (D9).
 *
 * The other half of the form: a Table element with the columns already named, a route that reads
 * the rows, and the binding between them. Same rule as the form — what it makes is ordinary
 * components and an ordinary route, editable afterwards.
 */
export function generateTable(tableName: string, parentId?: Id): Id | undefined {
  const snapshot = getState().snapshot;
  const table = connectedTables(snapshot).find((candidate) => candidate.name === tableName);
  const root = parentId ?? snapshot.artboards[getState().activeArtboardId]?.root;
  if (!table || !root) return undefined;

  const element = make('Table', `${labelFor(table.name)} table`, {
    // Named from the schema rather than discovered from the first row, which is the whole
    // reason a Table names its columns at all.
    columns: table.columns.map((column) => column.name).join(', '),
    empty: `No ${table.name} yet`,
  });
  dispatch({ type: 'addComponent', component: element, parentId: root });

  const route = addGraphNode('api', 'route');
  if (!addDbStep(route, table.name, 'select')) return element.id;

  // The binding is drawn the way a designer would draw it: the route's result into the element's
  // items port, which the wire turns into the property.
  const mirror = ensureMirror(element.id, { x: 0, y: 0 });
  if (mirror) connect({ nodeId: route, portId: 'pt_result' }, { nodeId: mirror, portId: 'pt_items' });

  selectComponent(element.id);
  return element.id;
}
