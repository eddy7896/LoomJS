import {
  isRequestTool,
  operationFor,
  toolFor,
  toolNodePorts,
  createToolNode,
  TOOLS,
  type ToolManifest,
  type ToolNodeConfig,
} from '@loom/connectors';
import { apiPortsFromBody } from '@loom/components';
import { newConnectorId, newNodeId, type Id, type Snapshot } from '@loom/ir';
import { dispatch, getState, select } from './store';
import { routeContaining } from './connectors';

/**
 * Tools, in the studio (T1–T3, `docs/22-api-connectors.md`).
 *
 * Attaching a tool is two facts: that this project uses it, which belongs in the document, and a
 * key, which does not. The key goes straight to the dev server — never the env bucket in this
 * browser, never the snapshot — for the same reason a database connection string does. A model
 * key is the same kind of secret as a database password.
 */

/** Hand a credential to the dev server without keeping a copy here. */
async function sendToServer(values: Record<string, string>): Promise<void> {
  await fetch('/__loom/env', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ env: values }),
  });
}

/** Tools this project has attached, in the order they were added. */
export function attachedTools(snapshot: Snapshot): { connectorId: Id; tool: ToolManifest }[] {
  return Object.values(snapshot.connectors)
    .map((connector) => ({ connectorId: connector.id, tool: toolFor(connector.moduleId) }))
    .filter((entry): entry is { connectorId: Id; tool: ToolManifest } => Boolean(entry.tool));
}

export function toolAttached(snapshot: Snapshot, toolId: string): Id | undefined {
  return attachedTools(snapshot).find((entry) => entry.tool.id === toolId)?.connectorId;
}

/**
 * Attach a tool, with or without its key.
 *
 * An empty key means "use what the dev server already holds" — the same door a `.env.local`
 * opens for every other credential, and the way to attach a tool without typing a secret into a
 * browser at all.
 */
export async function attachTool(
  toolId: string,
  values: Record<string, string> | string = {},
): Promise<{ ok: boolean; error?: string }> {
  const tool = toolFor(toolId);
  if (!tool) return { ok: false, error: `${toolId} is not a tool loom knows.` };

  // A single string is the one-credential shorthand, which is most tools.
  const given =
    typeof values === 'string'
      ? values.trim()
        ? { [tool.credentials[0]?.name ?? 'TOOL_API_KEY']: values.trim() }
        : {}
      : values;

  // Only the ones actually filled in: an empty box means "use what the server already has", not
  // "set this to nothing".
  const filled = Object.fromEntries(
    Object.entries(given)
      .map(([name, value]) => [name, String(value).trim()])
      .filter(([, value]) => value !== ''),
  );

  if (Object.keys(filled).length > 0) {
    try {
      await sendToServer(filled);
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }

  const snapshot = getState().snapshot;
  const existing = toolAttached(snapshot, toolId);
  if (existing) return { ok: true };

  dispatch({
    type: 'addConnector',
    // The document records *which* tool, and nothing else. There is no field here a key could
    // fit into, which is the point.
    connector: { id: newConnectorId(), moduleId: tool.id, config: {}, credentialRef: 'default' },
  });
  return { ok: true };
}

export function detachTool(toolId: string): void {
  const connectorId = toolAttached(getState().snapshot, toolId);
  if (connectorId) dispatch({ type: 'removeConnector', connectorId });
}

/**
 * Add a call to an API route's body.
 *
 * Tool work only ever runs on the server, so it lands inside a route — and if none is selected it
 * brings its own, the way a database step does.
 */
export function addToolStep(
  apiNodeId: Id,
  toolId: string,
  operationId: string,
): Id | undefined {
  const snapshot = getState().snapshot;
  const api = snapshot.nodes[apiNodeId];
  const connectorId = toolAttached(snapshot, toolId);
  if (!api || api.category !== 'api' || !connectorId) return undefined;

  const node = createToolNode(
    newNodeId(),
    { x: api.position.x, y: api.position.y + 160 },
    connectorId,
    toolId,
    operationId,
  );
  dispatch({ type: 'addNode', node });

  const config = (api.config ?? {}) as { body?: Id[]; path?: string; method?: string };
  const body = [...(config.body ?? []), node.id];
  const bodyNodes = body
    .map((id) => (id === node.id ? node : getState().snapshot.nodes[id]))
    .filter((step): step is NonNullable<typeof step> => Boolean(step));

  // The route's ports are its body's shape, so adding a call retypes the container in the same
  // breath: an "Ask" step's prompt becomes the route's input, ready to wire a field into.
  dispatch({
    type: 'setNodeConfig',
    nodeId: apiNodeId,
    config: {
      ...config,
      body,
      path: config.path && config.path !== 'run' ? config.path : operationId || 'call',
    },
    ports: apiPortsFromBody(bodyNodes),
  });

  select({ kind: 'node', id: node.id });
  return node.id;
}

/**
 * Change what a call does.
 *
 * Picking a different operation retypes the node — its inputs *are* that operation's parameters —
 * and the route holding it is retyped with it.
 */
export function setToolConfig(nodeId: Id, patch: Partial<ToolNodeConfig>): void {
  const snapshot = getState().snapshot;
  const node = snapshot.nodes[nodeId];
  if (!node || node.category !== 'tool') return;

  const config = { ...((node.config ?? {}) as ToolNodeConfig), ...patch };
  const ports = toolNodePorts(config.toolId, config.operationId);

  dispatch({
    type: 'setNodeConfig',
    nodeId,
    config: config as unknown as Record<string, unknown>,
    ports,
  });

  const routeId = routeContaining(getState().snapshot, nodeId);
  if (!routeId) return;

  const route = getState().snapshot.nodes[routeId];
  const body = ((route?.config ?? {}) as { body?: Id[] }).body ?? [];
  const bodyNodes = body
    .map((id) => getState().snapshot.nodes[id])
    .filter((step): step is NonNullable<typeof step> => Boolean(step));

  dispatch({
    type: 'setNodeConfig',
    nodeId: routeId,
    config: (route?.config ?? {}) as Record<string, unknown>,
    ports: apiPortsFromBody(bodyNodes),
  });
}

/** Every tool loom knows, whether or not this project uses it. */
export function knownTools(): readonly ToolManifest[] {
  return TOOLS;
}

/** What a tool can be asked to do — nothing, for the one whose request you write yourself. */
export function operationsOf(toolId: string): { id: string; label: string }[] {
  const tool = toolFor(toolId);
  if (!tool || isRequestTool(toolId)) return [];
  return tool.operations.map((operation) => ({ id: operation.id, label: operation.label }));
}

/** The operation a node is set to, for the inspector to describe. */
export function operationOf(config: Partial<ToolNodeConfig>) {
  return operationFor(String(config.toolId ?? ''), String(config.operationId ?? ''));
}
