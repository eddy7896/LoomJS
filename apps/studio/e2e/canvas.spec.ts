import { expect, test, type Page } from '@playwright/test';
import { nameInput } from './canvas';

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

/**
 * Wait for something to exist in the Preview, re-resolving the frame each time.
 *
 * The Preview reloads on its first build, and Vite reloads it again the first time it optimises
 * dependencies. A locator bound to the frame before either can end up holding one that no longer
 * exists, which reads as "never appeared" — so this asks the page for the frame on every attempt.
 */
async function previewHas(page: Page, selector: string): Promise<void> {
  await expect
    .poll(
      async () => page.frameLocator('iframe.preview__frame').locator(selector).count(),
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0);
}

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

  await previewHas(page, 'svg rect');

  // At the size it was drawn — 200x120 of screen at 80% zoom is 250x150 of app, because a shape
  // drawn at half zoom must not come out twice the size it looked.
  const svg = preview(page).locator('svg').first();
  await expect(svg).toHaveCSS('width', '250px');
  await expect(svg).toHaveCSS('height', '150px');
  // And *where* it was drawn: a screen is a drawing board until someone asks for auto layout.
  await expect(svg).toHaveCSS('position', 'absolute');
});

test('an ellipse is a different shape, not a rounded box', async ({ page }) => {
  await page.getByTestId('tool-Shape:ellipse').click();
  await draw(page, { x: 40, y: 40 }, { x: 200, y: 140 });

  await expect(page.locator('.preview__state')).toHaveText('live');
  await previewHas(page, 'svg ellipse');
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
  // Slots only exist where a frame arranges its children, so this is one that does.
  await page.locator('.layer--artboard', { hasText: 'Home' }).first().click();
  await page.getByTestId('flow-column').click();

  // Two texts, so there is a slot to drop into rather than an empty frame.
  for (const name of ['first', 'second']) {
    await page.locator('.layer--artboard', { hasText: 'Home' }).first().click();
    await page.getByRole('button', { name: '+ Text', exact: true }).click();
    await nameInput(page).fill(name);
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

test('a screen and its frame are one row, and one panel', async ({ page }) => {
  // They were always one object — a frame with a route — and the second row made a designer
  // guess which half held the padding (`docs/12-canvas.md`).
  await expect(page.locator('.layer', { hasText: 'Root' })).toHaveCount(0);

  const screen = page.locator('.layer--artboard', { hasText: 'Home' }).first();
  await expect(screen).toContainText('834×1112');
  await screen.click();

  // One inspector: what the screen is, and what its frame does.
  await expect(page.getByTestId('guard-mode')).toBeVisible();
  await expect(page.getByTestId('layout-padding')).toBeVisible();
});

test('a frame drawn on the open canvas is a new screen', async ({ page }) => {
  await page.getByTestId('tool-Frame').click();

  // On the canvas itself, above the first screen, rather than inside anything.
  const board = (await page.locator('.artboard').first().boundingBox())!;
  const empty = { x: board.x + 120, y: board.y - 50 };
  await page.mouse.move(empty.x, empty.y);
  await page.mouse.down();
  await page.mouse.move(empty.x + 260, empty.y + 30, { steps: 8 });
  await page.mouse.up();

  await expect(page.locator('.layer--artboard')).toHaveCount(2);
  await expect(page.locator('.artboard')).toHaveCount(2);
});

test('the frame tool can take a screen size', async ({ page }) => {
  await page.getByTestId('tool-Frame-sizes').click();
  await page.getByTestId('frame-size-phone-sm').click();

  const board = (await page.locator('.artboard').first().boundingBox())!;
  await page.mouse.click(board.x + 120, board.y - 50);

  // A screen is named for what it is in the app, not for the device it was drawn at — the size
  // chip is where the shape shows.
  await expect(page.locator('.layer--artboard', { hasText: '390×844' })).toHaveCount(1);
  await expect(page.locator('.layer--artboard')).toHaveCount(2);
});

test('a frame drawn inside a screen is a group, not a screen', async ({ page }) => {
  await page.getByTestId('tool-Frame').click();
  await draw(page, { x: 40, y: 40 }, { x: 240, y: 200 });

  // Still one screen; the frame went in it.
  await expect(page.locator('.layer--artboard')).toHaveCount(1);
  await expect(page.locator('.layer', { hasText: 'Frame' })).toBeVisible();
});

test('two things drawn in different places stay in different places', async ({ page }) => {
  // The whole point of free placement: the gesture decides, not the frame.
  await page.getByTestId('tool-Shape:rectangle').click();
  await draw(page, { x: 40, y: 40 }, { x: 160, y: 120 });

  await page.getByTestId('tool-Shape:ellipse').click();
  await draw(page, { x: 260, y: 300 }, { x: 380, y: 400 });

  await expect(page.locator('.preview__state')).toHaveText('live');
  await previewHas(page, 'svg rect');

  const rect = (await preview(page).locator('svg').first().boundingBox())!;
  const ellipse = (await preview(page).locator('svg').nth(1).boundingBox())!;
  // Down and to the right of the first, rather than stacked under it.
  expect(ellipse.x).toBeGreaterThan(rect.x + 100);
  expect(ellipse.y).toBeGreaterThan(rect.y + 100);
});

test('a component can be dragged to another place on the canvas', async ({ page }) => {
  await page.getByTestId('tool-Shape:rectangle').click();
  await draw(page, { x: 60, y: 60 }, { x: 200, y: 160 });

  const board = (await page.locator('.artboard').first().boundingBox())!;
  const shape = page.locator('.artboard svg').first();
  const before = (await shape.boundingBox())!;

  await page.mouse.move(before.x + 30, before.y + 30);
  await page.mouse.down();
  await page.mouse.move(board.x + 400, board.y + 420, { steps: 10 });
  await page.mouse.up();

  const after = (await shape.boundingBox())!;
  expect(after.x).toBeGreaterThan(before.x + 100);
  // Moved, not reparented: dragging in a free frame is a position, not a slot.
  await expect(page.locator('.layer', { hasText: 'Rectangle' })).toHaveCount(1);
});

test('a frame can be handed back to auto layout', async ({ page }) => {
  await page.locator('.layer--artboard', { hasText: 'Home' }).first().click();
  await expect(page.getByTestId('flow-free')).toHaveAttribute('aria-pressed', 'true');

  await page.getByTestId('flow-column').click();
  await expect(page.getByTestId('flow-column')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('layout-gap')).toBeVisible();

  // And what it holds is arranged from then on.
  await page.getByRole('button', { name: '+ Text', exact: true }).click();
  await expect(page.locator('.preview__state')).toHaveText('live');
  await expect(preview(page).locator('span').first()).toHaveCSS('position', 'static');
});

test('rulers, a grid and guides are there to line things up against', async ({ page }) => {
  await expect(page.getByTestId('ruler-x')).toBeVisible();
  await expect(page.getByTestId('ruler-y')).toBeVisible();

  // The grid is off until asked for, and lives on the screen rather than over the canvas.
  await expect(page.locator('.artboard.has-grid')).toHaveCount(0);
  await page.getByTestId('toggle-grid').click();
  await expect(page.locator('.artboard.has-grid')).toHaveCount(1);

  // A guide is *pulled out* of the ruler, and shows where it will land on the way.
  const ruler = (await page.getByTestId('ruler-x').boundingBox())!;
  await page.mouse.move(ruler.x + 300, ruler.y + 10);
  await page.mouse.down();
  await page.mouse.move(ruler.x + 300, ruler.y + 200, { steps: 8 });
  await expect(page.getByTestId('guide-draft')).toBeVisible();
  await page.mouse.up();
  await expect(page.locator('.guide--x')).toHaveCount(1);
  await expect(page.getByTestId('guide-draft')).toHaveCount(0);

  // Letting go without leaving the ruler drops nothing: that is how it is called off.
  await page.mouse.move(ruler.x + 500, ruler.y + 10);
  await page.mouse.down();
  await page.mouse.move(ruler.x + 520, ruler.y + 12, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('.guide--x')).toHaveCount(1);

  // It survives a reload, because it belongs to the composition rather than to the session.
  await page.reload();
  await expect(page.locator('.guide--x')).toHaveCount(1);

  // Rulers can be turned off; the toggle is remembered too.
  await page.getByTestId('toggle-rulers').click();
  await expect(page.getByTestId('ruler-x')).toHaveCount(0);
});

test('anything on the canvas can be resized by its handles', async ({ page }) => {
  await page.getByTestId('tool-Shape:rectangle').click();
  await draw(page, { x: 60, y: 60 }, { x: 200, y: 160 });

  // Eight of them: the corners and the edges, on the selection rather than on the component.
  await expect(page.locator('.overlay__handle')).toHaveCount(8);

  const shape = page.locator('.artboard svg').first();
  const before = (await shape.boundingBox())!;

  const handle = (await page.getByTestId('resize-se').boundingBox())!;
  await page.mouse.move(handle.x + 4, handle.y + 4);
  await page.mouse.down();
  await page.mouse.move(handle.x + 124, handle.y + 84, { steps: 10 });
  await page.mouse.up();

  const after = (await shape.boundingBox())!;
  expect(after.width).toBeGreaterThan(before.width + 80);
  expect(after.height).toBeGreaterThan(before.height + 50);

  // It reaches the running app as a size, not as a drawing the editor kept to itself.
  await expect(page.locator('.preview__state')).toHaveText('live');
  await previewHas(page, 'svg rect');
  const inApp = (await preview(page).locator('svg').first().boundingBox())!;
  expect(Math.round(inApp.width)).toBeGreaterThan(Math.round(before.width));

  // And the whole drag is one undo, not one per pixel.
  await page.getByRole('button', { name: 'Undo' }).click();
  const undone = (await shape.boundingBox())!;
  expect(Math.abs(undone.width - before.width)).toBeLessThan(3);
});

test('a top-left handle moves the box as well as sizing it', async ({ page }) => {
  await page.getByTestId('tool-Shape:rectangle').click();
  await draw(page, { x: 160, y: 160 }, { x: 300, y: 260 });

  const shape = page.locator('.artboard svg').first();
  const before = (await shape.boundingBox())!;

  const handle = (await page.getByTestId('resize-nw').boundingBox())!;
  await page.mouse.move(handle.x + 4, handle.y + 4);
  await page.mouse.down();
  await page.mouse.move(handle.x - 60, handle.y - 40, { steps: 8 });
  await page.mouse.up();

  const after = (await shape.boundingBox())!;
  // The edge that moved took the origin with it: bigger, and further up and to the left.
  expect(after.width).toBeGreaterThan(before.width + 30);
  expect(after.x).toBeLessThan(before.x - 30);
});

test('the canvas draws a component the way the app does, not the way the studio does', async ({
  page,
}) => {
  // Design mode renders the app's markup inside the studio's own document, so the studio's
  // element styles used to land on it: a Text field inherited `width: 100%` from the inspector's
  // inputs and stretched across the screen. A canvas that lies about what an input looks like is
  // worse than no canvas (`docs/12-canvas.md`).
  await page.getByRole('button', { name: '+ Text field', exact: true }).click();
  await page.locator('.layer--artboard').first().click();
  await page.getByRole('button', { name: '+ Button', exact: true }).click();

  await expect(page.locator('.preview__state')).toHaveText('live');
  await previewHas(page, 'input');

  for (const selector of ['input', 'button']) {
    const onCanvas = await page
      .locator(`.artboard ${selector}`)
      .first()
      .evaluate((el) => {
        const style = getComputedStyle(el);
        return [style.width, style.fontSize, style.borderRadius, style.padding].join(' | ');
      });
    const inApp = await preview(page)
      .locator(selector)
      .first()
      .evaluate((el) => {
        const style = getComputedStyle(el);
        return [style.width, style.fontSize, style.borderRadius, style.padding].join(' | ');
      });
    expect(onCanvas, selector).toBe(inApp);
  }
});
