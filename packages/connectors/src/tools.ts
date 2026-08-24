import type { Node, Port, TypeRef } from '@loom/ir';
import { ConnectorError } from './module';

/**
 * Tools: the things that are not databases (T1–T3, `docs/22-api-connectors.md`).
 *
 * A data connector ends up as tables with typed columns. A tool does not, and pretending otherwise
 * is what kept AI models, payment providers and mail out of loom entirely. What a tool *is*, in
 * one line: **a typed call** — a named operation with inputs, an answer, and a credential nobody
 * ever sees.
 *
 * Every endpoint, header and response path in this file was read from the vendor's own published
 * material and is pinned in a test that says where it came from. None of it is remembered.
 */

export interface ToolInput {
  name: string;
  type: TypeRef;
  /** A value the call cannot be made without. */
  required?: boolean;
  /** What it is, in the inspector. */
  hint?: string;
}

export interface ToolOperation {
  id: string;
  label: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Appended to the tool's base URL. */
  path: string;
  inputs: readonly ToolInput[];
  /**
   * The request body, as a shape with `{{name}}` holes.
   *
   * Data rather than a function, so the emitter can walk it and a test can read it. A hole is
   * filled from an input of the same name — never from anything a designer typed directly into a
   * URL or a header.
   */
  body?: unknown;
  /**
   * Where the useful answer is in the response.
   *
   * `['choices', 0, 'message', 'content']` rather than a hand-written expression, so the path is
   * something a test can compare against the vendor's schema.
   */
  answer?: readonly (string | number)[];
  /** What the answer holds, once it is found. */
  answerType?: TypeRef;
  /**
   * True when running it twice is the same as running it once.
   *
   * Nothing retries by default; this is what marks the operations where a retry *could* be
   * offered. A retried charge is a second charge.
   */
  idempotent?: boolean;
}

export interface ToolCredential {
  name: string;
  label: string;
  hint?: string;
  /**
   * For the services that do not want one — a public endpoint, a webhook receiver. Demanding a key
   * there would make the tool unusable for the thing it is most useful for.
   */
  optional?: boolean;
}

/** What category of thing this is, so the tab can group them the way a person thinks about them. */
export type ToolFamily = 'ai' | 'email' | 'payments' | 'messaging' | 'iot' | 'generic';

export interface ToolManifest {
  id: string;
  label: string;
  kind: 'tool';
  family: ToolFamily;
  /**
   * Where it lives.
   *
   * `{{env:NAME}}` for a service the project hosts itself — Home Assistant runs at your house, and
   * its address is a fact about a deployment rather than about the tool.
   */
  baseUrl: string;
  /**
   * Every name this tool needs from the environment, in the order the panel asks for them.
   *
   * More than one because vendors need more than one: Twilio wants an account SID beside its
   * token, and a self-hosted service wants its own address. All of them are read on the server by
   * name, and none of them enters the document.
   */
  credentials: readonly ToolCredential[];
  /**
   * How the credential is presented. Vendors disagree, and guessing is a 401 nobody can read.
   *
   * `basic` carries a username and a password: Stripe puts the key in the username and leaves the
   * password blank, Twilio uses the account SID and the token.
   */
  auth:
    | { kind: 'bearer' }
    | { kind: 'header'; header: string }
    | { kind: 'basic'; user: string; password?: string }
    | { kind: 'none' };
  /**
   * How the body is written.
   *
   * Not everything speaks JSON: Stripe and Twilio take form encoding, with nested values written
   * as `line_items[0][price]`. Sending JSON to either is a 400 that says nothing useful.
   */
  encoding?: 'json' | 'form';
  /** Headers every request carries, regardless of operation. */
  headers?: Readonly<Record<string, string>>;
  operations: readonly ToolOperation[];
  /**
   * How long to wait before giving up.
   *
   * A hung request in a serverless function is a bill and a hang, so this has a default and can be
   * raised — never removed (`docs/22-api-connectors.md`).
   */
  timeoutMs: number;
}

const TEXT: TypeRef = { kind: 'text' };

/**
 * Claude.
 *
 * Verified against the Claude API overview: `x-api-key`, `anthropic-version` and `content-type`
 * are required on every request; the Messages API is `POST /v1/messages` with `model`,
 * `max_tokens` and `messages`; the assistant's text is a content block of type `text`, so the
 * answer is `content[0].text`.
 */
export const ANTHROPIC_TOOL: ToolManifest = {
  id: 'anthropic',
  label: 'Claude',
  kind: 'tool',
  family: 'ai',
  baseUrl: 'https://api.anthropic.com',
  credentials: [
    {
      name: 'ANTHROPIC_API_KEY',
      label: 'API key',
      hint: 'From the Claude Console. It stays on the server.',
    },
  ],
  auth: { kind: 'header', header: 'x-api-key' },
  headers: { 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
  timeoutMs: 60_000,
  operations: [
    {
      id: 'ask',
      label: 'Ask',
      method: 'POST',
      path: '/v1/messages',
      inputs: [
        { name: 'prompt', type: TEXT, required: true, hint: 'What to ask' },
        { name: 'system', type: TEXT, hint: 'Standing instructions, if any' },
      ],
      body: {
        model: '{{model}}',
        max_tokens: '{{maxTokens}}',
        system: '{{system}}',
        messages: [{ role: 'user', content: '{{prompt}}' }],
      },
      answer: ['content', 0, 'text'],
      answerType: TEXT,
    },
  ],
};

/**
 * OpenAI.
 *
 * Verified against OpenAI's published OpenAPI document: the server is `https://api.openai.com/v1`,
 * authentication is HTTP bearer, chat completions are `POST /chat/completions` with `model` and
 * `messages`, and the assistant's text is `choices[0].message.content`.
 */
export const OPENAI_TOOL: ToolManifest = {
  id: 'openai',
  label: 'OpenAI',
  kind: 'tool',
  family: 'ai',
  baseUrl: 'https://api.openai.com/v1',
  credentials: [
    {
      name: 'OPENAI_API_KEY',
      label: 'API key',
      hint: 'From the OpenAI dashboard. It stays on the server.',
    },
  ],
  auth: { kind: 'bearer' },
  headers: { 'content-type': 'application/json' },
  timeoutMs: 60_000,
  operations: [
    {
      id: 'ask',
      label: 'Ask',
      method: 'POST',
      path: '/chat/completions',
      inputs: [
        { name: 'prompt', type: TEXT, required: true, hint: 'What to ask' },
        { name: 'system', type: TEXT, hint: 'Standing instructions, if any' },
      ],
      body: {
        model: '{{model}}',
        messages: [
          { role: 'system', content: '{{system}}' },
          { role: 'user', content: '{{prompt}}' },
        ],
      },
      answer: ['choices', 0, 'message', 'content'],
      answerType: TEXT,
    },
  ],
};

/**
 * A request the designer describes themselves (T1).
 *
 * The honest fallback, and what everyone reaching for the Code node is already doing by hand. It
 * has no operations of its own: the method, the path and the body live on the node, because that
 * is the whole point of it.
 */
export const REQUEST_TOOL: ToolManifest = {
  id: 'request',
  label: 'HTTP request',
  kind: 'tool',
  family: 'generic',
  baseUrl: '',
  credentials: [
    {
      name: 'TOOL_API_KEY',
      label: 'API key (optional)',
      hint: 'Sent as a bearer token when the service wants one.',
      optional: true,
    },
  ],
  auth: { kind: 'bearer' },
  headers: { 'content-type': 'application/json' },
  timeoutMs: 30_000,
  operations: [],
};

/**
 * Resend — email.
 *
 * Verified against Resend's send-email reference: `POST https://api.resend.com/emails`, bearer
 * auth, JSON with `from`, `to` and `subject` required, and an `id` in the answer.
 */
export const RESEND_TOOL: ToolManifest = {
  id: 'resend',
  label: 'Resend',
  kind: 'tool',
  family: 'email',
  baseUrl: 'https://api.resend.com',
  credentials: [
    { name: 'RESEND_API_KEY', label: 'API key', hint: 'From the Resend dashboard.' },
  ],
  auth: { kind: 'bearer' },
  headers: { 'content-type': 'application/json' },
  encoding: 'json',
  timeoutMs: 30_000,
  operations: [
    {
      id: 'send',
      label: 'Send email',
      method: 'POST',
      path: '/emails',
      inputs: [
        { name: 'from', type: TEXT, required: true, hint: 'A verified sender address' },
        { name: 'to', type: TEXT, required: true },
        { name: 'subject', type: TEXT, required: true },
        { name: 'html', type: TEXT, hint: 'The body, as HTML' },
      ],
      body: { from: '{{from}}', to: '{{to}}', subject: '{{subject}}', html: '{{html}}' },
      answer: ['id'],
      answerType: TEXT,
    },
  ],
};

/**
 * Stripe — payments.
 *
 * Verified against Stripe's create-a-Checkout-Session reference: `POST
 * https://api.stripe.com/v1/checkout/sessions`, `-u "<secret key>"` (HTTP basic with the key as
 * the username and no password), **form encoding** with nested values written as
 * `line_items[0][price]`, and the hosted page's address in `url`.
 *
 * Checkout rather than raw payment intents on purpose: a hosted page is the version that does not
 * put card details anywhere near an app loom generated.
 */
export const STRIPE_TOOL: ToolManifest = {
  id: 'stripe',
  label: 'Stripe',
  kind: 'tool',
  family: 'payments',
  baseUrl: 'https://api.stripe.com',
  credentials: [
    { name: 'STRIPE_SECRET_KEY', label: 'Secret key', hint: 'The one starting sk_. Never the publishable key.' },
  ],
  auth: { kind: 'basic', user: '{{env:STRIPE_SECRET_KEY}}' },
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  encoding: 'form',
  timeoutMs: 30_000,
  operations: [
    {
      id: 'checkout',
      label: 'Start a checkout',
      method: 'POST',
      path: '/v1/checkout/sessions',
      inputs: [
        { name: 'price', type: TEXT, required: true, hint: 'A price id from Stripe' },
        { name: 'quantity', type: { kind: 'number' }, hint: 'How many' },
        { name: 'successUrl', type: TEXT, required: true, hint: 'Where to send them afterwards' },
        { name: 'cancelUrl', type: TEXT },
      ],
      body: {
        mode: 'payment',
        success_url: '{{successUrl}}',
        cancel_url: '{{cancelUrl}}',
        line_items: [{ price: '{{price}}', quantity: '{{quantity}}' }],
      },
      // The address to send the customer to. Not the session id: what a screen needs is the link.
      answer: ['url'],
      answerType: TEXT,
    },
  ],
};

/**
 * Twilio — messages.
 *
 * Verified against Twilio's message resource: `POST
 * https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json`, HTTP basic with the
 * account SID and auth token, form encoding, and `To`, `From` and `Body` as the parameters — with
 * the capital letters Twilio actually uses.
 */
export const TWILIO_TOOL: ToolManifest = {
  id: 'twilio',
  label: 'Twilio',
  kind: 'tool',
  family: 'messaging',
  baseUrl: 'https://api.twilio.com/2010-04-01/Accounts/{{env:TWILIO_ACCOUNT_SID}}',
  credentials: [
    { name: 'TWILIO_ACCOUNT_SID', label: 'Account SID', hint: 'Starts with AC.' },
    { name: 'TWILIO_AUTH_TOKEN', label: 'Auth token' },
  ],
  auth: { kind: 'basic', user: '{{env:TWILIO_ACCOUNT_SID}}', password: '{{env:TWILIO_AUTH_TOKEN}}' },
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  encoding: 'form',
  timeoutMs: 30_000,
  operations: [
    {
      id: 'sms',
      label: 'Send a message',
      method: 'POST',
      path: '/Messages.json',
      inputs: [
        { name: 'to', type: TEXT, required: true, hint: 'In +country format' },
        { name: 'from', type: TEXT, required: true, hint: 'A number you own on Twilio' },
        { name: 'body', type: TEXT, required: true },
      ],
      // Twilio's parameters are capitalised, and lowercase ones are simply ignored.
      body: { To: '{{to}}', From: '{{from}}', Body: '{{body}}' },
      answer: ['sid'],
      answerType: TEXT,
    },
  ],
};

/**
 * Slack — a message into a channel.
 *
 * Verified against `chat.postMessage`: `POST https://slack.com/api/chat.postMessage`, the token in
 * an Authorization header, JSON accepted, `channel` required.
 */
export const SLACK_TOOL: ToolManifest = {
  id: 'slack',
  label: 'Slack',
  kind: 'tool',
  family: 'messaging',
  baseUrl: 'https://slack.com/api',
  credentials: [
    { name: 'SLACK_BOT_TOKEN', label: 'Bot token', hint: 'Starts with xoxb-.' },
  ],
  auth: { kind: 'bearer' },
  headers: { 'content-type': 'application/json; charset=utf-8' },
  encoding: 'json',
  timeoutMs: 30_000,
  operations: [
    {
      id: 'post',
      label: 'Post a message',
      method: 'POST',
      path: '/chat.postMessage',
      inputs: [
        { name: 'channel', type: TEXT, required: true, hint: 'A channel id or name' },
        { name: 'text', type: TEXT, required: true },
      ],
      body: { channel: '{{channel}}', text: '{{text}}' },
      // Slack answers 200 even when it refused; `ok` is the field that says which happened.
      answer: ['ok'],
      answerType: { kind: 'boolean' },
    },
  ],
};

/**
 * Home Assistant — the house.
 *
 * Verified against the Home Assistant REST API: a long-lived access token as
 * `Authorization: Bearer`, and `POST /api/services/<domain>/<service>` with the entity in the
 * body.
 *
 * Its address is a credential-shaped fact rather than a constant, because Home Assistant runs on
 * your own network. Two operations rather than a path a designer types: the domain and service
 * *are* the path, and a typo in one is a 404 with no explanation.
 */
export const HOME_ASSISTANT_TOOL: ToolManifest = {
  id: 'homeAssistant',
  label: 'Home Assistant',
  kind: 'tool',
  family: 'iot',
  baseUrl: '{{env:HOME_ASSISTANT_URL}}',
  credentials: [
    { name: 'HOME_ASSISTANT_URL', label: 'Address', hint: 'http://homeassistant.local:8123' },
    { name: 'HOME_ASSISTANT_TOKEN', label: 'Long-lived access token' },
  ],
  auth: { kind: 'bearer' },
  headers: { 'content-type': 'application/json' },
  encoding: 'json',
  timeoutMs: 15_000,
  operations: [
    {
      id: 'turnOn',
      label: 'Turn on',
      method: 'POST',
      path: '/api/services/homeassistant/turn_on',
      inputs: [{ name: 'entity_id', type: TEXT, required: true, hint: 'light.kitchen' }],
      body: { entity_id: '{{entity_id}}' },
      answerType: { kind: 'list', of: { kind: 'record' } },
      // Turning on something already on leaves it on: safe to repeat.
      idempotent: true,
    },
    {
      id: 'turnOff',
      label: 'Turn off',
      method: 'POST',
      path: '/api/services/homeassistant/turn_off',
      inputs: [{ name: 'entity_id', type: TEXT, required: true, hint: 'light.kitchen' }],
      body: { entity_id: '{{entity_id}}' },
      answerType: { kind: 'list', of: { kind: 'record' } },
      idempotent: true,
    },
  ],
};

export const TOOLS: readonly ToolManifest[] = [
  ANTHROPIC_TOOL,
  OPENAI_TOOL,
  RESEND_TOOL,
  STRIPE_TOOL,
  TWILIO_TOOL,
  SLACK_TOOL,
  HOME_ASSISTANT_TOOL,
  REQUEST_TOOL,
];

/** The tools of one kind, for a tab that groups them the way a person thinks about them. */
export const TOOL_FAMILIES: readonly { id: ToolFamily; label: string }[] = [
  { id: 'ai', label: 'Models' },
  { id: 'email', label: 'Email' },
  { id: 'payments', label: 'Payments' },
  { id: 'messaging', label: 'Messaging' },
  { id: 'iot', label: 'Devices' },
  { id: 'generic', label: 'Anything else' },
];


export function toolFor(id: string): ToolManifest | undefined {
  return TOOLS.find((tool) => tool.id === id);
}

export function operationFor(toolId: string, operationId: string): ToolOperation | undefined {
  return toolFor(toolId)?.operations.find((operation) => operation.id === operationId);
}

/** True when this tool is one whose request the designer writes themselves. */
export function isRequestTool(toolId: string): boolean {
  return toolId === REQUEST_TOOL.id;
}

/** Models worth offering per tool. A list, because a free-text model name is a 404 at run time. */
export const TOOL_MODELS: Readonly<Record<string, readonly string[]>> = {
  anthropic: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5'],
  openai: ['gpt-4o-mini', 'gpt-4o', 'o4-mini'],
};

/**
 * The holes in a body template, in the order they appear.
 *
 * `{{prompt}}` is filled from the input called `prompt`, and nothing else: a template naming
 * something the operation does not take is a template that would emit `undefined` into a request.
 */
export function holesIn(template: unknown): string[] {
  const found: string[] = [];

  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      const match = /^\{\{(\w+)\}\}$/.exec(value);
      if (match && !found.includes(match[1]!)) found.push(match[1]!);
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry);
      return;
    }
    if (value && typeof value === 'object') {
      for (const entry of Object.values(value)) walk(entry);
    }
  };

  walk(template);
  return found;
}

/** A URL the emitted app is allowed to call. */
export function checkRequestUrl(url: string): void {
  const value = url.trim();
  if (!value) throw new ConnectorError('A request needs an address.');

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ConnectorError(`"${url}" is not a web address.`);
  }
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
    // Plain HTTP carries the credential in the open. localhost is the exception a developer
    // actually needs, and it never leaves the machine.
    throw new ConnectorError('A request goes over https, or to localhost while you are building.');
  }
}

/**
 * A tool call's ports (T1).
 *
 * The operation's inputs, plus the answer. A request the designer writes themselves has no
 * declared inputs, so it takes one `input` of any shape — whatever is flowing through the route —
 * and answers with the response body.
 */
export function toolNodePorts(toolId: string, operationId: string): Port[] {
  const port = (id: string, name: string, direction: Port['direction'], type: TypeRef): Port => ({
    id,
    name,
    direction,
    portKind: 'data',
    type,
  });

  const operation = operationFor(toolId, operationId);
  if (!operation) {
    return [
      port('pt_input', 'input', 'in', { kind: 'any' }),
      port('pt_answer', 'answer', 'out', { kind: 'any' }),
    ];
  }

  return [
    ...operation.inputs.map((input) =>
      port(
        toolPortId(input.name),
        input.name,
        'in',
        input.required ? input.type : { kind: 'optional', of: input.type },
      ),
    ),
    port('pt_answer', 'answer', 'out', operation.answerType ?? { kind: 'any' }),
  ];
}

/** The port id one of an operation's inputs uses, kept stable so wires survive a re-pick. */
export const toolPortId = (name: string): string => `pt_arg_${name}`;

export interface ToolNodeConfig {
  /** Which connection — a tool the project has attached. */
  connectorId: string;
  toolId: string;
  operationId: string;
  /** For an AI tool: which model, and how long an answer may be. */
  model?: string;
  maxTokens?: number;
  /** For a request the designer writes: where it goes and how. */
  url?: string;
  method?: string;
}

export function createToolNode(
  id: string,
  position: { x: number; y: number },
  connectorId: string,
  toolId: string,
  operationId: string,
): Node {
  const tool = toolFor(toolId);
  const operation = operationFor(toolId, operationId);

  const config: ToolNodeConfig = {
    connectorId,
    toolId,
    operationId,
    ...(TOOL_MODELS[toolId] ? { model: TOOL_MODELS[toolId]![0], maxTokens: 1024 } : {}),
    ...(isRequestTool(toolId) ? { url: 'https://', method: 'POST' } : {}),
  };

  return {
    id,
    category: 'tool',
    kind: 'call',
    name: operation ? `${tool?.label ?? toolId}: ${operation.label}` : (tool?.label ?? toolId),
    ports: toolNodePorts(toolId, operationId),
    position,
    config: config as unknown as Record<string, unknown>,
  };
}
