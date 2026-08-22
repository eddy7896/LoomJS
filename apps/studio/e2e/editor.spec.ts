import { expect, test, type Page } from '@playwright/test';

/**
 * The loop these specs protect: an edit in the editor must reach the Preview, and the Preview
 * runs real compiler output. If the compiler stops emitting something runnable, these fail.
 */

const preview = (page: Page) => page.frameLocator('iframe.preview__frame');

/** Field lookup by its inspector label. */
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
  await expect(page.locator('.artboard').first()).toBeVisible();
});

test('an edit in the editor shows up in the Preview', async ({ page }) => {
  // A project opens blank (`docs/12-canvas.md` C0), so the thing being edited is placed first.
  await page.getByRole('button', { name: '+ Text', exact: true }).click();
  await field(page, 'Content').locator('input').fill('Hello loomJS');
  await expect(preview(page).locator('span', { hasText: 'Hello loomJS' })).toBeVisible();

  await page.locator('.artboard span', { hasText: 'Hello loomJS' }).click();
  const content = field(page, 'Content').locator('input');
  await content.fill('Edited by the designer');

  await expect(preview(page).locator('span', { hasText: 'Edited by the designer' })).toBeVisible();
  await expect(page.locator('.preview__state')).toHaveText('live');
});

test('placing a component adds it to the running app', async ({ page }) => {
  await page.getByRole('button', { name: '+ Text', exact: true }).click();
  const content = field(page, 'Content').locator('input');
  await content.fill('Second line');

  await expect(preview(page).locator('span', { hasText: 'Second line' })).toBeVisible();
});

test('layout edits reach the Preview', async ({ page }) => {
  await page.locator('.layer', { hasText: 'Root' }).first().click();
  await field(page, 'Direction').locator('select').selectOption('row');
  await field(page, 'Gap').locator('input').fill('48');

  const root = preview(page).locator('#root > div');
  await expect(root).toHaveCSS('flex-direction', 'row');
  await expect(root).toHaveCSS('gap', '48px');
});

test('a flow arrow becomes a route you can click through (M2)', async ({ page }) => {
  // Second screen, with a route param.
  await page.getByRole('button', { name: '+ Screen' }).click();
  await field(page, 'Name').locator('input').fill('Item Detail');
  await page.getByRole('button', { name: '+ Param' }).click();

  // A Text on the detail screen that reads the param is M3-adjacent; instead assert the route
  // itself, which is what M2 promises: navigation between two compiled routes.
  await page.getByRole('button', { name: '+ Text', exact: true }).click();
  await field(page, 'Content').locator('input').fill('Detail screen');

  // Back to Home, add a Button whose click follows a flow to the detail screen.
  await page.locator('.layer--artboard', { hasText: 'Home' }).click();
  await page.getByRole('button', { name: '+ Button' }).click();
  await field(page, 'Label').locator('input').fill('Open item');
  // Navigation is one step of a sequence now (spec 7); adding it creates the arrow.
  await page.getByTestId('add-action').selectOption('navigate');
  await page.getByTestId('action-0-screen').selectOption({ label: 'Item Detail' });
  await page.getByTestId('payload-id').fill('42');

  // A straight arrow has a zero-height box, so assert presence rather than visibility.
  await expect(page.locator('.flow__line')).toHaveCount(1);

  // The Preview is a real router: clicking navigates to the dynamic route.
  const button = preview(page).getByRole('button', { name: 'Open item' });
  await expect(button).toBeVisible();
  await button.click();

  await expect(preview(page).locator('span', { hasText: 'Detail screen' })).toBeVisible();
});

test('an uncompilable edit surfaces as a Build error and keeps the last good build', async ({
  page,
}) => {
  await page.getByRole('button', { name: '+ Screen' }).click();
  await page.getByRole('button', { name: '+ Param' }).click();

  await page.locator('.layer--artboard', { hasText: 'Home' }).click();
  // Something that compiles, so "the last good build is still on screen" has something to show.
  await page.getByRole('button', { name: '+ Text', exact: true }).click();
  await field(page, 'Content').locator('input').fill('Still here');
  await expect(preview(page).locator('span', { hasText: 'Still here' })).toBeVisible();

  await page.getByRole('button', { name: '+ Button' }).click();
  await page.getByTestId('add-action').selectOption('navigate');

  // The flow reaches a dynamic route with an empty param value: a Build-tier failure.
  await expect(page.locator('.preview__error')).toBeVisible();
  await expect(page.locator('.preview__state')).toHaveText('build error');
  // The previously compiled app is still on screen.
  await expect(preview(page).locator('span', { hasText: 'Still here' })).toBeVisible();
});
