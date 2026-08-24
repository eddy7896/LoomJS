import {
  newAutoGroupId,
  newNodeId,
  newWireId,
  type AutoMark,
  type Id,
  type Node,
  type Op,
  type Snapshot,
} from '@loom/ir';
import { apiPortsFromBody, mirrorPortsFor, type ValidationField } from '@loom/components';
import { createDbNode, type TableSchema } from '@loom/connectors';
import { detectForm, suggestTable, type FormField, type FormShape, type TableMatch } from './form';

/**
 * Auto-backend inference (M5) — the capstone.
 *
 * It invents nothing. Every node it materialises is a primitive M0–M4 already made real, and
 * the result is an ordinary document the ordinary compiler compiles: **AUTO is provenance, not
 * a mode**. That is what makes Accept and Detach cheap — accepting changes nothing about how the
 * pipeline runs, and detaching only removes a mark.
 *
 * The shape it proposes is fixed (`07-v1-scope.md`): Validate -> POST API route -> Supabase
 * insert, with the result written to the screen bucket.
 */

export interface InferenceOptions {
  /** The frame the designer pointed at. */
  frameId: Id;
  /** Where to place the generated nodes on the Nodes canvas. */
  position?: { x: number; y: number };
  /** Force a table instead of taking the suggestion. */
  tableName?: string;
}

export interface InferenceProposal {
  group: Id;
  ops: Op[];
  table: string;
  route: string;
  /** Columns the form fills, in order. */
  fields: string[];
  /** Inputs that matched no column; they stay unwired rather than being guessed at. */
  unmatched: string[];
  /** Ids of the four nodes, for the editor to focus and badge. */
  nodes: { validate: Id; route: Id; insert: Id; state: Id };
}

export type InferenceResult =
  | { ok: true; proposal: InferenceProposal }
  | { ok: false; reason: string };

/** The Supabase connection and its cached schema, as the document holds them. */
function connectionOf(
  snapshot: Snapshot,
): { connectorId: Id; tables: TableSchema[] } | undefined {
  const connector = Object.values(snapshot.connectors).find((c) => c.moduleId === 'supabase');
  if (!connector) return undefined;
  const config = (connector.config ?? {}) as { schema?: { tables?: TableSchema[] } };
  return { connectorId: connector.id, tables: config.schema?.tables ?? [] };
}

/** The AUTO group already generated from this frame, if inference has run before. */
export function existingGroupFor(snapshot: Snapshot, frameId: Id): Id | undefined {
  for (const node of Object.values(snapshot.nodes)) {
    if (node.auto?.sourceId === frameId) return node.auto.group;
  }
  return undefined;
}

/** Buttons anywhere below a frame — used only to explain what is wrong, never to guess. */
function countButtons(snapshot: Snapshot, frameId: Id): number {
  let count = 0;
  const walk = (id: Id): void => {
    const component = snapshot.components[id];
    if (!component) return;
    if (component.type === 'Button') count += 1;
    for (const child of component.children ?? []) walk(child);
  };
  for (const child of snapshot.components[frameId]?.children ?? []) walk(child);
  return count;
}

/** The mirror node standing for a component, if one exists. */
function mirrorOf(snapshot: Snapshot, componentId: Id): Node | undefined {
  return Object.values(snapshot.nodes).find(
    (node) => node.category === 'ui' && node.mirrorOf === componentId,
  );
}

/**
 * Can this frame have a backend inferred for it, and what would it write? Returns the same
 * refusal strings the editor shows, so the answer to "why is the button disabled" is one call.
 */
export function analyzeForm(
  snapshot: Snapshot,
  frameId: Id,
): { form: FormShape; match: TableMatch; connectorId: Id } | { reason: string } {
  const form = detectForm(snapshot, frameId);
  if (!form) return { reason: 'This frame has no input fields.' };
  if (!form.submitId) {
    // Zero buttons and two buttons are different problems, and the fix differs: draw one, or
    // say which one. A single generic sentence would send half the designers the wrong way.
    const buttons = countButtons(snapshot, frameId);
    return {
      reason:
        buttons === 0
          ? 'Add a button to submit this form.'
          : 'A form needs exactly one button, so loom knows which click submits.',
    };
  }

  const connection = connectionOf(snapshot);
  if (!connection) return { reason: 'Connect a database first.' };
  if (connection.tables.length === 0) return { reason: 'The connection has no tables.' };

  const match = suggestTable(form, connection.tables);
  if (!match) {
    return {
      reason:
        'No table matches these fields. Name each field after the column it fills, and make sure every required column has one.',
    };
  }

  return { form, match, connectorId: connection.connectorId };
}

export function inferBackend(snapshot: Snapshot, options: InferenceOptions): InferenceResult {
  const analysis = analyzeForm(snapshot, options.frameId);
  if ('reason' in analysis) return { ok: false, reason: analysis.reason };

  const { form, connectorId } = analysis;
  let match = analysis.match;

  if (options.tableName && options.tableName !== match.table.name) {
    const connection = connectionOf(snapshot)!;
    const table = connection.tables.find((candidate) => candidate.name === options.tableName);
    if (!table) return { ok: false, reason: `No table named "${options.tableName}".` };
    const forced = suggestTable(form, [table]);
    if (!forced) {
      return { ok: false, reason: `The form does not fill every required column of "${table.name}".` };
    }
    match = forced;
  }

  const submitId = form.submitId!;
  const ops: Op[] = [];
  const group = newAutoGroupId();
  const auto: AutoMark = { group, state: 'proposed', sourceId: options.frameId };

  // Regeneration replaces the previous proposal wholesale. Anything the designer detached has
  // lost its mark by definition, so it survives untouched.
  const previous = existingGroupFor(snapshot, options.frameId);
  if (previous) ops.push({ type: 'removeAuto', group: previous });

  const origin = options.position ?? nextFreePosition(snapshot);

  // Mirrors are views of components that already exist, so they are never marked AUTO: removing
  // one would remove the designer's only handle on their own input (guardrail 13).
  const mirrors = new Map<Id, Id>();
  let mirrorRow = 0;
  for (const componentId of [...form.inputs.map((input) => input.componentId), submitId]) {
    const existing = mirrorOf(snapshot, componentId);
    if (existing) {
      mirrors.set(componentId, existing.id);
      continue;
    }
    const component = snapshot.components[componentId];
    if (!component) continue;
    const ports = mirrorPortsFor(component);
    if (ports.length === 0) continue;

    const id = newNodeId();
    mirrors.set(componentId, id);
    ops.push({
      type: 'addNode',
      node: {
        id,
        category: 'ui',
        kind: 'mirror',
        name: component.name ?? component.type,
        mirrorOf: componentId,
        ports,
        position: { x: origin.x - 260, y: origin.y + mirrorRow * 90 },
      },
    });
    mirrorRow += 1;
  }

  const validateId = newNodeId();
  const insertId = newNodeId();
  const routeId = newNodeId();
  const stateId = newNodeId();

  const validationFields: ValidationField[] = match.fields.map((field) => ({
    name: field.name,
    type: field.type,
    required: field.required,
  }));

  const validate: Node = {
    id: validateId,
    category: 'fn',
    kind: 'validate',
    name: 'Validate',
    ports: validatePorts(match.fields),
    position: { x: origin.x, y: origin.y + 120 },
    config: { fields: validationFields },
    auto,
  };

  const insert = {
    ...createDbNode(
      insertId,
      { x: origin.x, y: origin.y + 240 },
      connectorId,
      match.table,
      'insert',
    ),
    auto,
  };

  const route: Node = {
    id: routeId,
    category: 'api',
    kind: 'route',
    name: `Create ${match.table.name}`,
    // The container's ports come from its body: the form wires straight into the columns.
    ports: apiPortsFromBody([validate, insert]),
    position: origin,
    config: { method: 'POST', path: `create${match.table.name}`, body: [validateId, insertId] },
    auto,
  };

  const state: Node = {
    id: stateId,
    category: 'state',
    kind: 'write',
    name: `New ${match.table.name}`,
    ports: [
      { id: 'pt_set', name: 'set', direction: 'in', portKind: 'data', type: { kind: 'any' } },
      { id: 'pt_value', name: 'value', direction: 'out', portKind: 'data', type: { kind: 'any' } },
    ],
    position: { x: origin.x + 300, y: origin.y },
    config: { scope: 'screen', key: `new_${match.table.name}` },
    auto,
  };

  ops.push(
    { type: 'addNode', node: validate },
    { type: 'addNode', node: insert },
    { type: 'addNode', node: route },
    { type: 'addNode', node: state },
  );

  // Each input feeds the column it matched.
  for (const field of match.fields) {
    const mirror = mirrors.get(field.componentId);
    if (!mirror) continue;
    ops.push({
      type: 'addWire',
      wire: {
        id: newWireId(),
        from: { nodeId: mirror, portId: 'pt_value' },
        to: { nodeId: routeId, portId: portIdFor(field.name) },
        auto,
      },
    });
  }

  // The click fires the pipeline. The wire and the component's handler are the same fact, so
  // both are written in one batch — a trigger wire without a handler emits nothing.
  const submitMirror = mirrors.get(submitId);
  if (submitMirror) {
    ops.push({
      type: 'addWire',
      wire: {
        id: newWireId(),
        from: { nodeId: submitMirror, portId: 'pt_click' },
        to: { nodeId: routeId, portId: 'pt_run' },
        auto,
      },
    });
    ops.push({
      type: 'setProp',
      componentId: submitId,
      key: 'onClick',
      value: {
        kind: 'event',
        handler: { kind: 'trigger', target: { nodeId: routeId, portId: 'pt_run' } },
      },
    });
  }

  // The inserted row lands in the screen bucket, so it outlives the request that made it.
  ops.push({
    type: 'addWire',
    wire: {
      id: newWireId(),
      from: { nodeId: routeId, portId: 'pt_result' },
      to: { nodeId: stateId, portId: 'pt_set' },
      auto,
    },
  });

  return {
    ok: true,
    proposal: {
      group,
      ops,
      table: match.table.name,
      route: `/api/create${match.table.name}`,
      fields: match.fields.map((field) => field.name),
      unmatched: match.unmatched,
      nodes: { validate: validateId, route: routeId, insert: insertId, state: stateId },
    },
  };
}

/** Port id for one validated field — kept in step with `VALIDATE_DEF`. */
export const portIdFor = (name: string): string => `pt_f_${name}`;

function validatePorts(fields: FormField[]): Node['ports'] {
  return [
    ...fields.map((field) => ({
      id: portIdFor(field.name),
      name: field.name,
      direction: 'in' as const,
      portKind: 'data' as const,
      type: field.required ? field.type : ({ kind: 'optional', of: field.type } as const),
    })),
    {
      id: 'pt_values',
      name: 'values',
      direction: 'out' as const,
      portKind: 'data' as const,
      type: { kind: 'record' } as const,
    },
  ];
}

/** Drop the new pipeline clear of whatever is already on the canvas. */
function nextFreePosition(snapshot: Snapshot): { x: number; y: number } {
  const nodes = Object.values(snapshot.nodes);
  if (nodes.length === 0) return { x: 360, y: 80 };
  const right = Math.max(...nodes.map((node) => node.position.x));
  return { x: right + 320, y: 80 };
}
