import { expect, test, type Page } from '@playwright/test';
import { firstScreen } from './canvas';

/**
 * Setting a sign-in provider up (A3, `docs/20-provider-setup.md`).
 *
 * A button that signs in with Google is half of signing in. These check the other half is asked
 * for honestly: what state the provider is actually in, the callback URL nobody should transcribe
 * by hand, and where the secret is allowed to live.
 */

const STUB = 'http://localhost:5412';

async function stubAuth(page: Page, external: Record<string, boolean>): Promise<string[]> {
  const sent: string[] = [];

  await page.route('**/__loom/auth-settings', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, settings: { external } }),
    });
  });
  await page.route('**/__loom/auth-provider', async (route) => {
    sent.push(route.request().postData() ?? '');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });

  return sent;
}

/** A connected project with one sign-in button on the screen. */
async function withProvider(page: Page, provider = 'google'): Promise<void> {
  await page.getByTestId('rail-data').click();
  await page.getByTestId('connect-supabase').click();
  await page.locator('.connect-form input').first().fill(STUB);
  await page.locator('.connect-form input[type="password"]').first().fill('stub-anon-key');
  await page.locator('.connect-form input[type="password"]').last().fill('stub-service-key');
  await page.getByRole('button', { name: 'Connect and read schema' }).click();
  await expect(page.locator('.table-row')).toContainText('notes');

  await page.getByTestId('rail-design').click();
  await page.getByTestId(`palette-signin-${provider}`).click();
  await page.getByTestId('rail-data').click();
}

test.beforeEach(async ({ page, request }) => {
  await request.get(`${STUB}/__reset`);
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto('/');
  await firstScreen(page);
});

test('a provider that is not turned on says so', async ({ page }) => {
  await stubAuth(page, { google: false });
  await withProvider(page);

  await expect(page.getByTestId('provider-google')).toContainText('not turned on');
});

test('one that is turned on says that instead', async ({ page }) => {
  await stubAuth(page, { google: true });
  await withProvider(page);

  await expect(page.getByTestId('provider-google')).toContainText('on');
});

test('it hands over the callback URL, which points at the auth server', async ({ page }) => {
  await stubAuth(page, { google: false });
  await withProvider(page);
  await page.getByTestId('provider-google-toggle').click();

  // Not the app's URL: the provider redirects to the auth server, which redirects to the app.
  await expect(page.getByTestId('provider-google-callback')).toHaveText(
    `${STUB}/auth/v1/callback`,
  );
});

test('a project that runs its own auth server is given the variable names instead', async ({
  page,
}) => {
  await stubAuth(page, { github: false });
  await withProvider(page, 'github');

  await page.getByTestId('self-hosted-auth').check();
  await page.getByTestId('provider-github-toggle').click();

  const env = page.getByTestId('provider-github-env');
  await expect(env).toContainText('GOTRUE_EXTERNAL_GITHUB_CLIENT_ID=');
  await expect(env).toContainText('GOTRUE_EXTERNAL_GITHUB_SECRET=');
  // Named, never filled in: loom does not hold them.
  await expect(env).not.toContainText('SECRET=s');
});
