import { expect, test, type Page } from '@playwright/test';

/**
 * The canvas as a design tool (`docs/12-canvas.md`).
 *
 * What these hold to is the reconciliation: a drawn gesture reaches the running app as **flex**.
 * A rectangle dragged out at a size arrives at that size, in the slot it was dropped into, and
 * nothing in the emitted app is positioned absolutely.
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

/** Drag inside the screen, from one point to another, in viewport px. */
async function draw(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  const board = await page.locator('.artboard').first().boundingBox();
  if (!board) throw new Error('no artboard');
  await page.mouse.move(board.x + from.x, board.y + from.y);
  await page.mouse.down();
  await page.mouse.move(board.x + to.x, board.y + to.y, { steps: 8 });
  await page.mouse.up();
}

test('a new project opens on a blank canvas with the tools on it', async ({ page }) => {
  // Nothing placed, nothing seeded — the sample heading is gone (C0).
  await expect(page.locator('.artboard span')).toHaveCount(0);
  await expect(page.getByTestId('toolbelt')).toBeVisible();
  await expect(page.getByTestId('tool-move')).toHaveAttribute('aria-pressed', 'true');
});

test('a rectangle drawn on the canvas reaches the running app', async ({ page }) => {
  await page.getByTestId('tool-Shape:rectangle').click();
  await expect(page.getByTestId('tool-Shape:rectangle')).toHaveAttribute('aria-pressed', 'true');

  await draw(page, { x: 40, y: 40 }, { x: 240, y: 160 });

  // The tool hands the pointer back on its own, the way every design tool behaves.
  await expect(page.getByTestId('tool-move')).toHaveAttribute('aria-pressed', 'true');

  // It exists as an element, not as a drawing the editor kept to itself.
  await expect(page.locator('.layer', { hasText: 'Rectangle' })).toBeVisible();
  await expect(page.locator('.preview__state')).toHaveText('live');

  const rect = preview(page).locator('svg rect');
  await expect(rect).toBeVisible();

  // At the size it was drawn — 200x120 of screen at 80% zoom is 250x150 of app, because a shape
  // drawn at half zoom must not come out twice the size it looked.
  const svg = preview(page).locator('svg').first();
  await expect(svg).toHaveCSS('width', '250px');
  await expect(svg).toHaveCSS('height', '150px');
  // Laid out by flex, never placed at a coordinate.
  await expect(svg).toHaveCSS('position', 'static');
});

test('an ellipse is a different shape, not a rounded box', async ({ page }) => {
  await page.getByTestId('tool-Shape:ellipse').click();
  await draw(page, { x: 40, y: 40 }, { x: 200, y: 140 });

  await expect(page.locator('.preview__state')).toHaveText('live');
  await expect(preview(page).locator('svg ellipse')).toBeVisible();
  await expect(preview(page).locator('svg rect')).toHaveCount(0);
});

test('keyboard shortcuts arm the tools, and Escape puts the pointer back', async ({ page }) => {
  await page.locator('.canvas').click({ position: { x: 10, y: 10 } });

  await page.keyboard.press('r');
  await expect(page.getByTestId('tool-Shape:rectangle')).toHaveAttribute('aria-pressed', 'true');

  await page.keyboard.press('t');
  await expect(page.getByTestId('tool-Text')).toHaveAttribute('aria-pressed', 'true');

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('tool-move')).toHaveAttribute('aria-pressed', 'true');
});

test('a shape drawn between two components lands between them', async ({ page }) => {
  // Two texts, so there is a slot to drop into rather than an empty frame.
  for (const name of ['first', 'second']) {
    await page.locator('.layer', { hasText: 'Root' }).first().click();
    await page.getByRole('button', { name: '+ Text', exact: true }).click();
    await field(page, 'Name').locator('input').fill(name);
    await field(page, 'Content').locator('input').fill(name);
  }

  const second = await page.locator('.artboard span', { hasText: 'second' }).boundingBox();
  const board = await page.locator('.artboard').first().boundingBox();
  if (!second || !board) throw new Error('nothing to aim at');

  await page.getByTestId('tool-Shape:rectangle').click();
  // Aim at the top half of "second": the slot before it.
  await draw(
    page,
    { x: second.x - board.x + 10, y: second.y - board.y + 2 },
    { x: second.x - board.x + 110, y: second.y - board.y + 60 },
  );

  const names = await page.locator('.layer__name').allInnerTexts();
  expect(names.join(' > ')).toMatch(/first[\s\S]*Rectangle[\s\S]*second/);
});

test('the popover reaches the rest of the vocabulary without leaving the canvas', async ({
  page,
}) => {
  await page.getByTestId('tool-more').click();
  await page.getByTestId('toolbelt-search').fill('dropdown');
  await page.getByTestId('toolbelt-Select').click();

  await expect(page.getByTestId('toolbelt-popover')).toHaveCount(0);
  await draw(page, { x: 40, y: 40 }, { x: 42, y: 42 });
  await expect(page.locator('.layer', { hasText: 'Select' })).toBeVisible();
});
