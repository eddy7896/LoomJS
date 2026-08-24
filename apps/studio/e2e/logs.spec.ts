import { expect, test } from '@playwright/test';
import { firstScreen, nameInput, openPreview } from './canvas';

/**
 * The Logs tab, against a real running app (`docs/23-logs.md`).
 *
 * The point of this tab is that the answer to "did my edit arrive" and "why is that route
 * failing" stops living in a terminal. Only a real preview can show that, so this drives one.
 */

test.beforeEach(async ({ page, request }) => {
  // The dev server's buffer belongs to the *process*, so it holds whatever the previous test did.
  // That is right for a designer with one server and wrong for a test, so each starts clean.
  await request.delete('/__loom/logs');
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto('/');
  await firstScreen(page);
});

test('the rail has a Logs section', async ({ page }) => {
  await page.getByTestId('rail-logs').click();
  await expect(page.getByTestId('logs-panel')).toBeVisible();
  await expect(page.getByTestId('logs-panel')).toContainText('Follow');
});

test('a compile shows up as a line', async ({ page }) => {
  // Something to compile.
  await page.getByRole('button', { name: '+ Text', exact: true }).click();
  await nameInput(page).fill('Hello');

  await page.getByTestId('rail-logs').click();
  await expect(page.getByTestId('logline-compile').first()).toContainText('Compiled');
});

test('a build that lands in the Preview says so', async ({ page }) => {
  await page.getByRole('button', { name: '+ Text', exact: true }).click();
  await nameInput(page).fill('Hello');
  await openPreview(page);

  await page.getByTestId('rail-logs').click();
  // The delivery, from the dev server, beside the compile from the browser.
  await expect(page.getByTestId('logline-build').first()).toContainText('Delivered');
});

/** A Link whose address has been emptied: the compiler refuses it by name. */
async function breakTheBuild(page: import('@playwright/test').Page): Promise<void> {
  await page.getByTestId('palette-Link').click();
  await nameInput(page).fill('Nowhere');
  // A new Link defaults to "https://", which compiles; emptying it is what makes it a Build error.
  await page
    .locator('.field', { has: page.locator('.field__label', { hasText: 'Address' }) })
    .locator('input')
    .fill('');
}

test('a compile that fails says why, and keeps the line', async ({ page }) => {
  await breakTheBuild(page);

  await page.getByTestId('rail-logs').click();
  const failure = page.getByTestId('logline-compile').filter({ hasText: 'nowhere to go' });
  await expect(failure.first()).toBeVisible();

  // Errors are counted in the header, so the tab says there is something to look at.
  await expect(page.getByTestId('logs-errors')).toHaveText('1');
});

test('only errors, when that is all you want to see', async ({ page }) => {
  await breakTheBuild(page);

  await page.getByTestId('rail-logs').click();
  await page.getByTestId('logs-level').selectOption('error');

  // Whatever else happened, nothing left on screen is an ordinary note.
  await expect(page.getByTestId('logline-build')).toHaveCount(0);
  await expect(page.getByTestId('logline-compile').first()).toContainText('nowhere to go');
});

test('clearing empties it', async ({ page }) => {
  await page.getByRole('button', { name: '+ Text', exact: true }).click();
  await nameInput(page).fill('Hello');

  await page.getByTestId('rail-logs').click();
  await expect(page.getByTestId('logline-compile').first()).toBeVisible();

  await page.getByTestId('logs-clear').click();
  // Cleared on both sides: the panel empties, and the dev server forgets too, so the next poll
  // does not bring it all back.
  await expect(page.getByTestId('logline-compile')).toHaveCount(0);
});

test("the running app's own console arrives", async ({ page }) => {
  await page.getByRole('button', { name: '+ Text', exact: true }).click();
  await nameInput(page).fill('Hello');
  await openPreview(page);

  await page.getByTestId('rail-logs').click();

  // The app runs in an iframe on another port, so nothing in the studio can read its console —
  // it forwards instead, and this is that seam working end to end.
  await expect(page.getByTestId('logline-app').first()).toBeVisible({ timeout: 30_000 });
});
