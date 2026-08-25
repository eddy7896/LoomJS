import { expect, test, type Page } from '@playwright/test';
import { firstScreen } from './canvas';

/**
 * Reusable components, through the editor (R1, `docs/V1-COMPLETION.md`).
 *
 * The compiler tests prove a definition emits one React component and three calls to it. They
 * cannot prove a **designer can get there**, and that is a different claim: a feature reachable
 * only by editing the document by hand is a feature nobody has.
 *
 * So this walks the real path — draw a frame, promote it, place it again — clicking what a person
 * would click.
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

/** Draw a frame on the canvas and leave it selected. */
async function drawFrame(page: Page): Promise<void> {
  await page.getByTestId('tool-Frame').click();
  const artboard = page.locator('.artboard').first();
  const box = (await artboard.boundingBox())!;

  await page.mouse.move(box.x + 40, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 220, box.y + 140, { steps: 10 });
  await page.mouse.up();
}

test('a frame becomes a component, and the component can be placed again', async ({ page }) => {
  await drawFrame(page);

  // The promote control appears on a frame that is not the screen itself.
  const promote = page.getByTestId('promote-to-component');
  await expect(promote).toBeVisible();
  await promote.click();

  // Promoting selects the instance that replaced the frame, and the inspector switches to it.
  await expect(page.getByTestId('instance-section')).toBeVisible();

  /**
   * The whole point: it is now in the palette, under the project's own components, and placing it
   * is the same gesture as placing any other element.
   */
  // Whatever the promoted frame was called is what the component is called.
  const name = await page.getByTestId('definition-name').inputValue();
  expect(name.length).toBeGreaterThan(0);

  const header = page.getByTestId('palette-section-components');
  await expect(header).toBeVisible();

  // The header is the toggle; the entries are its siblings inside the section.
  if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click();

  const section = page.locator('.palette__section', { has: header });
  await section.locator('.palette__item').first().click();

  // Two instances of **one** definition — not two copies of a frame.
  await expect(page.locator('.layer', { hasText: name })).toHaveCount(2);
  await expect(
    page.locator('.palette__section', { has: header }).locator('.palette__item'),
  ).toHaveCount(1);
});

test('the promote control is absent where promoting would make no sense', async ({ page }) => {
  // The screen's own root is the screen. Promoting it would leave an artboard whose root is an
  // instance of itself.
  await page.locator('.layer').first().click();
  await expect(page.getByTestId('promote-to-component')).toHaveCount(0);
});

test('a project with no components of its own shows no Components section', async ({ page }) => {
  // Demand-driven, like the rest of the palette: an empty category suggests something is missing.
  await expect(page.getByTestId('palette-section-components')).toHaveCount(0);
});
