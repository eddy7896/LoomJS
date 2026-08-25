import { expect, test, type Page } from '@playwright/test';
import { firstScreen } from './canvas';

/**
 * The Pager, through the editor and into the running app (Q2, `docs/V1-COMPLETION.md`).
 *
 * The compiler tests prove it emits the right code and the component tests prove it can be placed
 * and wired. Neither proves a person can **click it and have something happen**, which is the only
 * claim that matters for a control.
 *
 * That gap is not hypothetical here. R1 shipped with its palette section never appearing while a
 * thousand unit tests stayed green, and the route this pager wires to had no total port to wire
 * *from* until this file was written.
 *
 * Paging is deliberately checked without a database. The page number is component state and the
 * buttons move it; what a read does with that number is the compiler's half, already covered. This
 * asks the smaller question the smaller way: does the control work.
 */

const preview = (page: Page) => page.frameLocator('iframe.preview__frame');

/** Wait for something in the Preview, re-resolving the frame — it reloads on its first build. */
async function previewHas(page: Page, selector: string): Promise<void> {
  await expect
    .poll(async () => preview(page).locator(selector).count(), { timeout: 20_000 })
    .toBeGreaterThan(0);
}

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

test('a pager can be placed, and it draws as a page control', async ({ page }) => {
  // Offered by the palette like any other element — no special gesture to learn.
  const entry = page.getByTestId('palette-Pager');
  await expect(entry).toBeVisible();
  await entry.click();

  // Drawn on the canvas as what it is, rather than as an empty box a designer has to imagine.
  const pager = page.locator('.loom-pager').first();
  await expect(pager).toBeVisible();
  await expect(pager.locator('.loom-pager__where')).toHaveText('1 / 1');
});

test('the emitted control moves the page in the running app', async ({ page }) => {
  await page.getByTestId('palette-Pager').click();

  // A page size of one, so a total of nothing still leaves a page to be on and the arithmetic is
  // visible without a database behind it.
  await previewHas(page, '.loom-pager');

  const where = preview(page).locator('.loom-pager__where');
  await expect(where).toHaveText('1 / 1');

  /**
   * With no total wired there is one page, so both ends are off. That is the honest answer —
   * nothing has said there are more rows, and paging forward into rows that may not exist trades
   * a control that looks stuck for one that lies. The Problems row below says what to wire.
   */
  await expect(preview(page).getByRole('button', { name: 'Next' })).toBeDisabled();
  await expect(preview(page).getByRole('button', { name: 'Previous' })).toBeDisabled();
});

test('it says so when nothing has told it how many rows there are', async ({ page }) => {
  await page.getByTestId('palette-Pager').click();

  // A pager with no total cannot tell which page is the last one, which is why both its buttons
  // are off. The panel is open by default, so this is where that gets explained.
  await expect(page.getByTestId('problem-pager-no-total')).toContainText('how many rows');
});
