import { expect, test, type Page } from '@playwright/test';
import { nameInput } from './canvas';

/**
 * The inspector as a design panel (`docs/13-inspector.md`).
 *
 * The claims: it is divided into sections a designer can collapse and that stay collapsed; the
 * controls it offers belong to the thing selected; and what it writes reaches the running app.
 */

const preview = (page: Page) => page.frameLocator('iframe.preview__frame');

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

/** Draw a rectangle, which is the simplest thing with a position, a size and a fill. */
async function rectangle(page: Page): Promise<void> {
  const board = (await page.locator('.artboard').first().boundingBox())!;
  await page.getByTestId('tool-Shape:rectangle').click();
  await page.mouse.move(board.x + 60, board.y + 60);
  await page.mouse.down();
  await page.mouse.move(board.x + 220, board.y + 180, { steps: 8 });
  await page.mouse.up();
}

test('a component is named in the header, and the panel is divided into sections', async ({
  page,
}) => {
  await rectangle(page);

  await nameInput(page).fill('Card');
  await expect(page.locator('.layer', { hasText: 'Card' })).toBeVisible();

  for (const section of ['position', 'size', 'appearance', 'fill', 'stroke', 'effects']) {
    await expect(page.getByTestId(`section-${section}`)).toBeVisible();
  }

  // A rectangle holds nothing, so it is offered no flow and nothing to clip.
  await expect(page.getByTestId('flow-free')).toHaveCount(0);
  await expect(page.getByTestId('clip-content')).toHaveCount(0);
});

test('a section stays collapsed, across selections and reloads', async ({ page }) => {
  await rectangle(page);

  await page.getByTestId('section-effects-toggle').click();
  await expect(page.getByTestId('style-shadow')).toHaveCount(0);

  await page.locator('.layer--artboard').first().click();
  await page.locator('.layer', { hasText: 'Rectangle' }).first().click();
  await expect(page.getByTestId('style-shadow')).toHaveCount(0);

  await page.reload();
  await expect(page.locator('.artboard').first()).toBeVisible();
  await page.locator('.layer', { hasText: 'Rectangle' }).first().click();
  await expect(page.getByTestId('style-shadow')).toHaveCount(0);

  await page.getByTestId('section-effects-toggle').click();
  await expect(page.getByTestId('style-shadow')).toBeVisible();
});

test('position, opacity and rotation reach the running app', async ({ page }) => {
  await rectangle(page);

  await page.getByTestId('position-x').fill('40');
  await page.getByTestId('position-y').fill('90');
  await page.getByTestId('opacity').fill('50');
  await page.getByTestId('rotation').fill('15');

  await expect(page.locator('.preview__state')).toHaveText('live');
  const shape = preview(page).locator('svg').first();
  await expect(shape).toHaveCSS('left', '40px');
  await expect(shape).toHaveCSS('top', '90px');
  await expect(shape).toHaveCSS('opacity', '0.5');
  await expect(shape).toHaveAttribute('style', /rotate\(15deg\)/);
});

test('alignment lines a component up with the frame it is in', async ({ page }) => {
  await rectangle(page);
  await page.getByTestId('position-x').fill('0');

  await page.getByTestId('align-right').click();
  const x = Number(await page.getByTestId('position-x').inputValue());
  // Pushed to the far side rather than nudged: the screen is 834 wide by default.
  expect(x).toBeGreaterThan(400);

  await page.getByTestId('align-left').click();
  // Back to the frame's own padding, which is where its inside starts.
  expect(Number(await page.getByTestId('position-x').inputValue())).toBe(16);
});

test('a frame is offered flow, padding and clipping; a screen the same', async ({ page }) => {
  await page.locator('.layer--artboard').first().click();

  await expect(page.getByTestId('flow-free')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('layout-padding')).toBeVisible();
  await expect(page.getByTestId('clip-content')).toBeVisible();

  await page.getByTestId('flow-row').click();
  await expect(page.getByTestId('layout-gap')).toBeVisible();
  await expect(page.getByTestId('layout-align')).toBeVisible();

  await page.getByTestId('clip-content').check();
  await expect(page.locator('.preview__state')).toHaveText('live');
  await expect(preview(page).locator('#root > div')).toHaveCSS('overflow', 'hidden');
});

test('a fill names a token, and the swatch shows what it resolves to', async ({ page }) => {
  await rectangle(page);

  await page.getByTestId('style-background').selectOption('color.brand');
  await expect(page.locator('.ins__swatch').first()).toHaveCSS(
    'background-color',
    'rgb(236, 48, 19)',
  );

  await expect(page.locator('.preview__state')).toHaveText('live');
  await expect(preview(page).locator('svg rect')).toHaveAttribute(
    'fill',
    'var(--loom-color-brand)',
  );

  // And it can be taken off again, which is what the minus is for.
  await page.getByTestId('style-background-clear').click();
  await expect(page.getByTestId('style-background')).toHaveValue('');
});
