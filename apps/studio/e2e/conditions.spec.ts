import { expect, test, type Page } from '@playwright/test';
import { nameInput, pickColor } from './canvas';

/**
 * P1's gate: something on the screen appears, disappears and restyles because of state. The
 * condition is read from a real checkbox, and the proof is the running app — the canvas cannot
 * evaluate conditions and does not pretend to.
 */

const preview = (page: Page) => page.frameLocator('iframe.preview__frame');

const field = (page: Page, label: string) =>
  page.locator('.field', { has: page.locator('.field__label', { hasText: label }) });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!window.sessionStorage.getItem('loom.e2e.cleared')) {
      window.localStorage.clear();
      window.sessionStorage.setItem('loom.e2e.cleared', '1');
    }
  });
  await page.goto('/');
  await expect(page.locator('.artboard').first()).toBeVisible();
});

/** A checkbox and a Text. No wiring: a condition can read a checkbox the moment it is drawn. */
async function drawCheckboxAndText(page: Page): Promise<void> {
  await page.locator('.layer--artboard', { hasText: 'Home' }).first().click();
  await page.getByRole('button', { name: '+ Checkbox' }).click();
  await nameInput(page).fill('Agree');
  await field(page, 'Label').locator('input').fill('Agree');

  await page.locator('.layer--artboard', { hasText: 'Home' }).first().click();
  await page.getByRole('button', { name: '+ Text', exact: true }).click();
  await nameInput(page).fill('Secret');
  await field(page, 'Content').locator('input').fill('only when agreed');
}

test('a component can be shown only when a condition holds', async ({ page }) => {
  await drawCheckboxAndText(page);

  await page.locator('.layer', { hasText: 'Secret' }).first().click();
  await page.getByTestId('visible-when').selectOption({ label: 'Agree is checked' });

  await expect(page.locator('.preview__state')).toHaveText('live');
  const secret = preview(page).locator('span', { hasText: 'only when agreed' });

  // Not rendered at all — not hidden. The element is absent from the tree.
  await expect(secret).toHaveCount(0);

  await preview(page).locator('input[type="checkbox"]').check();
  await expect(secret).toHaveCount(1);

  await preview(page).locator('input[type="checkbox"]').uncheck();
  await expect(secret).toHaveCount(0);
});

test('the test can be inverted, for an empty state', async ({ page }) => {
  await drawCheckboxAndText(page);

  await page.locator('.layer', { hasText: 'Secret' }).first().click();
  await page.getByTestId('visible-when').selectOption({ label: 'Agree is checked' });
  await page.getByTestId('visible-when-test').selectOption('not');

  await expect(page.locator('.preview__state')).toHaveText('live');
  const secret = preview(page).locator('span', { hasText: 'only when agreed' });

  await expect(secret).toHaveCount(1);
  await preview(page).locator('input[type="checkbox"]').check();
  await expect(secret).toHaveCount(0);
});

test('a style override holds while its condition does', async ({ page }) => {
  await drawCheckboxAndText(page);

  await page.locator('.layer', { hasText: 'Secret' }).first().click();
  await pickColor(page, 'style-textColor', 'color.ink');
  await page.getByTestId('add-conditional-style').click();
  await page.getByTestId('conditional-when-0').selectOption({ label: 'Agree is checked' });
  await page.getByTestId('conditional-0-textColor').selectOption('color.brand');

  await expect(page.locator('.preview__state')).toHaveText('live');
  const secret = preview(page).locator('span', { hasText: 'only when agreed' });

  await expect(secret).toHaveCSS('color', 'rgb(27, 29, 33)');
  await preview(page).locator('input[type="checkbox"]').check();
  await expect(secret).toHaveCSS('color', 'rgb(236, 48, 19)');
});

test('the canvas marks a conditional component rather than hiding it', async ({ page }) => {
  await drawCheckboxAndText(page);

  await page.locator('.layer', { hasText: 'Secret' }).first().click();
  await page.getByTestId('visible-when').selectOption({ label: 'Agree is checked' });

  // A designer has to be able to select and edit something that is currently invisible.
  const marked = page.locator('.artboard [data-conditional="true"]');
  await expect(marked).toHaveCount(1);
  await expect(marked).toBeVisible();
});
