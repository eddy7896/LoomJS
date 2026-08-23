import { expect, test } from '@playwright/test';
import { firstScreen } from './canvas';

/**
 * Every element, drawn on the artboard for real (`docs/21-canvas-parity.md`).
 *
 * The unit tests check that each type renders *something* in jsdom. Only a browser can say
 * whether it takes up space: an element can render perfectly and still be invisible at zero
 * height, which looks exactly like the bug this phase started from.
 */

/** Everything the palette offers, in the order the vocabulary lists it. */
const ELEMENTS = [
  'Text',
  'Button',
  'Text field',
  'Number field',
  'Checkbox',
  'Select',
  'List',
  'Table',
  'Image',
  'Link',
  'Icon',
  'Shape',
  'Multiline field',
  'Radio buttons',
  'Date field',
  'Slider',
];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto('/');
  await firstScreen(page);
});

test('every element takes up space on the artboard', async ({ page }) => {
  const palette = page.getByTestId('elements-panel');
  const missing: string[] = [];

  for (const label of ELEMENTS) {
    const entry = palette.getByRole('button', { name: `+ ${label}`, exact: true });
    if ((await entry.count()) === 0) {
      missing.push(`${label} — no palette entry`);
      continue;
    }

    // Back to the screen each time, so elements land beside each other rather than inside
    // whichever container was placed last.
    await page.locator('.layer--artboard', { hasText: 'Home' }).first().click();
    await entry.click();

    // The one just placed is the one selected, and the overlay follows the selection.
    const drawn = page.locator('.artboard [data-loom-id]').last();
    const box = await drawn.boundingBox();
    if (!box || box.width < 1 || box.height < 1) {
      missing.push(`${label} — drew nothing you could see`);
      continue;
    }

    /**
     * Taking up space is not the same as showing something.
     *
     * The bug this spec exists for drew an empty `div` with a minimum height: it had a bounding
     * box, it was selectable, and there was nothing in it. So the check is that the element is a
     * control in its own right, or has something inside it.
     */
    const drew = await drawn.evaluate((node) => {
      const drawsItself = ['IMG', 'INPUT', 'TEXTAREA', 'SELECT', 'CANVAS', 'svg'].includes(
        node.tagName,
      );
      const hasText = (node.textContent ?? '').trim().length > 0;
      return drawsItself || hasText || node.children.length > 0;
    });
    if (!drew) missing.push(`${label} — an empty box`);
  }

  expect(missing).toEqual([]);
});
