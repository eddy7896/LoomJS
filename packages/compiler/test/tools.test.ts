import { describe, expect, it } from 'vitest';
import { applyOps, type Snapshot } from '@loom/ir';
import { ANTHROPIC_TOOL, OPENAI_TOOL, createToolNode, holesIn } from '@loom/connectors';
import { compile } from '../src/index';
import { toolSnapshot, trivialSnapshot } from './fixtures';

/**
 * Calling a tool (T1–T3, `docs/22-api-connectors.md`).
 *
 * Two things are being pinned. First, that the vendors' shapes are the ones their own published
 * material describes — every one of these was read from that material, and the comment says which.
 * Second, that a key stays on the server, which is the reason tool calls are emitted into routes
 * at all.
 */

const routeFor = (snapshot: Snapshot): string => {
  const file = compile(snapshot).files.find((entry) => entry.path.startsWith('api/'));
  if (!file) throw new Error('no route emitted');
  return file.content;
};

describe('the request that goes out', () => {
  it('sends Claude what the Claude API says it needs', () => {
    // Verified against the Claude API overview: x-api-key, anthropic-version and content-type are
    // required on every request; the Messages API is POST /v1/messages with model, max_tokens and
    // messages.
    const code = routeFor(toolSnapshot('anthropic', 'ask', { model: 'claude-sonnet-4-5' }));

    expect(code).toContain('https://api.anthropic.com/v1/messages');
    expect(code).toContain('"anthropic-version": "2023-06-01"');
    expect(code).toContain('"x-api-key": key');
    expect(code).toContain('"model": "claude-sonnet-4-5"');
    expect(code).toContain('"max_tokens": 1024');
    expect(code).toContain('"role": "user", "content": input["prompt"]');
  });

  it('sends OpenAI what its OpenAPI document says it needs', () => {
    // Verified against OpenAI's published OpenAPI: server https://api.openai.com/v1, HTTP bearer
    // auth, POST /chat/completions with model and messages.
    const code = routeFor(toolSnapshot('openai', 'ask', { model: 'gpt-4o-mini' }));

    expect(code).toContain('https://api.openai.com/v1/chat/completions');
    expect(code).toContain('"authorization": "Bearer " + key');
    expect(code).toContain('"model": "gpt-4o-mini"');
  });

  it('reads the answer from where the vendor puts it', () => {
    // Claude answers with content blocks; OpenAI with choices. Both are optional-chained, because
    // a 200 with an unexpected shape should be a readable error and not a crash.
    expect(routeFor(toolSnapshot('anthropic'))).toContain('?.["content"]?.[0]?.["text"]');
    expect(routeFor(toolSnapshot('openai'))).toContain(
      '?.["choices"]?.[0]?.["message"]?.["content"]',
    );
  });
});

describe('the key', () => {
  it('is read by name on the server, and never appears anywhere else', () => {
    const files = compile(toolSnapshot()).files;
    const route = files.find((file) => file.path.startsWith('api/'))!;

    expect(route.content).toContain('process.env["ANTHROPIC_API_KEY"]');

    // Not in the browser bundle, and not in the document: a tool key is a credential like any
    // other (docs/05-guardrails.md #1).
    for (const file of files.filter((entry) => entry.path.startsWith('src/'))) {
      expect(file.content).not.toContain('ANTHROPIC_API_KEY');
    }
    expect(JSON.stringify(toolSnapshot())).not.toContain('sk-');
  });

  it('asks the deployment for the names its tools need', () => {
    const example = compile(toolSnapshot()).files.find((file) => file.path === '.env.example');
    expect(example?.content).toContain('ANTHROPIC_API_KEY=');
  });
});

describe('a request the designer writes', () => {
  const request = (config: Record<string, unknown>): Snapshot =>
    toolSnapshot('request', '', config);

  it('goes where they said, carrying what is flowing through', () => {
    const code = routeFor(request({ url: 'https://example.com/hook', method: 'POST' }));
    expect(code).toContain('https://example.com/hook');
    expect(code).toContain('body: JSON.stringify(input)');
  });

  it('sends no body on a method that has none', () => {
    const code = routeFor(request({ url: 'https://example.com/thing', method: 'GET' }));
    expect(code).not.toContain('body: JSON.stringify(input)');
  });

  it('refuses plain http, which would carry the key in the open', () => {
    expect(() => compile(request({ url: 'http://example.com/hook' }))).toThrow(/goes over https/);
    // localhost is the exception a developer actually needs, and it never leaves the machine.
    expect(() => compile(request({ url: 'http://localhost:9000/hook' }))).not.toThrow();
  });

  it('refuses something that is not an address at all', () => {
    expect(() => compile(request({ url: 'example.com' }))).toThrow(/not a web address/);
  });
});

describe('what is refused', () => {
  it('refuses a call with no model chosen', () => {
    expect(() => compile(toolSnapshot('anthropic', 'ask', { model: '' }))).toThrow(
      /no model chosen/,
    );
  });

  it('refuses an answer length of nothing', () => {
    expect(() => compile(toolSnapshot('anthropic', 'ask', { maxTokens: 0 }))).toThrow(
      /length limit above zero/,
    );
  });

  it('refuses an operation the tool does not have', () => {
    expect(() => compile(toolSnapshot('anthropic', 'summarise'))).toThrow(/no operation called/);
  });

  it('refuses a call that is not attached to a tool', () => {
    const loose = applyOps(trivialSnapshot(), [
      {
        type: 'addNode',
        node: {
          ...createToolNode('nd_loose', { x: 0, y: 0 }, 'cn_missing', 'anthropic', 'ask'),
        },
      },
      {
        type: 'addNode',
        node: {
          id: 'nd_route',
          category: 'api',
          kind: 'route',
          name: 'Ask',
          position: { x: 0, y: 0 },
          config: { method: 'POST', path: 'ask', body: ['nd_loose'] },
          ports: [],
        },
      },
      {
        type: 'addComponent',
        parentId: 'cp_root000001',
        component: {
          id: 'cp_answer',
          type: 'Text',
          name: 'Answer',
          props: { content: { kind: 'bound', source: { nodeId: 'nd_route', portId: 'pt_result' } } },
        },
      },
    ]);
    expect(() => compile(loose)).toThrow(/not attached to a tool/);
  });
});

describe('the helper every call goes through', () => {
  const code = () => routeFor(toolSnapshot());

  it('never hangs', () => {
    // A request with no end is a function that bills until it is killed.
    expect(code()).toContain('AbortSignal.timeout(60000)');
  });

  it('says what the service said, rather than "request failed"', () => {
    expect(code()).toContain('answered ${response.status}');
  });

  it('reads JSON only when the answer claims to be JSON', () => {
    // An HTML error page parsed as JSON throws something about `<` that tells nobody anything.
    expect(code()).toContain("type.includes('json')");
  });
});

describe('the manifests themselves', () => {
  it('fills every hole in a body template from something the operation takes', () => {
    for (const tool of [ANTHROPIC_TOOL, OPENAI_TOOL]) {
      for (const operation of tool.operations) {
        const known = new Set([...operation.inputs.map((input) => input.name), 'model', 'maxTokens']);
        for (const hole of holesIn(operation.body)) expect(known).toContain(hole);
      }
    }
  });

  it('keeps every key server-scoped, with a name the deployment can set', () => {
    for (const tool of [ANTHROPIC_TOOL, OPENAI_TOOL]) {
      expect(tool.credential.name).toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect(tool.timeoutMs).toBeGreaterThan(0);
    }
  });
});
