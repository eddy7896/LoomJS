import { expect, test, type Page } from '@playwright/test';
import { firstScreen, nameInput } from './canvas';

/**
 * S0/S1's gate: one left column holding the tree and the palette, an icon rail beside it, and no
 * components left in the top toolbar (`docs/11-editor-shell.md`).
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

test('the toolbar no longer carries components', async ({ page }) => {
  // The done-when, stated as the thing that must be absent.
  await expect(page.locator('.toolbar').getByRole('button', { name: '+ Text field' })).toHaveCount(
    0,
  );
  await expect(page.getByTestId('elements-panel').getByRole('button', { name: '+ Text field' }))
    .toHaveCount(1);
});

test('every element is placeable from the sidebar, in its category', async ({ page }) => {
  const palette = page.getByTestId('elements-panel');

  await expect(palette.getByTestId('palette-section-visual-elements')).toBeVisible();
  await expect(palette.getByTestId('palette-section-containers')).toBeVisible();
  await expect(palette.getByTestId('palette-section-input-forms')).toBeVisible();

  await page.locator('.layer--artboard', { hasText: 'Home' }).first().click();
  await palette.getByRole('button', { name: '+ Checkbox' }).click();
  await nameInput(page).fill('Agree');

  await expect(page.locator('.layer', { hasText: 'Agree' })).toHaveCount(1);
});

test('search finds an element by a name it has in other tools', async ({ page }) => {
  // "Dropdown" has to find Select, or the palette only helps people who already know loom's
  // vocabulary.
  await page.getByTestId('palette-search').fill('dropdown');

  const palette = page.getByTestId('elements-panel');
  await expect(palette.getByRole('button', { name: '+ Select' })).toBeVisible();
  await expect(palette.getByRole('button', { name: '+ Checkbox' })).toHaveCount(0);

  await page.getByTestId('palette-search').fill('zzz');
  await expect(palette).toContainText('Nothing matches');
});

test('a category collapses, and search opens it again', async ({ page }) => {
  const palette = page.getByTestId('elements-panel');
  await palette.getByTestId('palette-section-input-forms').click();
  await expect(palette.getByRole('button', { name: '+ Checkbox' })).toHaveCount(0);

  // A search that left sections shut would hide its own results.
  await page.getByTestId('palette-search').fill('check');
  await expect(palette.getByRole('button', { name: '+ Checkbox' })).toBeVisible();
});

test('the rail switches what the column shows, and Nodes swaps the canvas', async ({ page }) => {
  await page.getByTestId('rail-nodes').click();
  await expect(page.locator('.react-flow')).toBeVisible();
  await expect(page.getByTestId('elements-panel')).toContainText('Backend');
  await expect(page.getByTestId('elements-panel').getByRole('button', { name: '+ API route' }))
    .toBeVisible();

  // Data swaps the column but leaves the canvas alone — connecting a database should not throw
  // away what you were looking at.
  await page.getByTestId('rail-data').click();
  await expect(page.getByTestId('connect-supabase')).toBeVisible();
  await expect(page.locator('.react-flow')).toBeVisible();

  await page.getByTestId('rail-design').click();
  await firstScreen(page);
});

test('problems stay visible in every section', async ({ page }) => {
  // The one thing you must never have to go looking for.
  await expect(page.getByTestId('problems')).toBeVisible();
  await page.getByTestId('rail-nodes').click();
  await expect(page.getByTestId('problems')).toBeVisible();
  await page.getByTestId('rail-data').click();
  await expect(page.getByTestId('problems')).toBeVisible();
});

test('the new elements are placeable, and reach the running app', async ({ page }) => {
  const palette = page.getByTestId('elements-panel');

  for (const name of ['+ Slider', '+ Date field', '+ Multiline field', '+ Icon']) {
    await page.locator('.layer--artboard', { hasText: 'Home' }).first().click();
    await palette.getByRole('button', { name, exact: true }).click();
  }

  await expect(page.locator('.preview__state')).toHaveText('live');
  const preview = page.frameLocator('iframe.preview__frame');
  await expect(preview.locator('input[type="range"]')).toHaveCount(1);
  await expect(preview.locator('input[type="date"]')).toHaveCount(1);
  await expect(preview.locator('textarea')).toHaveCount(1);
  // The icon is inlined, not fetched: no font, no package, no request.
  await expect(preview.locator('svg[aria-hidden="true"]')).toHaveCount(1);
});
