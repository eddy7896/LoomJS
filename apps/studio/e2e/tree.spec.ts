import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * S2's gate: a component can be dragged into a different Frame from the tree alone, in one undo
 * (`docs/11-editor-shell.md`).
 */

const preview = (page: Page) => page.frameLocator('iframe.preview__frame');

const field = (page: Page, label: string) =>
  page.locator('.field', { has: page.locator('.field__label', { hasText: label }) });

const layer = (page: Page, name: string): Locator =>
  page.locator('.layer', { has: page.locator('.layer__name', { hasText: name }) }).first();

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

async function place(page: Page, button: string, name: string): Promise<void> {
  await page.getByTestId('elements-panel').getByRole('button', { name: button, exact: true }).click();
  await field(page, 'Name').locator('input').fill(name);
}

/**
 * HTML5 drag and drop, which Playwright's `dragTo` does not drive for `draggable` elements — the
 * events have to be dispatched with a shared DataTransfer or the drop never fires.
 */
async function dragRow(page: Page, from: Locator, to: Locator): Promise<void> {
  await from.dispatchEvent('dragstart', { dataTransfer: await page.evaluateHandle(() => new DataTransfer()) });
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await to.dispatchEvent('dragover', { dataTransfer: transfer });
  await to.dispatchEvent('drop', { dataTransfer: transfer });
}

test('a component moves into a different frame, from the tree alone', async ({ page }) => {
  await page.locator('.layer', { hasText: 'Root' }).first().click();
  await place(page, '+ Frame', 'Card');

  // A Text on the root, beside the frame rather than inside it.
  await page.locator('.layer', { hasText: 'Root' }).first().click();
  await place(page, '+ Text', 'Caption');

  const caption = layer(page, 'Caption');
  await expect(caption).toBeVisible();

  await dragRow(page, caption, layer(page, 'Card'));

  // Indentation is how the tree says "inside": the moved row now sits deeper than the frame.
  const cardIndent = await layer(page, 'Card').evaluate((el) => (el as HTMLElement).style.paddingLeft);
  const captionIndent = await layer(page, 'Caption').evaluate(
    (el) => (el as HTMLElement).style.paddingLeft,
  );
  expect(parseInt(captionIndent, 10)).toBeGreaterThan(parseInt(cardIndent, 10));

  // And one undo puts it back — a move that took two steps would leave a state nobody drew.
  await page.keyboard.press('Control+z');
  const back = await layer(page, 'Caption').evaluate((el) => (el as HTMLElement).style.paddingLeft);
  expect(parseInt(back, 10)).toBe(parseInt(cardIndent, 10));
});

test('hiding while designing takes it off the canvas and leaves the app alone', async ({ page }) => {
  await page.locator('.layer', { hasText: 'Root' }).first().click();
  await place(page, '+ Text', 'Secret');
  await field(page, 'Content').locator('input').fill('still shipped');

  await expect(page.locator('.artboard').getByText('still shipped')).toBeVisible();
  await expect(page.locator('.preview__state')).toHaveText('live');
  await expect(preview(page).locator('span', { hasText: 'still shipped' })).toBeVisible();

  const row = layer(page, 'Secret');
  const id = await row.getAttribute('data-testid');
  await page.getByTestId(`layer-eye-${id!.replace('layer-', '')}`).click();

  // Gone from the canvas...
  await expect(page.locator('.artboard').getByText('still shipped')).toHaveCount(0);
  // ...and still in the app being built. Hiding is a view concern, never `visibleWhen`.
  await expect(preview(page).locator('span', { hasText: 'still shipped' })).toBeVisible();
  // The row stays, so it can always be brought back.
  await expect(row).toBeVisible();
});

test('a branch collapses, and selecting inside it opens it again', async ({ page }) => {
  await page.locator('.layer', { hasText: 'Root' }).first().click();
  await place(page, '+ Frame', 'Card');
  await place(page, '+ Text', 'Inside');

  const insideId = (await layer(page, 'Inside').getAttribute('data-testid'))!.replace('layer-', '');
  const cardId = (await layer(page, 'Card').getAttribute('data-testid'))!.replace('layer-', '');

  await page.getByTestId(`layer-caret-${cardId}`).click();
  await expect(layer(page, 'Inside')).toHaveCount(0);

  // Selecting on the canvas reveals the row: a selection buried in a shut branch reads as the
  // click having done nothing.
  await page.locator(`.artboard [data-loom-id="${insideId}"]`).click();
  await expect(layer(page, 'Inside')).toBeVisible();
});

test('a row says when it carries a condition or a sequence', async ({ page }) => {
  await page.locator('.layer', { hasText: 'Root' }).first().click();
  await place(page, '+ Checkbox', 'Agree');
  await page.locator('.layer', { hasText: 'Root' }).first().click();
  await place(page, '+ Text', 'Secret');

  await page.getByTestId('visible-when').selectOption({ label: 'Agree is checked' });
  await expect(layer(page, 'Secret').locator('.chip')).toHaveText('?');
});

test('Enter places the top hit', async ({ page }) => {
  await page.locator('.layer', { hasText: 'Root' }).first().click();
  await page.getByTestId('palette-search').fill('dropdown');
  await page.getByTestId('palette-search').press('Enter');

  await expect(layer(page, 'Select')).toBeVisible();
  // The box clears, so the next search starts from nothing.
  await expect(page.getByTestId('palette-search')).toHaveValue('');
});
