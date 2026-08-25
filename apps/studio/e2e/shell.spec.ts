import { expect, test } from '@playwright/test';
import { firstScreen } from './canvas';

/**
 * App shells, through the editor (R2, `docs/V1-COMPLETION.md`).
 *
 * The compiler tests prove the nesting is emitted. They cannot prove a designer can make a shell
 * and put a screen in it, which is a different claim — and the last time R1 shipped, that half was
 * broken while every unit test stayed green.
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!window.sessionStorage.getItem('loom.e2e.cleared')) {
      window.localStorage.clear();
      window.sessionStorage.setItem('loom.e2e.cleared', '1');
    }
  });
  await page.goto('/');
  await firstScreen(page);
});

test('a shell can be made, drawn into, and given a screen', async ({ page }) => {
  // It is offered beside "+ Screen", because it is the same kind of act.
  const add = page.getByTestId('add-shell');
  await expect(add).toBeVisible();
  await add.click();

  /**
   * A shell is a board on the canvas — a frame you draw a sidebar into — so it appears with its
   * own label rather than living in a dialog somewhere.
   */
  const label = page.locator('.artboard__label', { hasText: 'App shell' });
  await expect(label).toBeVisible();
  await expect(label.locator('.chip', { hasText: 'shell' })).toBeVisible();

  // The screen can now be put inside it, and the control is on the screen — where the question is.
  await page
    .getByTestId(/^screen-ab_/)
    .first()
    .click();
  await page.locator('.artboard__label').first().click();

  const shellPicker = page.getByTestId('artboard-shell');
  await expect(shellPicker).toBeVisible();
  await shellPicker.selectOption({ label: 'App shell' });

  await expect(shellPicker).not.toHaveValue('');
});

test('a project with no shells says so rather than showing an empty picker', async ({ page }) => {
  await page.locator('.artboard__label').first().click();

  const section = page.getByTestId('shell-section');
  await expect(section).toBeVisible();
  // A dropdown with nothing in it is a control that looks broken.
  await expect(page.getByTestId('artboard-shell')).toHaveCount(0);
  await expect(section).toContainText('No shells yet');
});
