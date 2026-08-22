import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { drag, graphNode, handle } from './canvas';

/**
 * P5's done-when: the app signs someone up, signs them in, shows who they are, and bounces a
 * signed-out visitor off a protected screen (`docs/specs/app-auth.md`).
 *
 * The sign-in half runs in a **top-level page** on the Preview's own URL rather than in the
 * studio's iframe. That is an artefact of the harness, not of the design: the session lives in
 * `SameSite=Lax` cookies, which a browser deliberately withholds from a cross-site frame — the
 * same rule that makes those cookies the answer to CSRF. A deployed app is never in that frame.
 */

const STUB = 'http://localhost:5412';

const preview = (page: Page) => page.frameLocator('iframe.preview__frame');

const field = (page: Page, label: string) =>
  page.locator('.field', { has: page.locator('.field__label', { hasText: label }) });

test.beforeEach(async ({ page, request }) => {
  await request.get(`${STUB}/__reset`);
  await page.addInitScript(() => {
    if (!window.sessionStorage.getItem('loom.e2e.cleared')) {
      window.localStorage.clear();
      window.sessionStorage.setItem('loom.e2e.cleared', '1');
    }
  });
  await page.goto('/');
  await expect(page.locator('.artboard').first()).toBeVisible();
});

/** Signing in needs somewhere to sign in to, so every one of these starts connected. */
async function connect(page: Page): Promise<void> {
  await page.getByTestId('rail-data').click();
  await page.getByTestId('connect-supabase').click();
  await field(page, 'Project URL').locator('input').fill(STUB);
  await field(page, 'Anon key').locator('input').fill('stub-anon-key');
  await field(page, 'Service role key').locator('input').fill('stub-service-key');
  await page.getByRole('button', { name: 'Connect and read schema' }).click();
  await expect(page.locator('.table-row')).toContainText('notes');
  await page.getByTestId('rail-design').click();
}

/**
 * Work on a screen. Selecting the artboard makes it the active one, and a new component lands in
 * the active screen's root — which is what makes the rest of these steps unambiguous with more
 * than one screen in the project.
 */
async function screen(page: Page, name: string): Promise<void> {
  await page.locator('.layer--artboard', { hasText: name }).first().click();
}

async function place(page: Page, button: string, name: string, label?: string): Promise<void> {
  await page.getByRole('button', { name: button, exact: true }).click();
  await field(page, 'Name').locator('input').fill(name);
  if (label !== undefined) await field(page, 'Label').locator('input').fill(label);
}

/** Home, a Sign in screen with a real form, and a guard between them. */
async function buildApp(page: Page): Promise<void> {
  await connect(page);

  // Home shows who is here.
  await screen(page, 'Home');
  await place(page, '+ Text', 'Who');

  await page.getByRole('button', { name: '+ Screen' }).click();
  await page.locator('.layer--artboard', { hasText: 'Screen 2' }).first().click();
  await field(page, 'Name').locator('input').fill('Sign in');

  await screen(page, 'Sign in');
  await place(page, '+ Text field', 'Email');
  await place(page, '+ Text field', 'Password');
  await place(page, '+ Button', 'Create account', 'Create account');
  await page.getByTestId('add-action').selectOption('signUp');

  await place(page, '+ Button', 'Sign in', 'Sign in');
  // The two fields on this screen are the guess, because that is what a sign-in form is.
  await page.getByTestId('add-action').selectOption('signIn');
  await expect(page.getByTestId('action-0-email')).toHaveValue(/cp_/);
  await page.getByTestId('add-action').selectOption('navigate');

  // Who is here, wired to the Text on Home. The node canvas is per screen, so this happens with
  // Home active.
  await page.getByTestId('rail-design').click();
  await screen(page, 'Home');
  await page.getByTestId('rail-nodes').click();
  await page.getByRole('button', { name: '+ Current user', exact: true }).click();
  await drag(
    page,
    handle(graphNode(page, 'Current user'), 'pt_email'),
    handle(graphNode(page, 'Who'), 'pt_content'),
  );
  await page.getByTestId('rail-design').click();

  // And Home is only for people who have signed in.
  await page.getByTestId('rail-design').click();
  await screen(page, 'Home');
  await page.getByTestId('guard-mode').selectOption('signedIn');
  await page.getByTestId('guard-redirect').selectOption({ label: 'Sign in' });
}

/**
 * The app on its own origin, top-level.
 *
 * The Preview server may still be writing the app when the page opens, so this reloads until the
 * form is there rather than waiting a fixed amount and hoping — a blind wait is a test that fails
 * on a slow machine and passes on a fast one.
 */
async function openApp(page: Page, context: BrowserContext): Promise<Page> {
  const { url } = (await (await page.request.get('/__loom/preview')).json()) as { url: string };
  const app = await context.newPage();
  await app.goto(url);

  const form = app.getByRole('button', { name: 'Create account' });
  await expect(async () => {
    if (!(await form.isVisible())) await app.reload();
    await expect(form).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });

  return app;
}

test('a signed-out visitor never lands on a guarded screen', async ({ page }) => {
  await buildApp(page);

  await expect(page.locator('.preview__state')).toHaveText('live');
  // The Preview opens at "/" — which is Home, which nobody may open yet, so the sign-in form is
  // what shows. Nothing of the guarded screen renders on the way past.
  await expect(preview(page).getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expect(preview(page).locator('input')).toHaveCount(2);
});

test('signing up and in shows the person their own name', async ({ page, context }) => {
  await buildApp(page);
  await expect(page.locator('.preview__state')).toHaveText('live');

  // The Preview's own origin, top-level: see the note at the top of this file.
  const app = await openApp(page, context);
  await app.locator('input').first().fill('ada@example.com');
  await app.locator('input').nth(1).fill('correct horse');
  await app.getByRole('button', { name: 'Create account' }).click();

  // Signing up leaves them signed in here, because this project confirms nothing by email.
  await app.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(app.getByText('ada@example.com')).toBeVisible();
});

test('a wrong password says so, and goes nowhere', async ({ page, context }) => {
  await buildApp(page);
  await expect(page.locator('.preview__state')).toHaveText('live');

  const app = await openApp(page, context);
  await app.locator('input').first().fill('ada@example.com');
  await app.locator('input').nth(1).fill('wrong');
  await app.getByRole('button', { name: 'Sign in', exact: true }).click();

  // Still on the sign-in screen: a failed step stops the sequence, so the navigate never ran.
  await expect(app.getByRole('button', { name: 'Create account' })).toBeVisible();
});
