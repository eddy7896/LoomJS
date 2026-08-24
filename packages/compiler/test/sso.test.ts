import { describe, expect, it } from 'vitest';
import { applyOps, type Snapshot } from '@loom/ir';
import { SSO_PROVIDERS } from '@loom/connectors';
import { compile } from '../src/index';
import { authSnapshot } from './fixtures';

/**
 * Signing in with a provider (A2, `docs/17-sso.md`).
 *
 * The flow is PKCE, run entirely on the server so the tokens land in the same HttpOnly cookies a
 * password sign-in uses. Every endpoint and parameter here was checked against the auth server's
 * own source rather than remembered, and these tests pin what the emitted app sends.
 */

/** The auth fixture, with a "Continue with GitHub" button on it. */
function withProvider(provider = 'github', extra: Record<string, unknown> = {}): Snapshot {
  const base = authSnapshot();
  const screen = Object.values(base.components).find((component) => component.type === 'Button');

  return applyOps(base, [
    {
      type: 'setProp',
      componentId: screen!.id,
      key: 'onClick',
      value: {
        kind: 'event',
        handler: { kind: 'actions', actions: [{ kind: 'signInWith', provider, ...extra }] },
      },
    },
  ]);
}

const fileAt = (snapshot: Snapshot, path: string): string | undefined =>
  compile(snapshot).files.find((entry) => entry.path === path)?.content;

describe('starting the flow', () => {
  const start = () => fileAt(withProvider(), 'api/auth/start.ts')!;

  it('sends the browser to the app, which sends it on to the provider', () => {
    const home = Object.values(compile(withProvider()).files).find((file) =>
      file.path.startsWith('src/artboards/'),
    )!;
    // A redirect, not a fetch: OAuth leaves the page.
    expect(home.content).toContain('window.location.assign("/api/auth/start?provider="');
  });

  it('asks for exactly the parameters the auth server reads', () => {
    // Verified against supabase/auth `internal/api/external.go`, which reads provider,
    // redirect_to, code_challenge and code_challenge_method off the query.
    expect(start()).toContain("authorize.searchParams.set('provider', provider)");
    expect(start()).toContain("authorize.searchParams.set('code_challenge_method', 's256')");
    expect(start()).toContain('/auth/v1/authorize');
  });

  it('keeps the verifier on the server, and sends only its hash', () => {
    expect(start()).toContain("createHash('sha256').update(verifier).digest('base64url')");
    expect(start()).toContain('pkceCookie(req, verifier)');
    // The secret half never appears in a URL.
    expect(start()).not.toContain("set('code_verifier'");
  });

  it('refuses a provider the app was not built with, in the route as well', () => {
    expect(start()).toContain('PROVIDERS.includes(provider)');
    const server = fileAt(withProvider(), 'src/server/auth.ts')!;
    expect(server).toContain('export const PROVIDERS: string[] = ["github"]');
  });

  it('works out where it is from the request, not from a setting', () => {
    // The same build runs on localhost, on a preview URL and in production; a redirect_to naming
    // the wrong one would send a browser to another deployment.
    expect(start()).toContain('appOrigin(req)');
  });
});

describe('finishing the flow', () => {
  const callback = () => fileAt(withProvider(), 'api/auth/callback.ts')!;

  it('exchanges the code the auth server sends back', () => {
    // `code` is what prepPKCERedirectURL sets; the exchange is grant_type=pkce with auth_code and
    // code_verifier, per internal/api/token.go.
    expect(callback()).toContain("url.searchParams.get('code')");
    expect(callback()).toContain("authFetch('/token?grant_type=pkce'");
    expect(callback()).toContain('auth_code: code, code_verifier: verifier');
  });

  it('puts the session where a password sign-in puts it', () => {
    expect(callback()).toContain('setSession(req, res, payload)');
  });

  it('spends the verifier even when the exchange fails', () => {
    expect(callback()).toContain('clearPkceCookie(req)');
  });

  it('says what went wrong instead of leaving a blank screen', () => {
    expect(callback()).toContain("url.searchParams.get('error_description')");
    expect(callback()).toContain("to.searchParams.set('auth_error', error)");
  });
});

describe('what is emitted at all', () => {
  it('emits no redirect routes for a project that has no provider button', () => {
    const paths = compile(authSnapshot()).files.map((file) => file.path);
    expect(paths).toContain('api/auth/signin.ts');
    expect(paths).not.toContain('api/auth/start.ts');
    expect(paths).not.toContain('api/auth/callback.ts');
  });

  it('names only the providers this project actually asks for', () => {
    const server = fileAt(withProvider('google'), 'src/server/auth.ts')!;
    expect(server).toContain('["google"]');
    expect(server).not.toContain('github');
  });
});

describe('what is refused', () => {
  it('refuses a provider the auth server does not implement', () => {
    expect(() => compile(withProvider('myspace'))).toThrow(/not a provider this app can sign in/);
  });

  it('refuses steps after it, because the page is gone by then', () => {
    const base = authSnapshot();
    const button = Object.values(base.components).find((component) => component.type === 'Button')!;
    const sequence = applyOps(base, [
      {
        type: 'setProp',
        componentId: button.id,
        key: 'onClick',
        value: {
          kind: 'event',
          handler: {
            kind: 'actions',
            actions: [
              { kind: 'signInWith', provider: 'github' },
              { kind: 'signOut' },
            ],
          },
        },
      },
    ]);
    expect(() => compile(sequence)).toThrow(/nothing can follow it/);
  });
});

describe('the provider list', () => {
  it('holds only ids the auth server implements', () => {
    // Checked against the provider directory in supabase/auth. A name it does not know fails at
    // the authorize call, which is a runtime failure on a button.
    const known = new Set([
      'apple', 'azure', 'bitbucket', 'discord', 'facebook', 'figma', 'github', 'gitlab',
      'google', 'kakao', 'keycloak', 'linkedin', 'linkedin_oidc', 'notion', 'slack',
      'slack_oidc', 'spotify', 'twitch', 'twitter', 'workos', 'zoom', 'fly', 'snapchat', 'x',
      'vercel_marketplace',
    ]);
    for (const provider of SSO_PROVIDERS) expect(known).toContain(provider.id);
  });

  it('says what a provider needs when it needs something unusual', () => {
    const apple = SSO_PROVIDERS.find((provider) => provider.id === 'apple');
    expect(apple?.note).toMatch(/Services ID/);
  });
});
