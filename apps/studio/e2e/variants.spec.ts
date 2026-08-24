import { test, expect, type Page } from '@playwright/test';
import { firstScreen, openPreview } from './canvas';

/**
 * Variants (`docs/27-variants.md`).
 *
 * Two things are being protected. First, that an element arrives **looking like something** — a
 * button dropped on the canvas used to be the browser's grey rectangle, and every project began by
 * hand-styling the same six properties. Second, and the one that would rot quietly: that the canvas
 * and the running app are painted by the same stylesheet. The test compares the *computed* colour
 * on both sides rather than the class name, because matching class names on top of two different
 * stylesheets is exactly the failure this is meant to catch.
 */

const BRAND = 'rgb(236, 48, 19)';

const canvasButton = (page: Page) => page.locator('.canvas__layer button.loom-button');

async function background(locator: ReturnType<Page['locator']>): Promise<string> {
  return locator.evaluate((node) => window.getComputedStyle(node).backgroundColor);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto('/');
  await firstScreen(page);
});

test('an element arrives wearing a variant, not the browser default', async ({ page }) => {
  await page.getByRole('button', { name: '+ Button', exact: true }).click();

  const button = canvasButton(page);
  await expect(button).toHaveClass(/loom-button--solid/);
  await expect(button).toHaveClass(/loom-button--md/);
  // Solid means the brand colour, from the project's own token — not a grey the browser chose.
  expect(await background(button)).toBe(BRAND);
});

test('picking a variant restyles the element on the canvas', async ({ page }) => {
  await page.getByRole('button', { name: '+ Button', exact: true }).click();

  await page.getByTestId('variant-variant-outline').click();

  const button = canvasButton(page);
  await expect(button).toHaveClass(/loom-button--outline/);
  await expect(button).not.toHaveClass(/loom-button--solid/);
  // Outline is a surface with a hairline round it, so the brand fill has to be gone.
  expect(await background(button)).not.toBe(BRAND);

  // And the size axis is independent of it: choosing a style must not reset the size.
  await page.getByTestId('variant-size-lg').click();
  await expect(button).toHaveClass(/loom-button--outline/);
  await expect(button).toHaveClass(/loom-button--lg/);
});

test('the canvas and the running app are painted the same', async ({ page }) => {
  await page.getByRole('button', { name: '+ Button', exact: true }).click();
  await openPreview(page);
  await expect(page.locator('.preview__state')).toHaveText('live', { timeout: 30_000 });

  const inApp = page.frameLocator('iframe.preview__frame').locator('button.loom-button');
  await expect(inApp).toBeVisible({ timeout: 20_000 });

  // The same bytes style both, so the same colour has to come out of both. Anything else means
  // the canvas is describing an app that does not exist.
  expect(await background(inApp)).toBe(await background(canvasButton(page)));
  expect(await background(inApp)).toBe(BRAND);

  // And it follows a change, rather than being right only on the first build.
  await page.getByTestId('variant-variant-destructive').click();
  await expect(inApp).toHaveClass(/loom-button--destructive/, { timeout: 20_000 });
  expect(await background(inApp)).toBe(await background(canvasButton(page)));
});

test('every painted property agrees between the canvas and the app', async ({ page }) => {
  await page.getByRole('button', { name: '+ Button', exact: true }).click();
  await page.locator('.layer--artboard').first().click();
  await page.getByRole('button', { name: '+ Text field', exact: true }).click();
  await openPreview(page);
  await expect(page.locator('.preview__state')).toHaveText('live', { timeout: 30_000 });

  const app = page.frameLocator('iframe.preview__frame');
  await expect(app.locator('button.loom-button')).toBeVisible({ timeout: 20_000 });

  /**
   * Colour alone was too weak a claim.
   *
   * The studio's own chrome styles every button and input it draws, and the canvas draws the app's
   * elements inside that. A property the variant stylesheet does not mention could be picked up
   * from the studio on one side and not the other — which is a canvas that is right about the
   * colour and wrong about the shape.
   */
  const painted = (node: Element) => {
    const style = window.getComputedStyle(node);
    return [
      style.backgroundColor,
      style.color,
      style.fontSize,
      style.fontWeight,
      style.fontFamily,
      style.padding,
      style.borderRadius,
      style.borderWidth,
      style.borderStyle,
      style.borderColor,
      style.minHeight,
    ].join(' | ');
  };

  for (const selector of ['button.loom-button', 'input.loom-field']) {
    const inCanvas = await page.locator(`.canvas__layer ${selector}`).evaluate(painted);
    const inApp = await app.locator(selector).evaluate(painted);
    expect(inApp, `${selector} is painted differently in the canvas and the app`).toBe(inCanvas);
  }
});

test('a text element carries the type scale by name', async ({ page }) => {
  await page.getByRole('button', { name: '+ Text', exact: true }).click();

  const text = page.locator('.canvas__layer span.loom-text');
  await expect(text).toHaveClass(/loom-text--body/);

  await page.getByTestId('variant-variant-title').click();
  await expect(text).toHaveClass(/loom-text--title/);

  // Title is the type scale's `text.xl`, which is 28px — the token, not a number typed in here.
  const size = await text.evaluate((node) => window.getComputedStyle(node).fontSize);
  expect(size).toBe('28px');
});
