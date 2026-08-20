import { COMPUTE_OPS, gateMessage, type GateConfig, type ValidationField } from '@loom/components';
import type { DbNodeConfig } from '@loom/connectors';
import type { Node, Snapshot } from '@loom/ir';
import { CompileError, type EmittedFile } from '../types';
import type { PipelinePlan } from './pipeline';

/**
 * Server emission: an API route node becomes one Vercel serverless function. The nodes inside
 * its body run here and nowhere else — the container boundary is the network boundary
 * (`docs/specs/binding-trigger-runtime.md`).
 *
 * The handler is written against plain `node:http` types, which is what the Vercel Node runtime
 * hands it, so the same file runs unchanged in the Preview's dev middleware and on Vercel.
 */

/**
 * A database step. It runs here and only here: the service-role key is server-scoped, and the
 * container boundary is the boundary it may not cross (`docs/specs/connector-credentials.md`).
 * The key is read from the environment **by name** — the compiler never emits a secret.
 */
function emitDbStep(node: Node, snapshot: Snapshot): string {
  const config = (node.config ?? {}) as Partial<DbNodeConfig>;
  const table = String(config.table ?? '');
  if (!table) throw new CompileError('Database node has no table selected.', node.id);

  const connector = config.connectorId ? snapshot.connectors[config.connectorId] : undefined;
  if (!connector) {
    throw new CompileError('Database node is not attached to a connection.', node.id);
  }
  if (connector.moduleId !== 'supabase') {
    throw new CompileError(`Unsupported connector "${connector.moduleId}".`, node.id);
  }

  if (config.operation === 'insert') {
    return `  {
    const row = (value ?? {}) as Record<string, unknown>;
    const { data, error } = await supabase.from(${JSON.stringify(table)}).insert(row).select().single();
    if (error) throw new Error(error.message);
    value = data;
  }`;
  }

  const limit = Number(config.limit ?? 100);
  const orderBy = String(config.orderBy ?? '').trim();
  // Sorting and limiting belong to the query, not to a loop the designer would have to write.
  const order = orderBy
    ? `
      .order(${JSON.stringify(orderBy)}, { ascending: ${config.descending ? 'false' : 'true'} })`
    : '';

  return `  {
    const { data, error } = await supabase
      .from(${JSON.stringify(table)})
      .select('*')${order}
      .limit(${Number.isFinite(limit) ? limit : 100});
    if (error) throw new Error(error.message);
    value = data ?? [];
  }`;
}

/**
 * A Validate step. Checking runs on the server because that is the only place it cannot be
 * bypassed: the browser copy is a convenience, this one is the rule. It also coerces — an
 * `<input>` hands over strings, and a number column will not take one.
 */
function emitValidateStep(node: Node): string {
  const config = (node.config ?? {}) as { fields?: ValidationField[] };
  const fields = Array.isArray(config.fields) ? config.fields : [];
  if (fields.length === 0) {
    throw new CompileError('Validate node has no fields to check.', node.id);
  }

  const checks = fields.map((field) => {
    const key = JSON.stringify(field.name);
    const missing = field.required
      ? `    if (raw === undefined || raw === null || raw === '') {
      throw new Error(${JSON.stringify(`${field.name} is required.`)});
    }`
      : `    if (raw === undefined || raw === null || raw === '') { delete row[${key}]; }`;

    const coerce =
      field.type.kind === 'number'
        ? `    else {
      const parsed = Number(raw);
      if (Number.isNaN(parsed)) throw new Error(${JSON.stringify(`${field.name} must be a number.`)});
      row[${key}] = parsed;
    }`
        : field.type.kind === 'boolean'
          ? `    else { row[${key}] = raw === true || raw === 'true'; }`
          : `    else { row[${key}] = String(raw); }`;

    return `  {
    const raw = input[${key}];
${missing}
${coerce}
  }`;
  });

  return `  {
    const input = (value ?? {}) as Record<string, unknown>;
    const row: Record<string, unknown> = { ...input };
${checks.join('\n')}
    value = row;
  }`;
}


/**
 * A Gate. The condition holds or the request ends — the pipeline's one piece of control flow
 * (`docs/06-glossary.md`). It runs on the server for the same reason validation does: a check the
 * browser could skip is not a check.
 */
function emitGateStep(node: Node): string {
  const config = (node.config ?? {}) as Partial<GateConfig>;
  const condition = config.condition ?? 'isFilled';
  const field = String(config.field ?? '').trim();
  const comparand = JSON.stringify(String(config.value ?? ''));

  const subject = field
    ? `((value ?? {}) as Record<string, unknown>)[${JSON.stringify(field)}]`
    : 'value';

  const tests: Record<string, string> = {
    isFilled: `subject !== undefined && subject !== null && subject !== ''`,
    isEmpty: `subject === undefined || subject === null || subject === ''`,
    isTrue: `subject === true || subject === 'true'`,
    isFalse: `subject === false || subject === 'false' || subject === undefined || subject === null`,
    equals: `String(subject) === ${comparand}`,
    notEquals: `String(subject) !== ${comparand}`,
    greaterThan: `Number(subject) > Number(${comparand})`,
    lessThan: `Number(subject) < Number(${comparand})`,
  };

  const test = tests[condition];
  if (!test) {
    throw new CompileError(
      `Gate has unknown condition "${condition}". Known: ${Object.keys(tests).join(', ')}.`,
      node.id,
    );
  }

  return `  {
    const subject: unknown = ${subject};
    if (!(${test})) throw new Error(${JSON.stringify(gateMessage(config))});
  }`;
}

/** One server-side step, as a statement operating on `value`. */
function emitStep(node: Node, snapshot: Snapshot): string {
  if (node.category === 'db') return emitDbStep(node, snapshot);
  if (node.kind === 'validate') return emitValidateStep(node);
  if (node.kind === 'gate') return emitGateStep(node);

  const config = (node.config ?? {}) as { op?: string; source?: string };

  if (node.kind === 'compute') {
    const op = String(config.op ?? '');
    switch (op) {
      case 'uppercase':
        return '  value = String(value).toUpperCase();';
      case 'lowercase':
        return '  value = String(value).toLowerCase();';
      case 'trim':
        return '  value = String(value).trim();';
      case 'length':
        return '  value = String(value).length;';
      case 'double':
        return '  value = Number(value) * 2;';
      case 'negate':
        return '  value = -Number(value);';
      case 'isEmpty':
        return `  value = value === undefined || value === null || String(value).trim() === '';`;
      case 'not':
        return '  value = !(value === true || value === "true");';
      default:
        throw new CompileError(
          `Compute node has unknown operation "${op}". Known: ${Object.keys(COMPUTE_OPS).join(', ')}.`,
          node.id,
        );
    }
  }

  if (node.kind === 'code') {
    const source = String(config.source ?? '').trim();
    if (source.length === 0) {
      throw new CompileError('Code node has an empty body.', node.id);
    }
    // The escape hatch (guardrail 7): the designer's own statements, run over `value`.
    return `  value = await (async (input: unknown) => {
${source
  .split('\n')
  .map((line) => `    ${line}`)
  .join('\n')}
  })(value);`;
  }

  throw new CompileError(
    `Node kind "${node.category}:${node.kind}" cannot run inside an API route.`,
    node.id,
  );
}

export function emitApiFunction(plan: PipelinePlan, snapshot: Snapshot): EmittedFile {
  const steps = plan.body.map((node) => emitStep(node, snapshot));
  const routeName = plan.routePath.replace('/api/', '');
  const usesDb = plan.body.some((node) => node.category === 'db');

  // A serverless route talks REST, so it takes Supabase's REST client rather than the full
  // supabase-js: the umbrella package builds a realtime client on import, which needs Node 22's
  // native WebSocket and is dead weight in a stateless function. Same query API either way.
  const dbPrelude = usesDb
    ? `import { PostgrestClient } from '@supabase/postgrest-js';

// Credentials are read by NAME from the environment; the value never enters the document,
// the snapshot, or this file (docs/05-guardrails.md #1).
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const supabase = new PostgrestClient(\`\${process.env.SUPABASE_URL ?? ''}/rest/v1\`, {
  headers: { apikey: serviceKey, Authorization: \`Bearer \${serviceKey}\` },
});
`
    : '';

  return {
    path: `api/${routeName}.ts`,
    content: `// Generated by @loom/compiler from API route "${plan.node.name ?? plan.node.id}" (${plan.node.id}).
// Runs on the server only. Everything in this file is inside the API node's body.
import type { IncomingMessage, ServerResponse } from 'node:http';
${dbPrelude}
async function readInput(req: IncomingMessage): Promise<unknown> {
  if (req.method === 'GET') {
    const url = new URL(req.url ?? '/', 'http://localhost');
    return url.searchParams.get('input');
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return null;

  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    return (JSON.parse(raw) as { input?: unknown }).input ?? null;
  } catch {
    return raw;
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader('content-type', 'application/json');

  try {
    let value: unknown = await readInput(req);

${steps.join('\n')}

    res.statusCode = 200;
    res.end(JSON.stringify({ result: value }));
  } catch (error) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
}
`,
  };
}

/**
 * A dev-only Vite plugin for the emitted app so the Preview serves the same handler files Vercel
 * will run. Emitted into the app's own vite.config.ts; Vercel never sees it.
 */
export const DEV_API_PLUGIN = `
/**
 * Dev-only: serve api/*.ts through the same handler signature Vercel uses, so the Preview runs
 * the real server code rather than a stub.
 */
function loomDevApi(): Plugin {
  return {
    name: 'loom:dev-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        if (!url.startsWith('/api/')) return next();
        const name = url.slice('/api/'.length).split('?')[0];
        void (async () => {
          try {
            const module = await server.ssrLoadModule('/api/' + name + '.ts');
            await (module.default as (req: unknown, res: unknown) => Promise<void>)(req, res);
          } catch (error) {
            res.statusCode = 500;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ error: (error as Error).message }));
          }
        })();
      });
    },
  };
}
`;
