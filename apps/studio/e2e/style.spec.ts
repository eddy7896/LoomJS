import { expect, test, type Page } from '@playwright/test';

/**
 * The design-system loop: style a component from the token scale, watch it land in the running
 * app, then move the token itself and watch everything built on it follow.
 */

const preview = (page: Page) => page.frameLocator('iframe.preview__frame');

const field = (page: Page, label: string) =>
  page.locator('.field', { has: page.locator('.field__label', { hasText: label }) });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.artboard').first()).toBeVisible();
});

test('styling is picked from the system and reaches the running app', async ({ page }) => {
  await page.locator('.layer', { hasText: 'Heading' }).first().click();

  await page.getByTestId('style-textColor').selectOption('color.brand');
  await page.getByTestId('style-fontSize').selectOption('text.xl');

  // The canvas renders the same markup the compiler emits, so it shows the change immediately.
  const heading = page.locator('.artboard span', { hasText: 'Hello loomJS' }).first();
  await expect(heading).toHaveCSS('color', 'rgb(236, 48, 19)');

  await expect(page.locator('.preview__state')).toHaveText('live');
  const previewHeading = preview(page).locator('span', { hasText: 'Hello loomJS' }).first();
  await expect(previewHeading).toHaveCSS('color', 'rgb(236, 48, 19)');
  await expect(previewHeading).toHaveCSS('font-size', '28px');
});

test('moving a token moves everything built on it', async ({ page }) => {
  await page.locator('.layer', { hasText: 'Heading' }).first().click();
  await page.getByTestId('style-textColor').selectOption('color.brand');

  // The theme lives with the screen: it is a project-wide decision, not a component's.
  await page.locator('.layer--artboard').first().click();
  await page.getByTestId('theme-color.brand').fill('#0055ff');

  await expect(page.locator('.preview__state')).toHaveText('live');
  await expect(preview(page).locator('span', { hasText: 'Hello loomJS' }).first()).toHaveCSS(
    'color',
    'rgb(0, 85, 255)',
  );

  // Nothing else moved: an override is one decision, not a new palette.
  await expect(preview(page).locator('body')).toHaveCSS('color', 'rgb(27, 29, 33)');
});

test('a styled input still looks like the control it is', async ({ page }) => {
  await page.locator('.layer', { hasText: 'Root' }).first().click();
  await page.getByRole('button', { name: '+ Text field' }).click();
  await field(page, 'Placeholder').locator('input').fill('Your name');
  await page.getByTestId('style-radius').selectOption('radius.pill');

  // The canvas draws a real input, not a placeholder box: judging spacing needs the real thing.
  const input = page.locator('.artboard input[readonly]').first();
  await expect(input).toHaveAttribute('placeholder', 'Your name');
  await expect(input).toHaveCSS('border-radius', '999px');
});
