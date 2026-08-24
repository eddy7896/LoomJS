import { test, expect, type Page } from '@playwright/test';
import { firstScreen, openPreview } from './canvas';

/**
 * Charts, calendar and chat (`docs/30-charts.md`, `docs/31-calendar-chat.md`).
 *
 * The canvas cannot show real data — the rows arrive from a query when the app runs — so what these
 * check is that each element *draws itself* on the artboard and reaches the running app as the same
 * shape. The numbers are sample values on the canvas, and openly so.
 */

const canvas = (page: Page, selector: string) => page.locator(`.canvas__layer ${selector}`);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto('/');
  await firstScreen(page);
});

test('the palette offers a Charts section', async ({ page }) => {
  await expect(page.getByTestId('palette-section-charts')).toBeVisible();
  for (const name of ['+ Bar chart', '+ Line chart', '+ Pie chart', '+ Stat', '+ Calendar', '+ Chat']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  }
});

test('a chart draws itself on the canvas, with sample data', async ({ page }) => {
  await page.getByRole('button', { name: '+ Bar chart', exact: true }).click();

  const chart = canvas(page, '.loom-chart');
  await expect(chart).toBeVisible();
  // Real bars, not a grey box standing in for one: what is being judged here is the size and the
  // shape, and both are real even though the numbers are not.
  await expect(chart.locator('rect.loom-chart__bar')).toHaveCount(6);
});

test('the variant changes the drawing, not only the class', async ({ page }) => {
  await page.getByRole('button', { name: '+ Line chart', exact: true }).click();

  const chart = canvas(page, '.loom-chart');
  await expect(chart.locator('path.loom-chart__line')).toHaveCount(1);
  await expect(chart.locator('path.loom-chart__area')).toHaveCount(0);

  await page.getByTestId('variant-variant-area').click();
  await expect(chart.locator('path.loom-chart__area')).toHaveCount(1);

  // A pie is wedges; a donut is wedges with a hole, which shows up in the path data.
  await page.locator('.layer--artboard').first().click();
  await page.getByRole('button', { name: '+ Pie chart', exact: true }).click();
  const wedges = canvas(page, '.loom-chart__slice');
  await expect(wedges).toHaveCount(6);

  const solid = await wedges.first().getAttribute('d');
  await page.getByTestId('variant-variant-donut').click();
  expect(await wedges.first().getAttribute('d')).not.toBe(solid);
});

test('a calendar draws this month', async ({ page }) => {
  await page.getByRole('button', { name: '+ Calendar', exact: true }).click();

  const calendar = canvas(page, '.loom-calendar');
  // Six weeks, always: a calendar that changes height between March and April makes everything
  // under it jump.
  await expect(calendar.locator('.loom-calendar__day')).toHaveCount(42);
  await expect(calendar.locator('.loom-calendar__weekday').first()).toHaveText('Mon');
  await expect(calendar.locator('.loom-calendar__day.is-today')).toHaveCount(1);
});

test('a chart and a calendar reach the running app', async ({ page }) => {
  await page.getByRole('button', { name: '+ Stat', exact: true }).click();
  await page.locator('.layer--artboard').first().click();
  await page.getByRole('button', { name: '+ Calendar', exact: true }).click();

  await openPreview(page);
  await expect(page.locator('.preview__state')).toHaveText('live', { timeout: 30_000 });

  const app = page.frameLocator('iframe.preview__frame');
  await expect(app.locator('.loom-stat__value')).toBeVisible({ timeout: 20_000 });
  await expect(app.locator('.loom-calendar__day')).toHaveCount(42);
});

test('the month moves in the running app', async ({ page }) => {
  await page.getByRole('button', { name: '+ Calendar', exact: true }).click();

  await openPreview(page);
  await expect(page.locator('.preview__state')).toHaveText('live', { timeout: 30_000 });

  const app = page.frameLocator('iframe.preview__frame');
  const month = app.locator('.loom-calendar__month');
  await expect(month).toBeVisible({ timeout: 20_000 });

  const shown = await month.textContent();
  // Real buttons with names, so this reaches them the way a person would.
  await app.getByRole('button', { name: 'Next month' }).click();
  await expect(month).not.toHaveText(shown ?? '');

  await app.getByRole('button', { name: 'Previous month' }).click();
  await expect(month).toHaveText(shown ?? '');
});

test('a chat has a log and a composer in the running app', async ({ page }) => {
  await page.getByRole('button', { name: '+ Chat', exact: true }).click();

  await openPreview(page);
  await expect(page.locator('.preview__state')).toHaveText('live', { timeout: 30_000 });

  const app = page.frameLocator('iframe.preview__frame');
  const log = app.locator('.loom-chat__log');
  await expect(log).toBeVisible({ timeout: 20_000 });
  // Announced without stealing focus, which is what a live region is for.
  await expect(log).toHaveAttribute('aria-live', 'polite');

  const draft = app.getByRole('textbox', { name: 'Write a message' });
  await draft.fill('Hello');
  await expect(draft).toHaveValue('Hello');
});
