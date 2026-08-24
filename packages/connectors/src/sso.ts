/**
 * Sign-in providers (A2, `docs/17-sso.md`).
 *
 * These are **not connectors** in loom's sense: nothing here is a data source, and none of them
 * puts a credential in loom's hands. A provider's client id and secret are configured in the
 * Supabase project, by the person who owns it, and this side only ever says *which* provider a
 * button asks for. That is the whole security story, and it is the reason this file holds names
 * rather than settings.
 *
 * Every id here is one the auth server actually implements — checked against the provider
 * directory in `supabase/auth`, not remembered. An id it does not know is refused at the
 * `/authorize` call with "Unsupported provider", which is a runtime failure on a button, so the
 * list stays closed and the compiler checks against it.
 */

export interface SsoProvider {
  /** Exactly what GoTrue calls it. */
  id: string;
  label: string;
  /**
   * Scopes to ask for beyond the provider's default, space separated.
   *
   * Empty for almost everything: asking for more than sign-in needs is how a consent screen turns
   * into a reason not to sign in.
   */
  scopes?: string;
  /** What has to be true in the Supabase project before the button works. */
  note?: string;
}

export const SSO_PROVIDERS: readonly SsoProvider[] = [
  { id: 'google', label: 'Google' },
  { id: 'apple', label: 'Apple', note: 'Apple requires a Services ID and a signed client secret.' },
  { id: 'github', label: 'GitHub' },
  { id: 'gitlab', label: 'GitLab' },
  { id: 'bitbucket', label: 'Bitbucket' },
  { id: 'azure', label: 'Microsoft' },
  { id: 'discord', label: 'Discord' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'twitch', label: 'Twitch' },
  { id: 'slack_oidc', label: 'Slack' },
  { id: 'linkedin_oidc', label: 'LinkedIn' },
  { id: 'notion', label: 'Notion' },
  { id: 'spotify', label: 'Spotify' },
  { id: 'figma', label: 'Figma' },
  { id: 'zoom', label: 'Zoom' },
  { id: 'kakao', label: 'Kakao' },
];

export function ssoProvider(id: string): SsoProvider | undefined {
  return SSO_PROVIDERS.find((provider) => provider.id === id);
}

/** The label to put on a button that has not been given one. */
export function ssoLabel(id: string): string {
  return `Continue with ${ssoProvider(id)?.label ?? id}`;
}
