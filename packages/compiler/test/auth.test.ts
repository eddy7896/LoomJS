import { describe, expect, it } from 'vitest';
import { applyOps, type Snapshot } from '@loom/ir';
import { compile } from '../src/index';
import { diagnose } from '../src/diagnostics';
import { authSnapshot, crudSnapshot } from './fixtures';

/**
 * App auth (P5, `docs/specs/app-auth.md`).
 *
 * Three claims are load-bearing and everything else follows from them: the browser never holds a
 * token; a project with users answers its own database as the person asking; and the app's users
 * are not loom's users.
 */

const fileAt = (snapshot: Snapshot, path: string): string => {
  const file = compile(snapshot).files.find((candidate) => candidate.path === path);
  if (!file) throw new Error(`no ${path} emitted`);
  return file.content;
};

const paths = (snapshot: Snapshot): string[] => compile(snapshot).files.map((file) => file.path);

describe('the session never reaches the browser', () => {
  const project = authSnapshot();

  it('sets the tokens as HttpOnly cookies, from the server', () => {
    const server = fileAt(project, 'src/server/auth.ts');
    expect(server).toContain("'HttpOnly'");
    expect(server).toContain("'SameSite=Lax'");
    // Secure on HTTPS only: on http://localhost the browser would drop the cookie entirely.
    expect(server).toContain("req.headers['x-forwarded-proto'] === 'https'");
  });

  it('keeps every token out of the browser module', () => {
    const client = fileAt(project, 'src/state/auth.tsx');
    expect(client).not.toContain('access_token');
    expect(client).not.toContain('localStorage');
    // All it learns is who is here.
    expect(client).toContain("fetch('/api/auth/session')");
  });

  it('says the same sentence for an unknown address and a wrong password', () => {
    // Telling them apart tells a stranger which addresses have accounts.
    const signin = fileAt(project, 'api/auth/signin.ts');
    expect(signin).toContain('That email and password did not match.');
    expect(signin.match(/statusCode = 401/g)).toHaveLength(1);
  });

  it('refreshes an expired token on the server, and gives up cleanly when it cannot', () => {
    const server = fileAt(project, 'src/server/auth.ts');
    expect(server).toContain("authFetch('/token?grant_type=refresh_token'");
    expect(server).toContain('clearSession(req, res);');
  });

  it('signs out even when Supabase does not answer', () => {
    // Their session is ending here either way; a failed logout call must not keep them signed in.
    const signout = fileAt(project, 'api/auth/signout.ts');
    const cleared = signout.indexOf('clearSession(req, res);');
    expect(cleared).toBeGreaterThan(signout.indexOf('} catch {'));
  });
});

describe('the database answers as the person asking', () => {
  it('sends the caller token and never the service-role key', () => {
    const api = fileAt(authSnapshot(), 'api/notes.ts');
    expect(api).toContain('const token = await accessTokenFor(req, res);');
    expect(api).toContain('Authorization: `Bearer ${token ?? anonKey}`');
    // The key that bypasses row-level security has no business in a route that serves people.
    expect(api).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('asks the deployment for the publishable key, not the secret one', () => {
    expect(fileAt(authSnapshot(), '.env.example')).toBe('SUPABASE_URL=\nSUPABASE_ANON_KEY=\n');
  });

  it('leaves a project without users exactly as it was', () => {
    const api = fileAt(crudSnapshot(), 'api/notes.ts');
    expect(api).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(api).not.toContain('accessTokenFor');
  });
});

describe('what a designer wired', () => {
  const project = authSnapshot();

  it('signs in with what was typed, and stops there when it fails', () => {
    const screen = fileAt(project, 'src/artboards/SignIn.tsx');
    expect(screen).toContain(
      'if (!(await auth.signIn(String(field_cp_email), String(field_cp_password)))) return;',
    );
    // The navigation is the step after, so it only happens on a real sign-in.
    expect(screen).toMatch(/signIn[\s\S]*navigate\("\/"\)/);
  });

  it('reads the current user as a plain value, with no request of its own', () => {
    const screen = fileAt(project, 'src/artboards/Home.tsx');
    expect(screen).toContain('const auth = useAuth();');
    expect(screen).toContain('auth.user?.email ?? ""');
  });

  it('shows why a sign-in failed', () => {
    expect(fileAt(project, 'src/artboards/SignIn.tsx')).toContain('auth.error ?? ""');
  });

  it('emits nothing at all for a project with no users', () => {
    expect(paths(crudSnapshot())).not.toContain('src/state/auth.tsx');
    expect(paths(crudSnapshot()).some((path) => path.startsWith('api/auth/'))).toBe(false);
  });
});

describe('a guarded screen', () => {
  it('is wrapped where the router mounts it', () => {
    const app = fileAt(authSnapshot(), 'src/App.tsx');
    expect(app).toContain('<RequireSignIn redirectTo="/sign-in"><Home /></RequireSignIn>');
    // The provider is above the router, because the guard reads it while deciding to mount.
    expect(app.indexOf('<AuthProvider>')).toBeLessThan(app.indexOf('<BrowserRouter>'));
  });

  it('renders nothing while the session is still unknown', () => {
    // A flash of a protected screen before the redirect is a leak, however brief.
    // Nothing decides anything before the first session answer arrives. Asserted as the
    // behaviour rather than the exact destructuring, which roles changed (O2).
    expect(fileAt(authSnapshot(), 'src/state/auth.tsx')).toContain('loading) return null;');
  });

  it('refuses a redirect to a screen that is itself signed-in-only', () => {
    const loop = applyOps(authSnapshot(), [
      {
        type: 'setArtboardGuard',
        artboardId: 'ab_signin00001',
        guard: { redirectTo: 'ab_home000001' },
      },
    ]);
    expect(() => compile(loop)).toThrow(/bounce between the two forever/);
  });

  it('refuses a redirect to a screen that is gone', () => {
    const dangling = applyOps(authSnapshot({ guard: false }), [
      { type: 'setArtboardGuard', artboardId: 'ab_home000001', guard: { redirectTo: 'ab_nope' } },
    ]);
    expect(() => compile(dangling)).toThrow(/no longer exists/);
  });

  it('drops a guard when the screen it points at is deleted', () => {
    // A guard sending people nowhere would bounce them into a blank router.
    const removed = applyOps(authSnapshot(), [
      { type: 'removeArtboard', artboardId: 'ab_signin00001' },
    ]);
    expect(removed.artboards.ab_home000001!.guard).toBeUndefined();
  });
});

describe('signing in needs somewhere to sign in to', () => {
  it('refuses to compile without a connection', () => {
    const unconnected = applyOps(authSnapshot(), [
      { type: 'removeConnector', connectorId: 'cn_supabase' },
    ]);
    expect(() => compile(unconnected)).toThrow(/needs a Supabase connection/);
  });

  it('says so in the Problems panel too, in the same words', () => {
    const unconnected = applyOps(authSnapshot(), [
      { type: 'removeConnector', connectorId: 'cn_supabase' },
    ]);
    const problem = diagnose(unconnected).find((row) => row.code === 'auth-without-connection');
    expect(problem?.message).toContain('needs a Supabase connection');
  });

  it('warns about a sign-in step with nothing to sign in with', () => {
    const blank = applyOps(authSnapshot(), [
      {
        type: 'setProp',
        componentId: 'cp_signin',
        key: 'onClick',
        value: {
          kind: 'event',
          handler: {
            kind: 'actions',
            actions: [
              {
                kind: 'signIn',
                email: { kind: 'static', value: '' },
                password: { kind: 'static', value: '' },
              },
            ],
          },
        },
      },
    ]);
    const problem = diagnose(blank).find((row) => row.code === 'auth-without-details');
    expect(problem?.severity).toBe('warning');
  });
});

describe('the two universes stay apart', () => {
  it('emits no credential value anywhere, as always', () => {
    for (const file of compile(authSnapshot()).files) {
      expect(file.content).not.toMatch(/eyJhbGciOi/);
    }
  });

  it('reads both keys by name from the environment', () => {
    const server = fileAt(authSnapshot(), 'src/server/auth.ts');
    expect(server).toContain("process.env.SUPABASE_URL ?? ''");
    expect(server).toContain("process.env.SUPABASE_ANON_KEY ?? ''");
  });
});
