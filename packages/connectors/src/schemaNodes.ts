import type { Id, Node, Port } from '@loom/ir';
import type { ColumnSpec, KeyStyle, OnDelete, TableSpec } from './ddl';

/**
 * Schema on the canvas (N4, `docs/V1-COMPLETION.md` §10).
 *
 * Two nodes that look similar and are not the same thing at all, which is why they are separate
 * rather than one node with a switch.
 *
 * ## Table — design-time, and it emits nothing
 *
 * A table drawn on the canvas. Applying it does exactly what the Data panel does: runs the change
 * against the connected database and records a numbered migration the project owns
 * (`docs/15-schema.md`). **The app that ships has no idea this node existed** — there is no
 * runtime code, no DDL in a route, and nothing to go wrong in production.
 *
 * It is on the canvas because a schema is part of the design. Drawing the shape of the data beside
 * the screens that read it is the thing a designer is actually doing, and making them leave for a
 * database console to do it is the gap loom exists to close.
 *
 * ## DDL — runtime, and it says what that costs
 *
 * A statement that runs while the app is running. Genuinely needed occasionally — a tenant
 * onboarding that provisions a schema — and genuinely dangerous, so the costs travel *on the node*
 * rather than in a document nobody opens:
 *
 *  - it needs elevated privileges in production, which is a credential you would otherwise not ship
 *  - it records no migration, so nothing describes what the schema became
 *  - it is how environments drift apart
 *
 * The compiler refuses it outside an API route, like every other statement.
 */

const port = (
  id: string,
  name: string,
  direction: Port['direction'],
  type: Port['type'],
): Port => ({ id, name, direction, portKind: 'data', type });

/** A relation a designed table declares: this column points at that row. */
export interface RelationSpec {
  column: string;
  target: string;
  targetColumn: string;
  onDelete: OnDelete;
}

export interface SchemaTableConfig {
  connectorId: string;
  table: TableSpec;
  relations?: RelationSpec[];
  /** Set once the change has been run and a migration recorded. */
  appliedAt?: string;
}

export interface DdlConfig {
  connectorId: string;
  statement: string;
  /** Ticked by whoever accepted what it costs. Without it the compiler refuses. */
  acknowledged?: boolean;
}

export const SCHEMA_TABLE_KIND = 'schemaTable';
export const DDL_KIND = 'ddl';

/** Is this a node that describes a schema rather than doing anything at run time? */
export function isDesignTimeSchema(node: { category: string; kind: string }): boolean {
  return node.category === 'db' && node.kind === SCHEMA_TABLE_KIND;
}

export function isRuntimeDdl(node: { category: string; kind: string }): boolean {
  return node.category === 'db' && node.kind === DDL_KIND;
}

/**
 * A designed table has no ports.
 *
 * Nothing flows into it and nothing comes out: it is a description, not a step. Giving it ports
 * would invite somebody to wire it into a pipeline, which is the misunderstanding the whole
 * design-time/runtime split exists to prevent.
 */
export function schemaTablePorts(): Port[] {
  return [];
}

/** The runtime one is a step like any other: something in, something out. */
export function ddlPorts(): Port[] {
  return [
    port('pt_input', 'input', 'in', { kind: 'any' }),
    port('pt_done', 'done', 'out', { kind: 'boolean' }),
  ];
}

export function createSchemaTableNode(
  id: Id,
  position: { x: number; y: number },
  connectorId: string,
  name = 'new_table',
  key: KeyStyle = 'uuid',
): Node {
  const table: TableSpec = { name, key, columns: [] };
  return {
    id,
    category: 'db',
    kind: SCHEMA_TABLE_KIND,
    name,
    ports: schemaTablePorts(),
    position,
    config: { connectorId, table, relations: [] } satisfies SchemaTableConfig,
  };
}

export function createDdlNode(
  id: Id,
  position: { x: number; y: number },
  connectorId: string,
): Node {
  return {
    id,
    category: 'db',
    kind: DDL_KIND,
    name: 'Run a statement',
    ports: ddlPorts(),
    position,
    config: { connectorId, statement: '' } satisfies DdlConfig,
  };
}

/** The columns a designed table declares, with the key it was given at the front. */
export function columnsOfSpec(spec: TableSpec): ColumnSpec[] {
  return spec.columns;
}
