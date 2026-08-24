import { transformSync } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { applyOps, type Snapshot } from '@loom/ir';
import { TOOLS, createToolNode, holesIn } from '@loom/connectors';
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
  // Every tool, not a list someone maintains: a provider added tomorrow is held to these too.
  it('fills every hole in a body template from something the operation takes', () => {
    for (const tool of TOOLS) {
      for (const operation of tool.operations) {
        const known = new Set([...operation.inputs.map((input) => input.name), 'model', 'maxTokens']);
        for (const hole of holesIn(operation.body)) expect(known).toContain(hole);
      }
    }
  });

  it('names every credential the way an environment can hold it', () => {
    for (const tool of TOOLS) {
      expect(tool.credentials.length).toBeGreaterThan(0);
      for (const credential of tool.credentials) {
        expect(credential.name).toMatch(/^[A-Z][A-Z0-9_]*$/);
        expect(credential.label.length).toBeGreaterThan(0);
      }
    }
  });

  it('gives every tool a timeout, because a hung request is a bill', () => {
    for (const tool of TOOLS) expect(tool.timeoutMs).toBeGreaterThan(0);
  });

  it('never writes a credential value into a manifest', () => {
    // A manifest is committed. Anything that looks like a key in one is a key in the repo.
    const text = JSON.stringify(TOOLS);
    expect(text).not.toMatch(/sk-[A-Za-z0-9]/);
    expect(text).not.toMatch(/xoxb-[A-Za-z0-9]/);
  });

  it('reaches every tool over https, or from the environment', () => {
    for (const tool of TOOLS) {
      if (!tool.baseUrl) continue;
      expect(tool.baseUrl.startsWith('https://') || tool.baseUrl.startsWith('{{env:')).toBe(true);
    }
  });
});

describe('the providers beyond the models', () => {
  it('sends Resend what its send-email reference describes', () => {
    // POST https://api.resend.com/emails, bearer auth, JSON with from/to/subject.
    const code = routeFor(toolSnapshot('resend', 'send'));

    expect(code).toContain('https://api.resend.com/emails');
    expect(code).toContain('"authorization": "Bearer " + key');
    expect(code).toContain('"from": input["from"]');
    expect(code).toContain('"subject": input["subject"]');
    expect(code).toContain('?.["id"]');
  });

  it('sends Stripe form encoding with the key as a basic username', () => {
    // Stripe's reference uses `-u "<secret key>"` — basic auth, key as username, no password —
    // and `-d` form fields with nested values as line_items[0][price].
    const code = routeFor(toolSnapshot('stripe', 'checkout'));

    expect(code).toContain('https://api.stripe.com/v1/checkout/sessions');
    expect(code).toContain('"authorization": "Basic " + Buffer.from(');
    expect(code).toContain('STRIPE_SECRET_KEY');
    // Form, not JSON: sending Stripe JSON is a 400 that says nothing useful.
    expect(code).toContain('body: formBody(');
    expect(code).toContain('function formBody(');
    // And what a screen actually needs back is the link, not the session id.
    expect(code).toContain('?.["url"]');
  });

  it('writes nested form fields the way Stripe parses them', () => {
    const code = routeFor(toolSnapshot('stripe', 'checkout'));
    // line_items[0][price] — the bracket shape, built by the helper rather than hand-written.
    expect(code).toContain('${prefix}[${index}]');
    expect(code).toContain('${prefix}[${key}]');
  });

  it('sends Twilio its capitalised parameters, with the SID in the path', () => {
    // POST /2010-04-01/Accounts/{AccountSid}/Messages.json, basic auth with SID and token, form
    // encoded, To/From/Body.
    const code = routeFor(toolSnapshot('twilio', 'sms'));

    expect(code).toContain('https://api.twilio.com/2010-04-01/Accounts/');
    expect(code).toContain('process.env["TWILIO_ACCOUNT_SID"]');
    expect(code).toContain('/Messages.json');
    // Lowercase parameters are simply ignored by Twilio, so the capitals matter.
    expect(code).toContain('"To": input["to"]');
    expect(code).toContain('"Body": input["body"]');
  });

  it('sends Slack a message and reads the field that says whether it worked', () => {
    const code = routeFor(toolSnapshot('slack', 'post'));

    expect(code).toContain('https://slack.com/api/chat.postMessage');
    expect(code).toContain('"channel": input["channel"]');
    // Slack answers 200 even when it refused; `ok` is what says which happened.
    expect(code).toContain('?.["ok"]');
  });

  it('reaches a Home Assistant that lives at an address only the deployment knows', () => {
    const code = routeFor(toolSnapshot('homeAssistant', 'turnOn'));

    // The address is read from the environment, so a shared project does not carry someone's house.
    expect(code).toContain('process.env["HOME_ASSISTANT_URL"]');
    expect(code).toContain('"/api/services/homeassistant/turn_on"');
    expect(code).toContain('"entity_id": input["entity_id"]');
  });

  it('asks the deployment for every name a tool needs, not just its key', () => {
    const example = compile(toolSnapshot('twilio', 'sms')).files.find(
      (file) => file.path === '.env.example',
    )!;
    // Twilio needs the account SID beside the token; naming one of them would be naming half.
    expect(example.content).toContain('TWILIO_ACCOUNT_SID=');
    expect(example.content).toContain('TWILIO_AUTH_TOKEN=');
  });

  it('emits the form helper only where something takes form encoding', () => {
    // The emitted app builds with noUnusedLocals, so an unused helper is a build failure.
    expect(routeFor(toolSnapshot('slack', 'post'))).not.toContain('function formBody(');
  });
});

describe('the form encoder, run rather than read', () => {
  /**
   * The emitted function itself, executed.
   *
   * Reading the source proves it was written; running it proves it encodes what Stripe parses.
   * The function is pulled out of the emitted route rather than copied here, so this cannot drift
   * from what actually ships.
   */
  function emittedFormBody(): (value: unknown) => string {
    const code = routeFor(toolSnapshot('stripe', 'checkout'));
    const start = code.indexOf('function formBody(');
    const end = code.indexOf('\n}\n', start);
    if (start < 0 || end < 0) throw new Error('no formBody in the emitted route');

    // The emitted helper is TypeScript, so it is compiled the way the app compiles it rather than
    // having its types stripped by hand.
    const source = code.slice(start, end + 2);
    const js = transformSync(source, { loader: 'ts' }).code;
    return new Function(`${js}; return formBody;`)() as (value: unknown) => string;
  }

  it('writes nested values the way Stripe reads them', () => {
    const formBody = emittedFormBody();
    const encoded = formBody({
      mode: 'payment',
      line_items: [{ price: 'price_123', quantity: 2 }],
    });

    const pairs = encoded.split('&').map((pair) => decodeURIComponent(pair));
    expect(pairs).toContain('mode=payment');
    expect(pairs).toContain('line_items[0][price]=price_123');
    expect(pairs).toContain('line_items[0][quantity]=2');
  });

  it('leaves out what was never filled in', () => {
    const formBody = emittedFormBody();
    // An optional input nobody supplied must not arrive as the word "undefined".
    const encoded = formBody({ mode: 'payment', cancel_url: undefined, note: '' });
    expect(encoded).toBe('mode=payment');
  });

  it('escapes what would otherwise change the shape', () => {
    const formBody = emittedFormBody();
    const encoded = formBody({ success_url: 'https://example.com/done?a=1&b=2' });
    // The ampersand inside a value must not read as another pair.
    expect(encoded.split('&')).toHaveLength(1);
    expect(decodeURIComponent(encoded)).toBe('success_url=https://example.com/done?a=1&b=2');
  });
});

describe('what is declared in the emitted route', () => {
  it('declares the key only where the auth style reads it', () => {
    // The emitted app builds with noUnusedLocals, so a `const key` nothing uses is a build
    // failure. Basic auth builds its header from the environment directly.
    expect(routeFor(toolSnapshot('anthropic'))).toContain('const key =');
    expect(routeFor(toolSnapshot('stripe', 'checkout'))).not.toContain('const key =');
    expect(routeFor(toolSnapshot('twilio', 'sms'))).not.toContain('const key =');
  });
});
