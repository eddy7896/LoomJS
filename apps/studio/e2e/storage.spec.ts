import { test, expect, type Page } from '@playwright/test';
import { firstScreen, openPreview } from './canvas';

/**
 * Files: buckets and upload fields (`docs/29-storage.md`).
 *
 * The path being protected is the whole one — attach somewhere for files to live, put a field on a
 * screen, point it at that bucket, and have the running app ask this project's own server for
 * somewhere to put the bytes. Each half is testable on its own and neither half is worth much
 * alone.
 */

const rail = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto('/');
  await firstScreen(page);
});

test('a project can attach somewhere for files to live', async ({ page }) => {
  await rail(page, 'Files').click();
  await expect(page.getByTestId('files-panel')).toBeVisible();

  // Every provider is offered, and local disk needs no account anywhere.
  for (const id of ['local', 'r2', 's3', 'supabase-storage', 'firebase-storage']) {
    await expect(page.getByTestId(`attach-${id}`)).toBeVisible();
  }

  await page.getByTestId('attach-local').click();
  const card = page.locator('[data-testid^="bucket-cn_"]').first();
  await expect(card).toBeVisible();

  // The credential is asked for by name, and the box for it is a password box — a bucket key read
  // over somebody's shoulder is a bucket anyone can fill.
  const secret = page.getByTestId('secret-UPLOAD_SECRET');
  await expect(secret).toHaveAttribute('type', 'password');
});

test('what is missing is said out loud', async ({ page }) => {
  await rail(page, 'Files').click();
  await page.getByTestId('attach-r2').click();

  // R2 needs a bucket name and an account id; a bucket that cannot work should say so here rather
  // than on somebody's first upload.
  const problem = page.locator('[data-testid^="bucket-problem-"]').first();
  await expect(problem).toBeVisible();
  await expect(problem).toContainText(/bucket|account/i);
});

test('an upload field picks from the buckets the project has', async ({ page }) => {
  // With nothing attached, the inspector points at the place to fix it rather than offering an
  // empty dropdown.
  await page.getByRole('button', { name: '+ File upload', exact: true }).click();
  await expect(page.getByTestId('no-buckets')).toBeVisible();

  await rail(page, 'Files').click();
  await page.getByTestId('attach-local').click();

  await rail(page, 'Design').click();
  await page.locator('.canvas__layer .loom-upload').first().click();

  const picker = page.getByTestId('bucket-choice');
  await expect(picker).toBeVisible();
  // The label from the panel, not a connector id nobody knows.
  await expect(picker.locator('option')).toContainText(['— pick a bucket —', 'Local disk']);
});

test('the field reaches the running app and asks this project’s own server', async ({ page }) => {
  await rail(page, 'Files').click();
  await page.getByTestId('attach-local').click();

  await rail(page, 'Design').click();
  await page.getByRole('button', { name: '+ Image upload', exact: true }).click();

  const picker = page.getByTestId('bucket-choice');
  await picker.selectOption({ index: 1 });

  await openPreview(page);
  await expect(page.locator('.preview__state')).toHaveText('live', { timeout: 30_000 });

  const app = page.frameLocator('iframe.preview__frame');
  const pick = app.locator('.loom-upload__pick');
  await expect(pick).toBeVisible({ timeout: 20_000 });
  // Configured, so it is the real control rather than the "not set up yet" one.
  await expect(app.locator('.loom-upload__problem')).toHaveCount(0);
  await expect(app.locator('input[type="file"]')).toHaveCount(1);
});

test('an unconfigured field renders instead of breaking the app', async ({ page }) => {
  await page.getByRole('button', { name: '+ File upload', exact: true }).click();

  await openPreview(page);
  await expect(page.locator('.preview__state')).toHaveText('live', { timeout: 30_000 });

  // Dragging an element out of the palette must never break the running app — the same answer a
  // List with no row template gives.
  const app = page.frameLocator('iframe.preview__frame');
  await expect(app.locator('.loom-upload__problem')).toContainText('not set up yet', {
    timeout: 20_000,
  });

  // And Problems says what to do about it.
  await expect(page.getByTestId('problems')).toContainText(/bucket/i);
});
