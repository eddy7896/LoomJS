import { test, expect, type Page } from '@playwright/test';
import { firstScreen, nameInput, openPreview } from './canvas';

/**
 * Media elements (`docs/28-media.md`).
 *
 * The canvas draws the real elements — a `<video>` is a video, an `<audio>` is a player — because a
 * designer judging whether a player fits a layout needs the box it will actually occupy. What the
 * canvas must *not* do is play them: sound starting while somebody arranges a screen is the tool
 * interrupting the work.
 */

const inCanvas = (page: Page, selector: string) => page.locator(`.canvas__layer ${selector}`);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto('/');
  await firstScreen(page);
});

test('the palette offers a Media section', async ({ page }) => {
  await expect(page.getByTestId('palette-section-media')).toBeVisible();
  for (const name of ['+ Video', '+ Audio', '+ Carousel', '+ Tiles', '+ Avatar', '+ Embed']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  }
});

test('a video is a real player on the canvas, and never plays there', async ({ page }) => {
  await page.getByRole('button', { name: '+ Video', exact: true }).click();
  await nameInput(page).fill('Clip');
  // With neither a source nor a poster there is nothing to draw, so the canvas shows the box the
  // player will occupy instead. Give it one, and it draws the player itself.
  await page
    .locator('.field', { has: page.locator('.field__label', { hasText: 'Source' }) })
    .locator('input')
    .fill('https://example.com/clip.mp4');

  const video = inCanvas(page, 'video');
  await expect(video).toHaveClass(/loom-video/);
  // Whatever the document says, the canvas never arms it: a screen of elements that all start
  // playing when it is opened is not a canvas anybody can work in.
  expect(await video.evaluate((node: HTMLVideoElement) => node.autoplay)).toBe(false);
  expect(await video.evaluate((node: HTMLVideoElement) => node.muted)).toBe(true);
});

test('an avatar falls back to initials, and shows them on the canvas', async ({ page }) => {
  await page.getByRole('button', { name: '+ Avatar', exact: true }).click();
  await page
    .locator('.field', { has: page.locator('.field__label', { hasText: 'Name' }) })
    .locator('input')
    .fill('Ada Lovelace');

  await expect(inCanvas(page, '.loom-avatar')).toHaveText('AL');
});

test('tiles wrap by width rather than by count', async ({ page }) => {
  await page.getByRole('button', { name: '+ Tiles', exact: true }).click();

  const tiles = inCanvas(page, '.loom-tiles');
  const columns = await tiles.evaluate((node) => window.getComputedStyle(node).gridTemplateColumns);
  // A real grid, resolved to however many columns fit — not a flex row that would tell a designer
  // nothing about how the gallery behaves at the size they are drawing for.
  expect(columns.split(' ').length).toBeGreaterThan(1);
});

test('a carousel reaches the running app with working controls', async ({ page }) => {
  await page.getByRole('button', { name: '+ Carousel', exact: true }).click();
  await page
    .locator('.field', { has: page.locator('.field__label', { hasText: 'Images' }) })
    .locator('input')
    .fill('https://example.com/a.png, https://example.com/b.png');

  await openPreview(page);
  await expect(page.locator('.preview__state')).toHaveText('live', { timeout: 30_000 });

  const app = page.frameLocator('iframe.preview__frame');
  const slide = app.locator('.loom-carousel__slide');
  await expect(slide).toBeVisible({ timeout: 20_000 });
  await expect(slide).toHaveAttribute('src', 'https://example.com/a.png');

  // The controls are real buttons with names, so this reaches them the way a person would.
  await app.getByRole('button', { name: 'Next' }).click();
  await expect(slide).toHaveAttribute('src', 'https://example.com/b.png');

  // And it wraps rather than stopping at the end.
  await app.getByRole('button', { name: 'Next' }).click();
  await expect(slide).toHaveAttribute('src', 'https://example.com/a.png');

  // A dot goes straight to a slide, which is why they are buttons and not decoration.
  await app.getByRole('button', { name: 'Slide 2' }).click();
  await expect(slide).toHaveAttribute('src', 'https://example.com/b.png');
});
