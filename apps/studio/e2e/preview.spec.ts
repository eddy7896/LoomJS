import { expect, test, type Page } from '@playwright/test';
import { firstScreen } from './canvas';

/**
 * The Preview as a floating window (`docs/12-canvas.md`).
 *
 * The claims: it floats over the canvas rather than taking a column from it, it collapses to its
 * bar, it remembers where it was put, and the app inside it renders at a **real** device width
 * rather than being squeezed into whatever space the window has.
 */

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
  await firstScreen(page);
});

test('it floats over the canvas instead of taking a column from it', async ({ page }) => {
  const window_ = page.getByTestId('preview-window');
  await expect(window_).toBeVisible();
  await expect(window_).toHaveCSS('position', 'absolute');

  // The canvas runs the full width underneath it.
  const canvas = (await page.locator('.canvas').boundingBox())!;
  const preview = (await window_.boundingBox())!;
  expect(preview.x).toBeGreaterThan(canvas.x);
  expect(preview.x + preview.width).toBeLessThanOrEqual(canvas.x + canvas.width + 1);
});

test('it collapses to its bar and comes back', async ({ page }) => {
  const window_ = page.getByTestId('preview-window');
  const open = (await window_.boundingBox())!.height;

  await page.getByTestId('preview-collapse').click();
  await expect(page.locator('iframe.preview__frame')).toHaveCount(0);
  expect((await window_.boundingBox())!.height).toBeLessThan(open);

  await page.getByTestId('preview-collapse').click();
  await expect(page.locator('iframe.preview__frame')).toBeVisible();
});

test('it can be moved, and remembers where it was left', async ({ page }) => {
  const window_ = page.getByTestId('preview-window');
  const before = (await window_.boundingBox())!;

  const bar = (await page.locator('.preview__bar').boundingBox())!;
  await page.mouse.move(bar.x + 60, bar.y + 10);
  await page.mouse.down();
  await page.mouse.move(bar.x - 140, bar.y - 90, { steps: 10 });
  await page.mouse.up();

  const after = (await window_.boundingBox())!;
  expect(after.x).toBeLessThan(before.x - 100);

  // A reload puts it back where it was put, not back in the corner.
  await page.reload();
  await firstScreen(page);
  const restored = (await page.getByTestId('preview-window').boundingBox())!;
  expect(Math.abs(restored.x - after.x)).toBeLessThan(4);
});

test('a device preset renders the app at that real width, inside a mockup', async ({ page }) => {
  await page.getByTestId('preview-device').selectOption('phone-sm');

  // 390 CSS pixels of app, whatever size the window happens to be — scaled to fit, never squeezed.
  const frame = page.locator('iframe.preview__frame');
  await expect(frame).toHaveAttribute('style', /width: 390px/);
  await expect(frame).toHaveAttribute('style', /scale\(/);
  await expect(page.getByTestId('preview-mockup-frame')).toHaveClass(/is-phone/);

  // The mockup is decoration and can be turned off; the width is not.
  await page.getByTestId('preview-mockup').click();
  await expect(page.getByTestId('preview-mockup-frame')).not.toHaveClass(/is-phone/);
  await expect(frame).toHaveAttribute('style', /width: 390px/);
});

test('fluid hands the viewport to the window itself', async ({ page }) => {
  await page.getByTestId('preview-device').selectOption('fluid');
  const frame = page.locator('iframe.preview__frame');
  const before = (await frame.boundingBox())!.width;

  const handle = (await page.getByTestId('preview-resize').boundingBox())!;
  await page.mouse.move(handle.x + 6, handle.y + 6);
  await page.mouse.down();
  await page.mouse.move(handle.x + 206, handle.y + 60, { steps: 10 });
  await page.mouse.up();

  // Resizing the window resized the viewport, which is what makes it a responsive test.
  expect((await frame.boundingBox())!.width).toBeGreaterThan(before + 150);
});

test('it follows the screen being designed by default', async ({ page }) => {
  await expect(page.getByTestId('preview-device')).toHaveValue('screen');
  await expect(page.locator('iframe.preview__frame')).toHaveAttribute('style', /width: 834px/);

  // Resize the screen, and the preview is drawn at the new size.
  await page.locator('.layer--artboard', { hasText: 'Home' }).first().click();
  await field(page, 'Width').locator('input').fill('600');
  await expect(page.locator('iframe.preview__frame')).toHaveAttribute('style', /width: 600px/);
});

test('closing it leaves the canvas alone, and the toolbar brings it back', async ({ page }) => {
  await page.getByTestId('preview-close').click();
  await expect(page.getByTestId('preview-window')).toHaveCount(0);

  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByTestId('preview-window')).toBeVisible();
});

test('each device is drawn as the thing it is', async ({ page }) => {
  // A phone has an island, a home bar and buttons down its sides.
  await page.getByTestId('preview-device').selectOption('phone-sm');
  await expect(page.locator('.preview__island')).toBeVisible();
  await expect(page.locator('.preview__home')).toBeVisible();
  await expect(page.locator('.preview__button')).toHaveCount(4);

  // A laptop has a lid and the base it closes onto.
  await page.getByTestId('preview-device').selectOption('laptop');
  await expect(page.getByTestId('preview-mockup-frame')).toHaveClass(/is-desktop/);
  await expect(page.locator('.preview__base')).toBeVisible();
  await expect(page.locator('.preview__island')).toHaveCount(0);

  // A tablet is a thin bezel and a camera, and nothing else.
  await page.getByTestId('preview-device').selectOption('tablet');
  await expect(page.getByTestId('preview-mockup-frame')).toHaveClass(/is-tablet/);
  await expect(page.locator('.preview__camera')).toBeVisible();
  await expect(page.locator('.preview__home')).toHaveCount(0);
});

test('with no device around it, the app is drawn like a screen on the canvas', async ({ page }) => {
  // Same corner radius as an artboard, because it is the same screen.
  const viewport = page.locator('.preview__viewport');
  await expect(viewport).toHaveClass(/is-bare/);
  await expect(viewport).toHaveCSS('border-radius', '14px');

  // Turning the mockup off does the same for a device size.
  await page.getByTestId('preview-device').selectOption('phone-sm');
  await expect(viewport).not.toHaveClass(/is-bare/);
  await page.getByTestId('preview-mockup').click();
  await expect(viewport).toHaveClass(/is-bare/);
});
