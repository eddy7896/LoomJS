import { expect, test, type Page } from '@playwright/test';
import { firstScreen, nameInput, pickColor } from './canvas';

/**
 * The design-system loop: style a component from the token scale, watch it land in the running
 * app, then move the token itself and watch everything built on it follow.
 */

const preview = (page: Page) => page.frameLocator('iframe.preview__frame');

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
  await firstScreen(page);
});

/** The canvas starts blank, so these place the heading they are about to style. */
async function placeHeading(page: Page): Promise<void> {
  await page.getByRole('button', { name: '+ Text', exact: true }).click();
  await nameInput(page).fill('Heading');
  await field(page, 'Content').locator('input').fill('Hello loomJS');
}

test('styling is picked from the system and reaches the running app', async ({ page }) => {
  await placeHeading(page);
  await page.locator('.layer', { hasText: 'Heading' }).first().click();

  await pickColor(page, 'style-textColor', 'color.brand');
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
  await placeHeading(page);
  await page.locator('.layer', { hasText: 'Heading' }).first().click();
  await pickColor(page, 'style-textColor', 'color.brand');

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
  await page.locator('.layer--artboard', { hasText: 'Home' }).first().click();
  await page.getByRole('button', { name: '+ Text field' }).click();
  await field(page, 'Placeholder').locator('input').fill('Your name');
  await page.getByTestId('style-radius').selectOption('radius.pill');

  // The canvas draws a real input, not a placeholder box: judging spacing needs the real thing.
  const input = page.locator('.artboard input[readonly]').first();
  await expect(input).toHaveAttribute('placeholder', 'Your name');
  await expect(input).toHaveCSS('border-radius', '999px');
});

test('a screen can be set to a device size, or dragged to any size', async ({ page }) => {
  await page.locator('.layer--artboard').first().click();

  // The default frame is tablet, per the V1 target.
  const label = page.locator('.artboard__label .chip--mono').first();
  await expect(label).toContainText('834 x 1112');

  await page.getByTestId('screen-preset').selectOption('phone-sm');
  await expect(label).toContainText('390 x 844 Phone');

  // The canvas frame follows...
  const artboard = page.locator('.artboard').first();
  await expect(artboard).toHaveCSS('min-height', '844px');

  // ...and so does the width the Preview runs at, which is the point of choosing a device.
  await expect(page.getByTestId('preview-size')).toHaveText('390');
  await expect(page.locator('iframe.preview__frame')).toHaveCSS('width', '390px');

  // A hand-typed size is allowed, and stops claiming to be a preset.
  await page.getByTestId('screen-width').fill('600');
  await expect(label).toContainText('600 x 844');
  await expect(label).not.toContainText('Phone');
  await expect(page.getByTestId('screen-preset')).toHaveValue('');
});

test('dragging the corner resizes the screen in one undo', async ({ page }) => {
  await page.locator('.layer--artboard').first().click();

  // A small frame first: a phone at 844px tall puts its bottom-right corner below the browser
  // window, and this test is about the drag, not about panning to reach it.
  await page.getByTestId('screen-width').fill('400');
  await page.getByTestId('screen-height').fill('300');

  const label = page.locator('.artboard__label .chip--mono').first();
  await expect(label).toContainText('400 x 300');

  const grip = page.locator('[data-testid^="resize-"]').first();
  const box = (await grip.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 120, { steps: 10 });
  await page.mouse.up();

  // The exact arithmetic depends on the canvas zoom, which is not the contract here — that the
  // drag resizes the screen, and that one undo puts it back, is.
  const grown = (await label.innerText()).match(/(\d+) x (\d+)/)!;
  expect(Number(grown[1])).toBeGreaterThan(400);
  expect(Number(grown[2])).toBeGreaterThan(300);

  // The whole drag is one op: one press of undo puts the screen back.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(label).toContainText('400 x 300');
});
