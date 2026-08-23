import { afterEach, describe, expect, it, vi } from 'vitest';
import { __resetStore, addArtboard, addComponent, dispatch, getState } from '../src/state/store';
import {
  enableProvider,
  readAuthProviders,
  selfHostedAuth,
  setSelfHostedAuth,
} from '../src/state/connectors';

/**
 * Setting a sign-in provider up (A3, `docs/20-provider-setup.md`).
 *
 * The thing worth pinning is where the secrets go — which is nowhere loom keeps. These check that
 * the client id and secret leave for Supabase and are not written to the document, the env bucket
 * or local storage on the way.
 */

function connected(url = 'https://abc123.supabase.co'): void {
  __resetStore();
  addArtboard('Home');
  dispatch({
    type: 'addConnector',
    connector: {
      id: 'cn_supabase',
      moduleId: 'supabase',
      config: { url, schema: { tables: [] } },
      credentialRef: 'default',
    },
  });
}

function record(answer: (url: string) => unknown) {
  const calls: { url: string; body: string }[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: String(init?.body ?? '') });
    return new Response(JSON.stringify(answer(url)), { status: 200 });
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('what the project says about itself', () => {
  it('reads which providers are actually on', async () => {
    connected();
    record(() => ({ ok: true, settings: { external: { google: true, apple: false } } }));

    expect(await readAuthProviders()).toEqual({ google: true, apple: false });
  });

  it('says nothing rather than "all off" when the project cannot be reached', async () => {
    connected();
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    // A project that cannot be answered for is not a project with no providers.
    expect(await readAuthProviders()).toEqual({});
  });
});

describe('turning one on from here', () => {
  it('sends the fields the Management API accepts, for that project', async () => {
    connected();
    const calls = record(() => ({ ok: true }));

    const result = await enableProvider({
      provider: 'google',
      clientId: '8843.apps.googleusercontent.com',
      secret: 'super-secret-value',
    });
    expect(result.ok).toBe(true);

    const sent = JSON.parse(calls.find((call) => call.url.includes('auth-provider'))!.body);
    expect(sent.ref).toBe('abc123');
    expect(sent.fields).toEqual({
      external_google_enabled: true,
      external_google_client_id: '8843.apps.googleusercontent.com',
      external_google_secret: 'super-secret-value',
    });
  });

  it('keeps the secret nowhere: not the document, not the bucket, not this browser', async () => {
    connected();
    record(() => ({ ok: true }));
    await enableProvider({ provider: 'google', clientId: 'id', secret: 'super-secret-value' });

    expect(JSON.stringify(getState().snapshot)).not.toContain('super-secret-value');
    expect(JSON.stringify(localStorage)).not.toContain('super-secret-value');
  });

  it('refuses a project it cannot place, rather than posting into the dark', async () => {
    connected('http://localhost:9999');
    const calls = record(() => ({ ok: true }));

    const result = await enableProvider({ provider: 'google', clientId: 'id', secret: 'shh' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not a hosted Supabase project/);
    expect(calls).toEqual([]);
  });

  it('passes on what Supabase said when it refuses', async () => {
    connected();
    record(() => ({ ok: false, error: 'No SUPABASE_ACCESS_TOKEN on the dev server.' }));

    const result = await enableProvider({ provider: 'github', clientId: 'id', secret: 'shh' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/SUPABASE_ACCESS_TOKEN/);
  });
});

describe('a project that runs its own auth server', () => {
  it('remembers that choice, because it changes where the secrets belong', () => {
    connected();
    expect(selfHostedAuth(getState().snapshot)).toBe(false);

    setSelfHostedAuth(true);
    expect(selfHostedAuth(getState().snapshot)).toBe(true);
    // It is a fact about the project, not a secret: it belongs in the document.
    expect(JSON.stringify(getState().snapshot)).toContain('selfHostedAuth');
  });

  it('is remembered per project, not per browser', () => {
    connected();
    setSelfHostedAuth(true);
    addComponent('Button', { signInWith: 'google' });
    expect(selfHostedAuth(getState().snapshot)).toBe(true);
  });
});
