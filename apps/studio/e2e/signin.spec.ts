import { expect, test } from '@playwright/test';
import { firstScreen } from './canvas';

/**
 * Sign-in buttons, from the palette to the artboard (`docs/19-sign-in-elements.md`).
 *
 * Playwright drives HTML drag-and-drop through `dragTo`, which dispatches the same events a
 * pointer would — so what is exercised here is the real dataTransfer payload, the real drop
 * target resolution and the real placement.
 */


/**
 * One HTML5 drag, dispatched explicitly.
 *
 * `dragTo` drives a pointer and lets the browser synthesise the drag, which is occasionally a
 * frame short and drops nothing. These are the same events with the same `dataTransfer` carried
 * between them — what the app actually listens for, and deterministic.
 */
async function dragOnto(
  page: import('@playwright/test').Page,
  source: string,
  target: string,
): Promise<void> {
  const data = await page.evaluateHandle(() => new DataTransfer());
  const box = (await page.locator(target).first().boundingBox())!;
  // The drop reads clientX/clientY to work out where in the tree it landed, so a synthetic event
  // has to carry them — a dispatched event defaults to the origin, which is off every screen.
  const at = { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 };

  await page.locator(source).dispatchEvent('dragstart', { dataTransfer: data });
  await page.locator(target).first().dispatchEvent('dragover', { dataTransfer: data, ...at });
  await page.locator(target).first().dispatchEvent('drop', { dataTransfer: data, ...at });
  await data.dispose();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto('/');
  await firstScreen(page);
});

test('the palette offers a button per provider', async ({ page }) => {
  await expect(page.getByTestId('palette-section-sign-in')).toBeVisible();

  await expect(page.getByTestId('palette-signin-google')).toContainText('Google');
  await expect(page.getByTestId('palette-signin-apple')).toContainText('Apple');
  await expect(page.getByTestId('palette-signin-github')).toContainText('GitHub');

  // And it says what they need before anyone places three of them.
  await expect(page.locator('.palette__section', { hasText: 'Sign in' })).toContainText(
    'need a Supabase connection',
  );
});

test('dragging one onto the artboard places it, labelled and wired', async ({ page }) => {
  await dragOnto(page, '[data-testid="palette-signin-google"]', '.artboard');

  // It arrives saying what it does.
  await expect(page.getByTestId('component-name')).toHaveValue('Continue with Google');
  await expect(page.locator('.layer', { hasText: 'Continue with Google' }).first()).toBeVisible();

  // On the canvas, and on the screen it was dropped on.
  await expect(
    page.locator('.artboard button', { hasText: 'Continue with Google' }).first(),
  ).toBeVisible();
});

test('the button it places is an ordinary Button, wired to the provider', async ({ page }) => {
  await dragOnto(page, '[data-testid="palette-signin-github"]', '.artboard');

  // The action is there to edit, like any other click.
  await expect(page.getByTestId('action-0-provider')).toHaveValue('github');
});

test('clicking still works for anyone who would rather not drag', async ({ page }) => {
  await page.getByTestId('palette-signin-apple').click();

  await expect(page.getByTestId('component-name')).toHaveValue('Continue with Apple');
});
