import { describe, expect, it } from 'vitest';
import {
  callbackUrl,
  canManage,
  dashboardUrl,
  gotrueEnvNames,
  managementFields,
  parseAuthSettings,
  projectRef,
} from '../src/providerSetup';

/**
 * Setting a provider up (A3, `docs/20-provider-setup.md`).
 *
 * Every name here has to match something in someone else's system exactly, so these pin them
 * against what those systems say: GoTrue's own `example.env` for the environment variables, and
 * the Supabase Management API's OpenAPI document for the config fields.
 */

describe('the names a self-hosted auth server reads', () => {
  it('spells them the way GoTrue spells them', () => {
    expect(gotrueEnvNames('google')).toEqual({
      enabled: 'GOTRUE_EXTERNAL_GOOGLE_ENABLED',
      clientId: 'GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID',
      secret: 'GOTRUE_EXTERNAL_GOOGLE_SECRET',
      redirectUri: 'GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI',
    });
  });

  it('keeps the underscore in the OIDC ones, because the auth server does', () => {
    // A tidier name would simply not be read.
    expect(gotrueEnvNames('slack_oidc').clientId).toBe('GOTRUE_EXTERNAL_SLACK_OIDC_CLIENT_ID');
    expect(gotrueEnvNames('linkedin_oidc').secret).toBe('GOTRUE_EXTERNAL_LINKEDIN_OIDC_SECRET');
  });

  it('refuses a provider loom does not know', () => {
    expect(() => gotrueEnvNames('myspace')).toThrow(/not a provider/);
  });
});

describe('the fields the Management API accepts', () => {
  it('matches the OpenAPI document', () => {
    expect(managementFields('github')).toEqual({
      enabled: 'external_github_enabled',
      clientId: 'external_github_client_id',
      secret: 'external_github_secret',
    });
  });
});

describe('the URL people get wrong', () => {
  it('points at the auth server, not at the app', () => {
    // The provider redirects to the auth server, which then redirects to the app. This is the one
    // that goes into Google's console.
    expect(callbackUrl('https://abc123.supabase.co')).toBe(
      'https://abc123.supabase.co/auth/v1/callback',
    );
    expect(callbackUrl('https://abc123.supabase.co/')).toBe(
      'https://abc123.supabase.co/auth/v1/callback',
    );
  });

  it('says to connect first rather than making one up', () => {
    expect(() => callbackUrl('  ')).toThrow(/Connect a project first/);
  });
});

describe('placing the project', () => {
  it('finds the ref of a hosted project, and links to where this is turned on', () => {
    expect(projectRef('https://abc123.supabase.co')).toBe('abc123');
    expect(dashboardUrl('https://abc123.supabase.co')).toBe(
      'https://supabase.com/dashboard/project/abc123/auth/providers',
    );
    expect(canManage('https://abc123.supabase.co')).toBe(true);
  });

  it('offers none of that for an auth server someone runs themselves', () => {
    // No project ref, no management API — a form there would be a button that cannot work.
    expect(projectRef('http://localhost:9999')).toBeUndefined();
    expect(dashboardUrl('http://localhost:9999')).toBeUndefined();
    expect(canManage('http://localhost:9999')).toBe(false);
  });
});

describe('what the auth server says about itself', () => {
  it('reads which providers are actually on', () => {
    expect(
      parseAuthSettings({ external: { google: true, apple: false, email: true } }),
    ).toEqual({ google: true, apple: false, email: true });
  });

  it('treats anything that is not true as off, rather than guessing', () => {
    expect(parseAuthSettings({ external: { google: 'yes' } })).toEqual({ google: false });
    expect(parseAuthSettings({})).toEqual({});
    expect(parseAuthSettings(undefined)).toEqual({});
  });
});
