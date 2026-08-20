import { afterEach, describe, expect, it, vi } from 'vitest';
import { introspectFetch } from '../src/state/connectors';

/**
 * A hosted Supabase project serves its OpenAPI document only to the service role key, and that
 * key may never reach the browser. These cover the seam that keeps both true.
 */

const doc = JSON.stringify({ definitions: { notes: { properties: {} } } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reading a schema from the browser', () => {
  it('uses the direct call when the project accepts the key', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo) => {
      calls.push(String(input));
      return new Response(doc, { status: 200 });
    });

    const response = await introspectFetch('https://demo.supabase.co/rest/v1/');
    expect(await response.text()).toBe(doc);
    expect(calls).toEqual(['https://demo.supabase.co/rest/v1/']);
  });

  it('falls back to the dev server when the project refuses the key', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith('https://')) {
        return new Response('{"message":"Invalid API key"}', { status: 401 });
      }
      // The relay is asked for a project URL and is never handed the refused key.
      expect(JSON.parse(String(init?.body))).toEqual({ url: 'https://demo.supabase.co' });
      return new Response(JSON.stringify({ ok: true, status: 200, body: doc }), { status: 200 });
    });

    const response = await introspectFetch('https://demo.supabase.co/rest/v1/');
    expect(await response.text()).toBe(doc);
    expect(calls).toEqual(['https://demo.supabase.co/rest/v1/', '/__loom/introspect']);
  });

  it("keeps the project's own refusal when the dev server cannot help either", async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo) => {
      if (String(input).startsWith('https://')) {
        return new Response('{"message":"Invalid API key"}', { status: 401 });
      }
      return new Response(JSON.stringify({ ok: false, error: 'no key on the dev server' }), {
        status: 200,
      });
    });

    const response = await introspectFetch('https://demo.supabase.co/rest/v1/');
    expect(response.status).toBe(401);
  });

  it('still reaches the relay when the browser cannot reach the project at all', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo) => {
      if (String(input).startsWith('https://')) throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify({ ok: true, status: 200, body: doc }), { status: 200 });
    });

    expect(await (await introspectFetch('https://demo.supabase.co/rest/v1/')).text()).toBe(doc);
  });
});
