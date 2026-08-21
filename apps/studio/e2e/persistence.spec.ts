import { expect, test, type Page } from '@playwright/test';

/**
 * P0's gate: a reload stops losing the project. Everything here goes through the real editor and
 * the browser's own storage — nothing is stubbed, because the thing under test is whether work
 * survives the one event that used to destroy it.
 */

const field = (page: Page, label: string) =>
  page.locator('.field', { has: page.locator('.field__label', { hasText: label }) });

test.beforeEach(async ({ page }) => {
  // Clear once per test, not per navigation: an init script runs again on reload, and two of
  // these tests reload on purpose. sessionStorage survives the reload; the flag makes the clear
  // happen exactly once.
  await page.addInitScript(() => {
    if (!window.sessionStorage.getItem('loom.e2e.cleared')) {
      window.localStorage.clear();
      window.sessionStorage.setItem('loom.e2e.cleared', '1');
    }
  });
  await page.goto('/');
  await expect(page.locator('.artboard').first()).toBeVisible();
});

test('work survives a reload', async ({ page }) => {
  await page.locator('.layer', { hasText: 'Root' }).first().click();
  await page.getByRole('button', { name: '+ Text field' }).click();
  await field(page, 'Name').locator('input').fill('Survivor');
  await field(page, 'Placeholder').locator('input').fill('still here');

  // Styling and screen size are part of the document too, so they have to come back as well.
  await page.getByTestId('style-radius').selectOption('radius.pill');
  await page.locator('.layer--artboard').first().click();
  await page.getByTestId('screen-preset').selectOption('phone-sm');

  await expect(page.getByTestId('save-status')).toHaveText('saved');

  await page.reload();
  await expect(page.locator('.artboard').first()).toBeVisible();

  await expect(page.locator('.layer', { hasText: 'Survivor' })).toHaveCount(1);
  await expect(page.locator('.artboard__label .chip--mono').first()).toContainText('390 x 844');
  await expect(page.locator('.artboard input[readonly]').first()).toHaveCSS(
    'border-radius',
    '999px',
  );

  // And the restored document is what the Preview is running, not a fresh one.
  await expect(page.locator('.preview__state')).toHaveText('live');
  await expect(
    page.frameLocator('iframe.preview__frame').locator('input[placeholder="still here"]'),
  ).toBeVisible();
});

test('undo does not walk back into the previous session', async ({ page }) => {
  await page.locator('.layer', { hasText: 'Root' }).first().click();
  await page.getByRole('button', { name: '+ Button' }).click();
  await expect(page.getByTestId('save-status')).toHaveText('saved');

  await page.reload();
  await expect(page.locator('.artboard').first()).toBeVisible();

  // History starts empty on open: the button placed before the reload is not undoable now.
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
});

test('New starts over, and the reload agrees', async ({ page }) => {
  await page.locator('.layer', { hasText: 'Root' }).first().click();
  await page.getByRole('button', { name: '+ Button' }).click();
  await field(page, 'Name').locator('input').fill('Gone soon');
  await expect(page.getByTestId('save-status')).toHaveText('saved');

  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByTestId('reset-project').click();
  await expect(page.locator('.layer', { hasText: 'Gone soon' })).toHaveCount(0);

  await page.reload();
  await expect(page.locator('.artboard').first()).toBeVisible();
  await expect(page.locator('.layer', { hasText: 'Gone soon' })).toHaveCount(0);
});

test('a document this build cannot read is refused, not half-loaded', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'loom.project',
      JSON.stringify({ schemaVersion: 99, id: 'pj_x', name: 'From the future' }),
    );
  });
  await page.reload();

  await expect(page.getByTestId('save-status')).toHaveText('could not open saved project');
  // The editor still works, on a fresh project rather than a broken one.
  await expect(page.locator('.artboard').first()).toBeVisible();
});
