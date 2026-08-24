import {
  checkRequestUrl,
  holesIn,
  isRequestTool,
  operationFor,
  toolFor,
  type ToolManifest,
  type ToolNodeConfig,
} from '@loom/connectors';
import type { Node, Snapshot } from '@loom/ir';
import { CompileError } from '../types';

/**
 * Calling a tool (T1–T3, `docs/22-api-connectors.md`).
 *
 * Everything here runs **on the server**, inside an API route, for the same reason a database node
 * does: the credential must not reach a browser. A tool call on a screen is a compile error naming
 * the fix, exactly as a database node outside a route is.
 *
 * What is emitted is plain `fetch`. No vendor SDK: a manifest that says "POST here, with these
 * headers, and the answer is at this path" is smaller than a dependency, and it is the same shape
 * for every tool — which is what makes one node cover an AI model, a payment provider and a
 * webhook receiver without three mechanisms.
 */

/** The value expression for one hole in a body template. */
function holeExpr(name: string, config: Partial<ToolNodeConfig>, node: Node): string {
  // Configured on the node — a model, a token cap. These are decisions, not data flowing through.
  if (name === 'model') {
    const model = String(config.model ?? '').trim();
    if (!model) throw new CompileError('This call has no model chosen.', node.id);
    return JSON.stringify(model);
  }
  if (name === 'maxTokens') {
    const cap = Number(config.maxTokens ?? 1024);
    if (!Number.isFinite(cap) || cap <= 0) {
      throw new CompileError('An answer needs a length limit above zero.', node.id);
    }
    return String(Math.trunc(cap));
  }
  // Everything else arrives as an input on the node, which is a field of the value flowing in.
  return `input[${JSON.stringify(name)}]`;
}

/** A body template, as an emitted expression. */
function bodyExpr(template: unknown, config: Partial<ToolNodeConfig>, node: Node): string {
  if (typeof template === 'string') {
    const match = /^\{\{(\w+)\}\}$/.exec(template);
    return match ? holeExpr(match[1]!, config, node) : JSON.stringify(template);
  }
  if (Array.isArray(template)) {
    return `[${template.map((entry) => bodyExpr(entry, config, node)).join(', ')}]`;
  }
  if (template && typeof template === 'object') {
    const pairs = Object.entries(template).map(
      ([key, value]) => `${JSON.stringify(key)}: ${bodyExpr(value, config, node)}`,
    );
    return `{ ${pairs.join(', ')} }`;
  }
  return JSON.stringify(template ?? null);
}

/** Reading the answer out of the response, defensively — a vendor can answer with anything. */
function answerExpr(path: readonly (string | number)[] | undefined): string {
  if (!path || path.length === 0) return 'body';
  // Optional chaining the whole way: a 200 with a shape nobody expected is a `undefined` here and
  // an error the designer can see, not a crash inside a serverless function.
  return `(body as Record<string, unknown>)${path
    .map((step) => (typeof step === 'number' ? `?.[${step}]` : `?.[${JSON.stringify(step)}]`))
    .join('')}`;
}

/** The connector a tool node is attached to, and the tool it names. */
function toolFrom(node: Node, snapshot: Snapshot): { tool: ToolManifest; config: Partial<ToolNodeConfig> } {
  const config = (node.config ?? {}) as Partial<ToolNodeConfig>;
  const connector = config.connectorId ? snapshot.connectors[config.connectorId] : undefined;
  if (!connector) throw new CompileError('This call is not attached to a tool.', node.id);

  const tool = toolFor(String(config.toolId ?? connector.moduleId));
  if (!tool) {
    throw new CompileError(`"${config.toolId ?? connector.moduleId}" is not a tool loom knows.`, node.id);
  }
  return { tool, config };
}

/** What one tool call does, as lines of the emitted route's body. */
export function toolStep(node: Node, snapshot: Snapshot): string {
  const { tool, config } = toolFrom(node, snapshot);
  const key = `process.env[${JSON.stringify(tool.credential.name)}] ?? ''`;

  const headers: string[] = Object.entries(tool.headers ?? {}).map(
    ([name, value]) => `${JSON.stringify(name)}: ${JSON.stringify(value)}`,
  );
  headers.push(
    tool.auth.kind === 'bearer'
      ? `"authorization": "Bearer " + key`
      : `${JSON.stringify(tool.auth.header)}: key`,
  );

  // A request the designer wrote: the address and method are theirs, the body is whatever is
  // flowing through, and the answer is the whole response.
  if (isRequestTool(tool.id)) {
    const url = String(config.url ?? '');
    try {
      checkRequestUrl(url);
    } catch (error) {
      throw new CompileError((error as Error).message, node.id);
    }

    const method = String(config.method ?? 'POST').toUpperCase();
    const sendsBody = method !== 'GET' && method !== 'DELETE';

    return `  {
    const input = (value ?? {}) as Record<string, unknown>;
    const key = ${key};
    value = await callTool(${JSON.stringify(url)}, {
      method: ${JSON.stringify(method)},
      headers: { ${headers.join(', ')} },${sendsBody ? `
      body: JSON.stringify(input),` : ''}
    });
  }`;
  }

  const operation = operationFor(tool.id, String(config.operationId ?? ''));
  if (!operation) {
    throw new CompileError(
      `"${tool.label}" has no operation called "${String(config.operationId ?? '')}".`,
      node.id,
    );
  }

  // A template naming something the operation does not take would emit `undefined` into a request,
  // so the mismatch is a compile error rather than a confusing 400 from the vendor.
  const known = new Set([...operation.inputs.map((input) => input.name), 'model', 'maxTokens']);
  for (const hole of holesIn(operation.body)) {
    if (!known.has(hole)) {
      throw new CompileError(
        `"${tool.label}: ${operation.label}" asks for "${hole}", which it does not take.`,
        node.id,
      );
    }
  }

  const sendsBody = operation.method !== 'GET' && operation.method !== 'DELETE';

  return `  {
    const input = (value ?? {}) as Record<string, unknown>;
    const key = ${key};
    const body = await callTool(${JSON.stringify(tool.baseUrl + operation.path)}, {
      method: ${JSON.stringify(operation.method)},
      headers: { ${headers.join(', ')} },${
        sendsBody
          ? `
      body: JSON.stringify(${bodyExpr(operation.body ?? {}, config, node)}),`
          : ''
      }
    });
    value = ${answerExpr(operation.answer)};
  }`;
}

/**
 * The helper every tool call goes through.
 *
 * One place for the three things that are easy to leave out and expensive to leave out: a
 * **timeout**, because a hung request in a serverless function is a bill and a hang; an error that
 * carries what the vendor actually said, because "request failed" is unactionable; and a response
 * read as JSON only when it claims to be, since an HTML error page parsed as JSON throws something
 * about `<` that tells nobody anything.
 */
export function toolPrelude(timeoutMs: number): string {
  return `// Generated by @loom/compiler. Tool calls run here, on the server, so the key stays here
// too (docs/22-api-connectors.md).

async function callTool(
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    // Never hangs: a request with no end is a function that bills until it is killed.
    signal: AbortSignal.timeout(${timeoutMs}),
  });

  const type = response.headers.get('content-type') ?? '';
  const payload = type.includes('json') ? await response.json() : await response.text();

  if (!response.ok) {
    // What the service said, not "request failed": the message is the whole value of the error.
    const said =
      typeof payload === 'string'
        ? payload.slice(0, 400)
        : JSON.stringify((payload as { error?: unknown })?.error ?? payload).slice(0, 400);
    throw new Error(\`\${url} answered \${response.status}: \${said}\`);
  }

  return payload;
}
`;
}

/** True when this node is a tool call. */
export function isToolNode(node: Node): boolean {
  return node.category === 'tool';
}

/** Every credential name the tools in this project need, so the deployment can be told. */
export function toolCredentials(snapshot: Snapshot): string[] {
  const names = new Set<string>();

  for (const node of Object.values(snapshot.nodes)) {
    if (node.category !== 'tool') continue;
    const config = (node.config ?? {}) as Partial<ToolNodeConfig>;
    const tool = toolFor(String(config.toolId ?? ''));
    if (tool) names.add(tool.credential.name);
  }

  return [...names].sort();
}

/** The longest any tool in this route is allowed to take. */
export function toolTimeout(snapshot: Snapshot, body: readonly Node[]): number {
  const timeouts = body
    .filter((node) => node.category === 'tool')
    .map((node) => {
      const config = (node.config ?? {}) as Partial<ToolNodeConfig>;
      return toolFor(String(config.toolId ?? ''))?.timeoutMs ?? 30_000;
    });
  return timeouts.length > 0 ? Math.max(...timeouts) : 30_000;
}
