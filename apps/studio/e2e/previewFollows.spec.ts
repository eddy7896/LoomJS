import { test, expect, type Page } from '@playwright/test';
import { firstScreen, nameInput, openPreview } from './canvas';

/**
 * The Preview shows the screen being designed (`docs/12-canvas.md`).
 *
 * It used to load the app's root and stay there. The root is the *entry* artboard, so anyone
 * working on a second screen watched a preview of the first one: elements were added, compiled and
 * delivered, and nothing appeared — the page in the frame did not have them, and never would.
 *
 * These tests are about **which page the frame is on**, which is why each one puts different text
 * on each screen and checks the other one is not there. A test that only looked for the text it
 * added would pass on a frame showing both.
 */

const preview = (page: Page) => page.frameLocator('iframe.preview__frame');

async function addText(page: Page, name: string, content: string): Promise<void> {
  await page.getByRole('button', { name: '+ Text', exact: true }).click();
  await nameInput(page).fill(name);
  await page
    .locator('.field', { has: page.locator('.field__label', { hasText: 'Content' }) })
    .locator('input')
    .fill(content);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto('/');
});

test('an element added to a second screen reaches the running app', async ({ page }) => {
  await firstScreen(page);
  await addText(page, 'First', 'On screen one');

  await openPreview(page);
  await expect(page.locator('.preview__state')).toHaveText('live', { timeout: 30_000 });
  await expect(preview(page).getByText('On screen one')).toBeVisible({ timeout: 20_000 });

  // A second screen. Adding it makes it the active one, so the Preview should follow it there.
  await page.getByRole('button', { name: '+ Screen', exact: true }).click();
  await addText(page, 'Second', 'On screen two');

  await expect(preview(page).getByText('On screen two')).toBeVisible({ timeout: 20_000 });
  // The proof that the frame moved, rather than the app growing a second copy of everything.
  await expect(preview(page).getByText('On screen one')).toHaveCount(0);
});

test('selecting a screen sends the Preview back to it', async ({ page }) => {
  await firstScreen(page);
  await addText(page, 'First', 'On screen one');
  await page.getByRole('button', { name: '+ Screen', exact: true }).click();
  await addText(page, 'Second', 'On screen two');

  await openPreview(page);
  await expect(page.locator('.preview__state')).toHaveText('live', { timeout: 30_000 });
  await expect(preview(page).getByText('On screen two')).toBeVisible({ timeout: 20_000 });

  // Back to the first screen, from the tree — the way a designer moves between them.
  await page.locator('.layer--artboard').filter({ hasText: 'Home' }).first().click();
  await expect(preview(page).getByText('On screen one')).toBeVisible({ timeout: 20_000 });
  await expect(preview(page).getByText('On screen two')).toHaveCount(0);
});
