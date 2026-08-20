import {
  COMPUTE_OPS,
  gateMessage,
  type GateConfig,
  type OperandConfig,
  type ValidationField,
} from '@loom/components';
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

/**
 * Operator steps (Math, Compare, Logic). Each reads named fields of the record flowing through,
 * computes one value, and writes it back into a named field — so the pipeline stays a single
 * value moving forward, which is what makes a route body readable top to bottom.
 */

/** The expression for one side of an operation. A blank left side means the whole value. */
function operandExpr(config: Partial<OperandConfig>, side: 'left' | 'right'): string {
  if (side === 'left') {
    const field = String(config.left ?? '').trim();
    return field ? `source[${JSON.stringify(field)}]` : 'value';
  }
  const raw = String(config.right ?? '').trim();
  return config.rightKind === 'field' ? `source[${JSON.stringify(raw)}]` : JSON.stringify(raw);
}

const NEWLINE = String.fromCharCode(10);

/**
 * Whether the step reads the incoming record at all. The emitted app builds with
 * `noUnusedLocals`, so a `source` nobody reads fails its own `tsc` — declaring it unconditionally
 * would turn "left blank, right a literal" into a broken build.
 */
function needsSource(config: Partial<OperandConfig>): boolean {
  return Boolean(
    String(config.left ?? '').trim() ||
      config.rightKind === 'field' ||
      String(config.into ?? '').trim(),
  );
}

const sourceLine = (config: Partial<OperandConfig>): string =>
  needsSource(config)
    ? `    const source = (value ?? {}) as Record<string, unknown>;${NEWLINE}`
    : '';

/** How the answer rejoins the pipeline: into a named field, or as the whole value. */
function writeBack(config: Partial<OperandConfig>): string {
  const into = String(config.into ?? '').trim();
  return into ? `value = { ...source, [${JSON.stringify(into)}]: answer };` : 'value = answer;';
}

const MATH_EXPRESSIONS: Record<string, string> = {
  add: 'left + right',
  subtract: 'left - right',
  multiply: 'left * right',
  divide: 'left / right',
  remainder: 'left % right',
  min: 'Math.min(left, right)',
  max: 'Math.max(left, right)',
};

function emitMathStep(node: Node): string {
  const config = (node.config ?? {}) as Partial<OperandConfig> & { operator?: string };
  const operator = config.operator ?? 'add';
  const expression = MATH_EXPRESSIONS[operator];
  if (!expression) {
    throw new CompileError(
      `Math has unknown operation "${operator}". Known: ${Object.keys(MATH_EXPRESSIONS).join(', ')}.`,
      node.id,
    );
  }

  const subject = String(config.left ?? '').trim() || 'the value';
  // Dividing by zero yields Infinity in JavaScript, which lands in a numeric column as a number
  // nobody meant. A named failure beats a plausible wrong answer.
  const guard =
    operator === 'divide' || operator === 'remainder'
      ? `
    if (right === 0) throw new Error(${JSON.stringify(`Cannot divide ${subject} by zero.`)});`
      : '';

  return `  {
${sourceLine(config)}    const left = Number(${operandExpr(config, 'left')});
    const right = Number(${operandExpr(config, 'right')});
    if (Number.isNaN(left) || Number.isNaN(right)) {
      throw new Error(${JSON.stringify(`${subject} and ${String(config.right ?? '').trim() || 'the value'} must both be numbers.`)});
    }${guard}
    const answer = ${expression};
    ${writeBack(config)}
  }`;
}

const COMPARE_EXPRESSIONS: Record<string, string> = {
  equals: 'String(left) === String(right)',
  notEquals: 'String(left) !== String(right)',
  greaterThan: 'Number(left) > Number(right)',
  lessThan: 'Number(left) < Number(right)',
  atLeast: 'Number(left) >= Number(right)',
  atMost: 'Number(left) <= Number(right)',
};

function emitCompareStep(node: Node): string {
  const config = (node.config ?? {}) as Partial<OperandConfig> & { operator?: string };
  const operator = config.operator ?? 'equals';
  const expression = COMPARE_EXPRESSIONS[operator];
  if (!expression) {
    throw new CompileError(
      `Compare has unknown condition "${operator}". Known: ${Object.keys(COMPARE_EXPRESSIONS).join(', ')}.`,
      node.id,
    );
  }

  // Equality compares as text so a form's "3" matches a column's 3; ordering compares as numbers,
  // because "10" < "9" is true as text and false as arithmetic.
  return `  {
${sourceLine(config)}    const left: unknown = ${operandExpr(config, 'left')};
    const right: unknown = ${operandExpr(config, 'right')};
    const answer = ${expression};
    ${writeBack(config)}
  }`;
}

function emitLogicStep(node: Node): string {
  const config = (node.config ?? {}) as Partial<OperandConfig> & { operator?: string };
  const operator = config.operator ?? 'and';
  if (operator !== 'and' && operator !== 'or') {
    throw new CompileError(`Logic has unknown operation "${operator}". Known: and, or.`, node.id);
  }

  // A checkbox arrives as a boolean; the same value read back from a form field arrives as the
  // string "true". Both mean checked.
  return `  {
${sourceLine(config)}    const truthy = (input: unknown): boolean => input === true || input === 'true';
    const left = truthy(${operandExpr(config, 'left')});
    const right = truthy(${operandExpr(config, 'right')});
    const answer = left ${operator === 'and' ? '&&' : '||'} right;
    ${writeBack(config)}
  }`;
}

/** One server-side step, as a statement operating on `value`. */
function emitStep(node: Node, snapshot: Snapshot): string {
  if (node.category === 'db') return emitDbStep(node, snapshot);
  if (node.kind === 'validate') return emitValidateStep(node);
  if (node.kind === 'gate') return emitGateStep(node);
  if (node.kind === 'math') return emitMathStep(node);
  if (node.kind === 'compare') return emitCompareStep(node);
  if (node.kind === 'logic') return emitLogicStep(node);

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
