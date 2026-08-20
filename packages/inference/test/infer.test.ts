import { describe, expect, it } from 'vitest';
import {
  applyOps,
  createEmptyProject,
  newArtboardId,
  newComponentId,
  newConnectorId,
  type Component,
  type Snapshot,
} from '@loom/ir';
import type { TableSchema } from '@loom/connectors';
import { analyzeForm, existingGroupFor, inferBackend } from '../src/backend';
import { detectForm, normalizeName, suggestTable } from '../src/form';

const TASKS: TableSchema = {
  name: 'tasks',
  columns: [
    { name: 'id', type: { kind: 'number' }, required: false, primaryKey: true, generated: true },
    { name: 'title', type: { kind: 'text' }, required: true, primaryKey: false, generated: false },
    { name: 'notes', type: { kind: 'text' }, required: false, primaryKey: false, generated: false },
  ],
};

const PEOPLE: TableSchema = {
  name: 'people',
  columns: [
    { name: 'id', type: { kind: 'number' }, required: false, primaryKey: true, generated: true },
    { name: 'email', type: { kind: 'text' }, required: true, primaryKey: false, generated: false },
  ],
};

interface Built {
  snapshot: Snapshot;
  frameId: string;
  titleId: string;
  buttonId: string;
}

/** A one-artboard project holding a form: Title field, Notes field, Save button. */
function buildForm(options: { tables?: TableSchema[]; buttons?: number; inputs?: string[] } = {}): Built {
  const rootId = newComponentId();
  const frameId = newComponentId();
  const artboardId = newArtboardId();
  const inputNames = options.inputs ?? ['Title', 'Notes'];

  const inputs: Component[] = inputNames.map((name) => ({
    id: newComponentId(),
    type: 'TextField',
    name,
    props: { placeholder: { kind: 'static', value: name } },
  }));

  const buttons: Component[] = Array.from({ length: options.buttons ?? 1 }, (_, index) => ({
    id: newComponentId(),
    type: 'Button',
    name: index === 0 ? 'Save' : `Other ${index}`,
    props: { label: { kind: 'static', value: 'Save' } },
  }));

  let snapshot = createEmptyProject('Test');
  snapshot = applyOps(snapshot, [
    {
      type: 'addArtboard',
      artboard: { id: artboardId, name: 'Home', root: rootId },
      root: {
        id: rootId,
        type: 'Frame',
        name: 'Root',
        props: {},
        layout: { direction: 'column', gap: 16, padding: 24, align: 'stretch', justify: 'start' },
        children: [],
      },
    },
    {
      type: 'addComponent',
      parentId: rootId,
      component: {
        id: frameId,
        type: 'Frame',
        name: 'Form',
        props: {},
        layout: { direction: 'column', gap: 8, padding: 16, align: 'stretch', justify: 'start' },
        children: [],
      },
    },
    ...[...inputs, ...buttons].map(
      (component) => ({ type: 'addComponent', parentId: frameId, component }) as const,
    ),
    {
      type: 'addConnector',
      connector: {
        id: newConnectorId(),
        moduleId: 'supabase',
        config: { url: 'https://x.supabase.co', schema: { tables: options.tables ?? [TASKS] } },
        credentialRef: 'default',
      },
    },
  ]);

  return { snapshot, frameId, titleId: inputs[0]!.id, buttonId: buttons[0]?.id ?? '' };
}

describe('reading a design as a form', () => {
  it('normalises a designer label into a column name', () => {
    expect(normalizeName('Task title')).toBe('task_title');
    expect(normalizeName('  Email  ')).toBe('email');
    expect(normalizeName('dueDate')).toBe('due_date');
  });

  it('finds the inputs and the single submit button', () => {
    const { snapshot, frameId, titleId, buttonId } = buildForm();
    const form = detectForm(snapshot, frameId)!;
    expect(form.inputs.map((input) => input.label)).toEqual(['Title', 'Notes']);
    expect(form.inputs[0]!.componentId).toBe(titleId);
    expect(form.submitId).toBe(buttonId);
  });

  it('refuses to guess which of two buttons submits, and says so differently from none', () => {
    const two = buildForm({ buttons: 2 });
    expect(detectForm(two.snapshot, two.frameId)!.submitId).toBeUndefined();
    expect(analyzeForm(two.snapshot, two.frameId)).toEqual({
      reason: 'A form needs exactly one button, so loom knows which click submits.',
    });

    const none = buildForm({ buttons: 0 });
    expect(analyzeForm(none.snapshot, none.frameId)).toEqual({
      reason: 'Add a button to submit this form.',
    });
  });

  it('picks the table whose required columns the form actually covers', () => {
    const { snapshot, frameId } = buildForm({ tables: [PEOPLE, TASKS] });
    const form = detectForm(snapshot, frameId)!;
    const match = suggestTable(form, [PEOPLE, TASKS])!;
    expect(match.table.name).toBe('tasks');
    expect(match.fields.map((field) => field.name)).toEqual(['title', 'notes']);
    expect(match.unmatched).toEqual([]);
  });

  it('reports an input that matches no column instead of dropping it', () => {
    const { snapshot, frameId } = buildForm({ inputs: ['Title', 'Nickname'] });
    const form = detectForm(snapshot, frameId)!;
    expect(suggestTable(form, [TASKS])!.unmatched).toEqual(['Nickname']);
  });

  it('will not propose a table whose required column has no input', () => {
    const { snapshot, frameId } = buildForm({ inputs: ['Notes'], tables: [TASKS] });
    const form = detectForm(snapshot, frameId)!;
    expect(suggestTable(form, [TASKS])).toBeUndefined();
    expect(analyzeForm(snapshot, frameId)).toHaveProperty('reason');
  });
});

describe('inferring the backend', () => {
  it('materialises validate -> route -> insert -> state, all marked AUTO', () => {
    const built = buildForm();
    const result = inferBackend(built.snapshot, { frameId: built.frameId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const next = applyOps(built.snapshot, result.proposal.ops);
    const { validate, route, insert, state } = result.proposal.nodes;

    expect(next.nodes[validate]!.kind).toBe('validate');
    expect(next.nodes[insert]!.category).toBe('db');
    expect(next.nodes[state]!.category).toBe('state');
    expect((next.nodes[route]!.config as { body: string[] }).body).toEqual([validate, insert]);

    for (const id of [validate, route, insert, state]) {
      expect(next.nodes[id]!.auto).toEqual({
        group: result.proposal.group,
        state: 'proposed',
        sourceId: built.frameId,
      });
    }
  });

  it('exposes the route inputs the form fills, and wires each input into its column', () => {
    const built = buildForm();
    const result = inferBackend(built.snapshot, { frameId: built.frameId });
    if (!result.ok) throw new Error(result.reason);
    const next = applyOps(built.snapshot, result.proposal.ops);

    const route = next.nodes[result.proposal.nodes.route]!;
    const inputs = route.ports.filter((port) => port.direction === 'in' && port.portKind === 'data');
    expect(inputs.map((port) => port.name)).toEqual(['title', 'notes']);
    // A required column takes a value; a nullable one may be left empty.
    expect(inputs[0]!.type).toEqual({ kind: 'text' });
    expect(inputs[1]!.type).toEqual({ kind: 'optional', of: { kind: 'text' } });

    const wired = Object.values(next.wires).filter(
      (wire) => wire.to.nodeId === route.id && wire.to.portId === 'pt_f_title',
    );
    expect(wired).toHaveLength(1);
    expect(next.nodes[wired[0]!.from.nodeId]!.mirrorOf).toBe(built.titleId);
  });

  it('makes the button fire the pipeline, as both a wire and a handler', () => {
    const built = buildForm();
    const result = inferBackend(built.snapshot, { frameId: built.frameId });
    if (!result.ok) throw new Error(result.reason);
    const next = applyOps(built.snapshot, result.proposal.ops);

    const routeId = result.proposal.nodes.route;
    const trigger = Object.values(next.wires).find(
      (wire) => wire.to.nodeId === routeId && wire.to.portId === 'pt_run',
    );
    expect(trigger).toBeDefined();
    expect(next.components[built.buttonId]!.props.onClick).toEqual({
      kind: 'event',
      handler: { kind: 'trigger', target: { nodeId: routeId, portId: 'pt_run' } },
    });
  });

  it('writes the inserted row into the screen bucket', () => {
    const built = buildForm();
    const result = inferBackend(built.snapshot, { frameId: built.frameId });
    if (!result.ok) throw new Error(result.reason);
    const next = applyOps(built.snapshot, result.proposal.ops);

    const write = Object.values(next.wires).find(
      (wire) => wire.to.nodeId === result.proposal.nodes.state,
    );
    expect(write?.from).toEqual({ nodeId: result.proposal.nodes.route, portId: 'pt_result' });
  });

  it('regenerating replaces the previous proposal rather than stacking a second one', () => {
    const built = buildForm();
    const first = inferBackend(built.snapshot, { frameId: built.frameId });
    if (!first.ok) throw new Error(first.reason);
    const afterFirst = applyOps(built.snapshot, first.proposal.ops);
    expect(existingGroupFor(afterFirst, built.frameId)).toBe(first.proposal.group);

    const second = inferBackend(afterFirst, { frameId: built.frameId });
    if (!second.ok) throw new Error(second.reason);
    const afterSecond = applyOps(afterFirst, second.proposal.ops);

    const groups = new Set(
      Object.values(afterSecond.nodes)
        .map((node) => node.auto?.group)
        .filter(Boolean),
    );
    expect([...groups]).toEqual([second.proposal.group]);
    expect(Object.values(afterSecond.nodes).filter((node) => node.category === 'api')).toHaveLength(1);
  });

  it('reuses the mirrors that already exist instead of duplicating them', () => {
    const built = buildForm();
    const first = inferBackend(built.snapshot, { frameId: built.frameId });
    if (!first.ok) throw new Error(first.reason);
    const afterFirst = applyOps(built.snapshot, first.proposal.ops);

    const second = inferBackend(afterFirst, { frameId: built.frameId });
    if (!second.ok) throw new Error(second.reason);
    const afterSecond = applyOps(afterFirst, second.proposal.ops);

    const mirrors = Object.values(afterSecond.nodes).filter((node) => node.mirrorOf === built.titleId);
    expect(mirrors).toHaveLength(1);
    // A mirror is a view of the designer's component, so inference never owns it.
    expect(mirrors[0]!.auto).toBeUndefined();
  });

  it('accept keeps the mark; detach removes it', () => {
    const built = buildForm();
    const result = inferBackend(built.snapshot, { frameId: built.frameId });
    if (!result.ok) throw new Error(result.reason);
    const generated = applyOps(built.snapshot, result.proposal.ops);

    const accepted = applyOps(generated, [{ type: 'acceptAuto', group: result.proposal.group }]);
    expect(accepted.nodes[result.proposal.nodes.route]!.auto!.state).toBe('accepted');

    const detached = applyOps(accepted, [{ type: 'detachAuto', group: result.proposal.group }]);
    expect(detached.nodes[result.proposal.nodes.route]!.auto).toBeUndefined();
    // Detached nodes are the designer's; a later run cannot withdraw them.
    const withdrawn = applyOps(detached, [{ type: 'removeAuto', group: result.proposal.group }]);
    expect(withdrawn.nodes[result.proposal.nodes.route]).toBeDefined();
  });

  it('refuses without a connection', () => {
    const built = buildForm();
    const bare = { ...built.snapshot, connectors: {} };
    expect(inferBackend(bare, { frameId: built.frameId })).toEqual({
      ok: false,
      reason: 'Connect a database first.',
    });
  });
});
