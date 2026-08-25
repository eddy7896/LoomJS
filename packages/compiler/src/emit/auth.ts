import { actionsOf, type Artboard, type PortRef, type Snapshot, type TypeRef } from '@loom/ir';
import { CompileError, type EmitContext } from '../types';
import { isCurrentOrg } from './tenancy';
import type { RouteMap } from './routes';

/**
 * App auth (`docs/specs/app-auth.md`), compiled.
 *
 * The app's users are not loom's users — two universes, one wall (guardrail 3). Everything here
 * belongs to the emitted repo and talks to the project's own Supabase.
 *
 * **The session lives in HttpOnly cookies the browser cannot read.** The tutorial answer is
 * supabase-js in the browser with tokens in `localStorage`, and it means any script that reaches
 * the page can take the token. In the one feature whose whole job is keeping one person's data
 * theirs, that is not a defensible default — so signing in is a request to the app's own server,
 * and the browser only ever learns *who* it is, never *how to prove it*.
 */

export const AUTH_MODULE_PATH = 'src/state/auth.tsx';
export const AUTH_SERVER_PATH = 'src/server/auth.ts';
const AUTH_VAR = 'auth';

/** The Current user node, in the one place that knows what it is. */
export const CURRENT_USER_KIND = 'currentUser';

export function isCurrentUser(node: { category: string; kind: string }): boolean {
  return node.category === 'state' && node.kind === CURRENT_USER_KIND;
}

/** Every action that needs the auth module. Their failure stops a sequence, like `trigger`. */
const AUTH_ACTIONS = new Set(['signIn', 'signUp', 'signOut', 'signInWith']);

/**
 * Does this project have users at all?
 *
 * Demand-driven like everything else: no auth action, no Current user, no guard — no auth module,
 * no `api/auth/*`, and the database keeps answering with the service-role key it always used.
 */
export function usesAuth(snapshot: Snapshot): boolean {
  for (const artboard of Object.values(snapshot.artboards)) {
    if (artboard.guard) return true;
  }
  for (const node of Object.values(snapshot.nodes)) {
    if (isCurrentUser(node)) return true;
    // Which organisation someone is in has no answer without a someone (O1).
    if (isCurrentOrg(node)) return true;
  }
  // Tenancy is resolved from the session, so a project organised by tenant has users by
  // definition. `validateTenancy` says so out loud when it does not.
  if (snapshot.tenancy) return true;
  for (const component of Object.values(snapshot.components)) {
    for (const value of Object.values(component.props)) {
      if (value.kind !== 'event') continue;
      if (actionsOf(value.handler).some((action) => AUTH_ACTIONS.has(action.kind))) return true;
    }
  }
  return false;
}

/**
 * What a bound property reads from the Current user, or undefined when the source is something
 * else entirely. These are plain reads off the context — no request, no state, no library.
 */
/**
 * Reading `Current org` (O1).
 *
 * The same shape as the current user's ports, and for the same reason: it is app state nobody
 * sets, answered by the server on the one session round trip.
 */
export function orgExpr(
  ctx: EmitContext,
  source: PortRef,
  componentId: string,
): string | undefined {
  const node = ctx.snapshot.nodes[source.nodeId];
  if (!node || !isCurrentOrg(node)) return undefined;

  const auth = ctx.requireAuth();
  switch (source.portId) {
    case 'pt_id':
      return `(${auth}.org?.id ?? "")`;
    case 'pt_name':
      return `(${auth}.org?.name ?? "")`;
    case 'pt_role':
      return `(${auth}.org?.role ?? "")`;
    // Signed in and in no organisation. Distinct from signed out, and worth showing rather than
    // rendering an empty screen that looks broken.
    case 'pt_none':
      return `(${auth}.user !== null && ${auth}.org === null)`;
    default:
      throw new CompileError(
        `Bound property reads port "${source.portId}", which the current org does not have.`,
        componentId,
      );
  }
}

export function sessionExpr(
  ctx: EmitContext,
  source: PortRef,
  componentId: string,
): string | undefined {
  const node = ctx.snapshot.nodes[source.nodeId];
  if (!node || !isCurrentUser(node)) return undefined;

  const auth = ctx.requireAuth();
  switch (source.portId) {
    case 'pt_signedIn':
      return `${auth}.user !== null`;
    case 'pt_email':
      return `(${auth}.user?.email ?? "")`;
    case 'pt_id':
      return `(${auth}.user?.id ?? "")`;
    case 'pt_error':
      return `(${auth}.error ?? "")`;
    default:
      throw new CompileError(
        `Bound property reads port "${source.portId}", which the current user does not have.`,
        componentId,
      );
  }
}

/** The type behind one of those ports, so a Text knows whether it has to coerce. */
export function sessionTypeOf(snapshot: Snapshot, source: PortRef): TypeRef | undefined {
  const node = snapshot.nodes[source.nodeId];
  if (!node || !isCurrentUser(node)) return undefined;
  return node.ports.find((port) => port.id === source.portId)?.type;
}

export const authVar = (): string => AUTH_VAR;

/**
 * Guards, checked before anything is emitted.
 *
 * A redirect to a screen that does not exist, or to one that is itself guarded, is a bounce with
 * no floor. Both are Build errors: discovering it by being thrown around the running app is the
 * worst possible way to find out.
 */
export function validateGuards(snapshot: Snapshot): void {
  for (const artboard of Object.values(snapshot.artboards)) {
    const guard = artboard.guard;
    if (!guard) continue;

    const destination = snapshot.artboards[guard.redirectTo];
    if (!destination) {
      throw new CompileError(
        `"${artboard.name}" sends signed-out visitors to a screen that no longer exists.`,
        artboard.id,
      );
    }
    if (destination.guard) {
      throw new CompileError(
        `"${artboard.name}" sends signed-out visitors to "${destination.name}", which is also ` +
          `only for signed-in people. They would bounce between the two forever.`,
        artboard.id,
      );
    }
  }
}

/** The connection auth runs against. Without one there is no server to sign in to. */
export function requireAuthConnector(snapshot: Snapshot): void {
  const supabase = Object.values(snapshot.connectors).find(
    (connector) => connector.moduleId === 'supabase',
  );
  if (!supabase) {
    throw new CompileError(
      'This app signs people in, which needs a Supabase connection. Connect one in Data.',
      snapshot.id,
    );
  }
}

/** `<RequireSignIn>` around a guarded screen's element, or the element exactly as it was. */
export function guardedElement(artboard: Artboard, element: string, routes: RouteMap): string {
  const guard = artboard.guard;
  if (!guard) return element;
  const destination = routes.get(guard.redirectTo);
  if (!destination) {
    throw new CompileError(`"${artboard.name}" guards to an unknown screen.`, artboard.id);
  }
  return `<RequireSignIn redirectTo="${destination.path}">${element}</RequireSignIn>`;
}

/**
 * The browser half: who is here, and the three things a person can do about it.
 *
 * It holds no token. `/api/auth/session` answers with a user or null, and every sign-in or
 * sign-out is a request whose whole effect is a cookie the browser cannot read.
 */
export function emitAuthModule(tenanted = false): string {
  return `// Generated by @loom/compiler. The app's own users — never the same people as the ones who
// build in loom. Managed region: edits here are overwritten.
//
// There is no access token in this file, and none anywhere in the browser: the session lives in
// HttpOnly cookies the server sets, so a script that reaches this page cannot take it.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';

export interface LoomUser {
  id: string;
  email: string;
}
${
  tenanted
    ? `
/** The organisation this person is in (O1). Decided by the server; the browser only reads it. */
export interface LoomOrg {
  id: string;
  name: string;
  role?: string;
}
`
    : ''
}
export interface Auth {
  user: LoomUser | null;${tenanted ? '\n  org: LoomOrg | null;' : ''}
  /** True until the first session answer arrives. Nothing should decide anything before then. */
  loading: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<boolean>;
  signUp: (email: string, password: string) => Promise<boolean>;
  signOut: () => Promise<boolean>;
}

const AuthContext = createContext<Auth | null>(null);

interface SessionBody {
  user?: LoomUser | null;${tenanted ? '\n  org?: LoomOrg | null;' : ''}
  error?: string;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<LoomUser | null>(null);${tenanted ? '\n  const [org, setOrg] = useState<LoomOrg | null>(null);' : ''}
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const response = await fetch('/api/auth/session');
        const body = (await response.json()) as SessionBody;
        if (live) setUser(body.user ?? null);${tenanted ? '\n        if (live) setOrg(body.org ?? null);' : ''}
      } catch {
        if (live) setUser(null);${tenanted ? '\n        if (live) setOrg(null);' : ''}
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const post = useCallback(async (route: string, payload: unknown): Promise<boolean> => {
    setError(null);
    try {
      const response = await fetch(route, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as SessionBody;
      if (!response.ok) {
        setError(body.error ?? 'That did not work.');
        return false;
      }
      // Signing up with email confirmation on succeeds without signing anyone in: Supabase
      // answers with a user and no session. Saying so honestly beats looking signed out for no
      // reason (docs/specs/app-auth.md).
      setUser(body.user ?? null);
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      return false;
    }
  }, []);

  const signIn = useCallback(
    (email: string, password: string) => post('/api/auth/signin', { email, password }),
    [post],
  );
  const signUp = useCallback(
    (email: string, password: string) => post('/api/auth/signup', { email, password }),
    [post],
  );
  const signOut = useCallback(() => post('/api/auth/signout', {}), [post]);

  return (
    <AuthContext.Provider value={{ user,${tenanted ? ' org,' : ''} loading, error, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): Auth {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth was called outside <AuthProvider>.');
  return auth;
}

/**
 * A screen only signed-in people may open. It renders nothing while the session is still being
 * fetched — a flash of a protected screen before the redirect is a leak, however brief.
 *
 * This is a convenience, not the security boundary. The boundary is the server, which answers
 * every request as whoever is asking.
 */
export function RequireSignIn({
  redirectTo,
  children,
}: {
  redirectTo: string;
  children: ReactNode;
}) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to={redirectTo} replace />;
  return <>{children}</>;
}
`;
}

/**
 * Every sign-in provider this project's buttons ask for (A2).
 *
 * Demand-driven, like auth itself: a project whose only sign-in is a password form emits no
 * redirect routes, and one that offers three providers names exactly those three in the route
 * that checks them.
 */
export function ssoProvidersUsed(snapshot: Snapshot): string[] {
  const providers = new Set<string>();

  for (const component of Object.values(snapshot.components)) {
    for (const value of Object.values(component.props)) {
      if (value.kind !== 'event') continue;
      for (const action of actionsOf(value.handler)) {
        if (action.kind === 'signInWith') providers.add(String(action.provider));
      }
    }
  }

  return [...providers].sort();
}
