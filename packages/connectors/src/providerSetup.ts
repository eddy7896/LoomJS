import { ConnectorError } from './module';
import { ssoProvider } from './sso';

/**
 * Setting a provider up (A3, `docs/20-provider-setup.md`).
 *
 * A sign-in button is one half. The other half is a client id and a secret that only mean anything
 * to the provider and the auth server — and loom's answer to *where those live* has to be honest
 * about three different situations, because they really are different:
 *
 * 1. **Hosted Supabase.** The secret belongs in the Supabase project. loom shows what is needed,
 *    reads back whether the provider is actually on, and hands over the exact callback URL. It
 *    holds nothing.
 * 2. **Hosted Supabase, with a management token.** The designer types the id and secret into loom
 *    and loom writes them to the project. They travel through the dev server once and are kept
 *    nowhere.
 * 3. **Its own auth server**, in the container path. The values are environment variables of that
 *    server, so loom names them and the deployment supplies them.
 *
 * The names below are not remembered: the GoTrue variables come from that project's own
 * `example.env`, and the management fields from the Supabase Management API's OpenAPI document.
 */

/** GoTrue reads `GOTRUE_EXTERNAL_<PROVIDER>_…` for each provider it supports. */
export interface GotrueEnvNames {
  enabled: string;
  clientId: string;
  secret: string;
  redirectUri: string;
}

export function gotrueEnvNames(providerId: string): GotrueEnvNames {
  if (!ssoProvider(providerId)) {
    throw new ConnectorError(`"${providerId}" is not a provider loom knows.`);
  }
  // `slack_oidc` and `linkedin_oidc` keep the underscore: the auth server spells them that way in
  // its own configuration, and a "tidier" name would simply not be read.
  const upper = providerId.toUpperCase();
  return {
    enabled: `GOTRUE_EXTERNAL_${upper}_ENABLED`,
    clientId: `GOTRUE_EXTERNAL_${upper}_CLIENT_ID`,
    secret: `GOTRUE_EXTERNAL_${upper}_SECRET`,
    redirectUri: `GOTRUE_EXTERNAL_${upper}_REDIRECT_URI`,
  };
}

/** The fields `PATCH /v1/projects/{ref}/config/auth` accepts for one provider. */
export interface ManagementFields {
  enabled: string;
  clientId: string;
  secret: string;
}

export function managementFields(providerId: string): ManagementFields {
  if (!ssoProvider(providerId)) {
    throw new ConnectorError(`"${providerId}" is not a provider loom knows.`);
  }
  return {
    enabled: `external_${providerId}_enabled`,
    clientId: `external_${providerId}_client_id`,
    secret: `external_${providerId}_secret`,
  };
}

/**
 * The URL to paste into the provider's own console.
 *
 * This is the one people get wrong, because it is not the app's URL: the provider redirects to the
 * **auth server**, which then redirects to the app. Showing it beside the button is the difference
 * between a five-minute setup and an afternoon.
 */
export function callbackUrl(supabaseUrl: string): string {
  const base = supabaseUrl.trim().replace(/\/+$/, '');
  if (!base) throw new ConnectorError('Connect a project first, so loom knows the callback URL.');
  return `${base}/auth/v1/callback`;
}

/** `https://abc123.supabase.co` → `abc123`, or nothing when this is not a hosted project. */
export function projectRef(supabaseUrl: string): string | undefined {
  const match = /^https?:\/\/([a-z0-9]+)\.supabase\.(co|in|red)/i.exec(supabaseUrl.trim());
  return match?.[1];
}

/** Where in the Supabase dashboard this is turned on. Absent for a project loom cannot place. */
export function dashboardUrl(supabaseUrl: string): string | undefined {
  const ref = projectRef(supabaseUrl);
  return ref ? `https://supabase.com/dashboard/project/${ref}/auth/providers` : undefined;
}

/**
 * Whether this project is one loom can configure through the Management API.
 *
 * A self-hosted auth server has no project ref and no management API, so offering the form there
 * would be offering a button that cannot work.
 */
export function canManage(supabaseUrl: string): boolean {
  return Boolean(projectRef(supabaseUrl));
}

/** The `.env` lines for someone running their own auth server, ready to paste. */
export function gotrueEnvExample(providerId: string, redirectUri: string): string {
  const names = gotrueEnvNames(providerId);
  const newline = String.fromCharCode(10);
  return [
    `${names.enabled}=true`,
    `${names.clientId}=`,
    `${names.secret}=`,
    `${names.redirectUri}=${redirectUri}`,
  ].join(newline);
}

/** What a designer has to have in hand before any of this works. */
export interface ProviderStatus {
  id: string;
  label: string;
  /** What the auth server says: whether this provider is actually turned on right now. */
  enabled?: boolean;
  /** Anything unusual about this one — Apple's signed secret, for instance. */
  note?: string;
}

/**
 * Read `GET /auth/v1/settings`, which answers with which providers are on.
 *
 * It takes the anon key, which is client-scoped and already in the studio's hands, so this is a
 * question loom can ask honestly rather than a claim it has to make.
 */
export function parseAuthSettings(body: unknown): Record<string, boolean> {
  const settings = (body ?? {}) as { external?: Record<string, unknown> };
  const external = settings.external ?? {};
  const out: Record<string, boolean> = {};
  for (const [name, value] of Object.entries(external)) out[name] = value === true;
  return out;
}
