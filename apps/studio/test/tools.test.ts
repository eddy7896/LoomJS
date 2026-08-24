import { afterEach, describe, expect, it, vi } from 'vitest';
import { compile } from '@loom/compiler';
import { __resetStore, addArtboard, addComponent, getState, setProp } from '../src/state/store';
import { addGraphNode } from '../src/state/graph';
import {
  addToolStep,
  attachTool,
  attachedTools,
  detachTool,
  operationsOf,
  setToolConfig,
} from '../src/state/tools';

/**
 * Tools, in the studio (T1–T3, `docs/22-api-connectors.md`).
 *
 * The thing worth pinning is where the key goes, which is nowhere loom keeps: not the document,
 * not this browser. The rest is that a call is a step in a route, typed by the operation it names.
 */

const KEY = 'sk-ant-super-secret-value';

function record(): { url: string; body: string }[] {
  const calls: { url: string; body: string }[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo, init?: RequestInit) => {
    calls.push({ url: String(input), body: String(init?.body ?? '') });
    return new Response(JSON.stringify({ ok: true, names: [], values: {} }));
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('attaching a tool', () => {
  it('records which tool, and hands the key to the dev server', async () => {
    __resetStore();
    addArtboard('Home');
    const calls = record();

    expect((await attachTool('anthropic', KEY)).ok).toBe(true);

    const snapshot = getState().snapshot;
    expect(attachedTools(snapshot).map((entry) => entry.tool.id)).toEqual(['anthropic']);

    const sent = calls.find((call) => call.url === '/__loom/env')!;
    expect(JSON.parse(sent.body).env).toEqual({ ANTHROPIC_API_KEY: KEY });
  });

  it('keeps the key out of the document and out of this browser', async () => {
    __resetStore();
    addArtboard('Home');
    record();
    await attachTool('anthropic', KEY);

    expect(JSON.stringify(getState().snapshot)).not.toContain(KEY);
    expect(JSON.stringify(localStorage)).not.toContain(KEY);
  });

  it('attaches with nothing typed when the server already holds one', async () => {
    __resetStore();
    addArtboard('Home');
    const calls = record();

    expect((await attachTool('openai', '')).ok).toBe(true);
    // Nothing to send, so nothing is sent: the server uses what it has.
    expect(calls.filter((call) => call.url === '/__loom/env')).toEqual([]);
    expect(attachedTools(getState().snapshot)).toHaveLength(1);
  });

  it('attaches once, however many times it is asked', async () => {
    __resetStore();
    addArtboard('Home');
    record();
    await attachTool('anthropic', KEY);
    await attachTool('anthropic', KEY);

    expect(attachedTools(getState().snapshot)).toHaveLength(1);
  });

  it('removes it again', async () => {
    __resetStore();
    addArtboard('Home');
    record();
    await attachTool('anthropic', KEY);
    detachTool('anthropic');

    expect(attachedTools(getState().snapshot)).toEqual([]);
  });
});

describe('a call in a route', () => {
  async function withCall(toolId = 'anthropic', operationId = 'ask') {
    __resetStore();
    addArtboard('Home');
    record();
    await attachTool(toolId, KEY);
    const route = addGraphNode('api', 'route');
    return { route, call: addToolStep(route, toolId, operationId)! };
  }

  it('takes the operation parameters as its inputs', async () => {
    const { call } = await withCall();
    const ports = getState().snapshot.nodes[call]!.ports;

    expect(ports.filter((port) => port.direction === 'in').map((port) => port.name)).toEqual([
      'prompt',
      'system',
    ]);
    expect(ports.find((port) => port.direction === 'out')?.name).toBe('answer');
  });

  it('retypes the route, so its inputs are the call parameters', async () => {
    const { route } = await withCall();
    const ports = getState().snapshot.nodes[route]!.ports.map((port) => port.name);
    expect(ports).toContain('prompt');
  });

  it('compiles into a route that reads the key from the environment', async () => {
    const { route } = await withCall();

    // A route nothing reads is not emitted — demand-driven, like everything else — so the answer
    // is shown somewhere, which is what a designer would have done anyway.
    addComponent('Text');
    setProp(getState().selection!.id, 'content', {
      kind: 'bound',
      source: { nodeId: route, portId: 'pt_result' },
    });

    const files = compile(getState().snapshot).files;
    const api = files.find((file) => file.path.startsWith('api/'))!;

    expect(api.content).toContain('process.env["ANTHROPIC_API_KEY"]');
    expect(api.content).toContain('https://api.anthropic.com/v1/messages');
  });

  it('changing the model changes only what is on the node', async () => {
    const { call } = await withCall();
    setToolConfig(call, { model: 'claude-haiku-4-5' });

    const config = getState().snapshot.nodes[call]!.config as { model?: string };
    expect(config.model).toBe('claude-haiku-4-5');
    // The ports are the operation's, so they did not move.
    expect(getState().snapshot.nodes[call]!.ports.map((port) => port.name)).toContain('prompt');
  });
});

describe('what a tool offers', () => {
  it('lists the operations a preset knows', () => {
    expect(operationsOf('anthropic').map((operation) => operation.id)).toEqual(['ask']);
  });

  it('offers none for the request you write yourself, because that is the point of it', () => {
    expect(operationsOf('request')).toEqual([]);
  });
});
