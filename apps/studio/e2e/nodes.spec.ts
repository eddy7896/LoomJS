import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * M3's gate: a button in the Preview calls the emitted serverless function and shows the result.
 * Everything here goes through the real editor, the real compiler, and the real dev server that
 * mounts the emitted `api/*.ts` — no stubs anywhere in the path.
 */

const preview = (page: Page) => page.frameLocator('iframe.preview__frame');

const field = (page: Page, label: string) =>
  page.locator('.field', { has: page.locator('.field__label', { hasText: label }) });

/** A node on the Nodes canvas, found by its title. */
const graphNode = (page: Page, title: string) =>
  page.locator('.react-flow__node', { has: page.locator('.nnode__title', { hasText: title }) });

const handle = (node: Locator, portId: string) => node.locator(`[data-handleid="${portId}"]`);

/**
 * Wire two ports. The canvas re-renders while a connection is in flight, so this drives the
 * pointer by coordinates rather than by hovering locators whose boxes are still settling.
 */
async function drag(page: Page, from: Locator, to: Locator): Promise<void> {
  // Bring the whole graph into view first, the way a user would before reaching for a port.
  await page.locator('.react-flow__controls-fitview').click();

  const start = (await from.boundingBox())!;
  const end = (await to.boundingBox())!;
  const centre = (box: { x: number; y: number; width: number; height: number }) => ({
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  });

  const a = centre(start);
  const b = centre(end);

  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 8 });
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.artboard').first()).toBeVisible();
});

test('a wired graph calls the emitted function and shows its result', async ({ page }) => {
  // 1. The UI: an input, a button, and somewhere to put the answer.
  await page.getByRole('button', { name: '+ Text field' }).click();
  await field(page, 'Name').locator('input').fill('Input');

  await page.locator('.layer', { hasText: 'Root' }).first().click();
  await page.getByRole('button', { name: '+ Button' }).click();
  await field(page, 'Name').locator('input').fill('Shout');
  await field(page, 'Label').locator('input').fill('Shout');

  await page.locator('.layer', { hasText: 'Root' }).first().click();
  await page.getByRole('button', { name: '+ Text', exact: true }).click();
  await field(page, 'Name').locator('input').fill('Result');

  // 2. The graph: an API route with an uppercase step inside its body.
  await page.getByRole('button', { name: 'Nodes' }).click();
  await page.getByRole('button', { name: '+ API route' }).click();
  await page.getByRole('button', { name: '+ Compute' }).click();
  await expect(page.locator('.nstep')).toHaveCount(1);

  // 3. Wire it: the button fires it, the field feeds it, the text reads it.
  const api = graphNode(page, 'API route');
  await drag(page, handle(graphNode(page, 'Shout'), 'pt_click'), handle(api, 'pt_run'));
  await drag(page, handle(graphNode(page, 'Input'), 'pt_value'), handle(api, 'pt_input'));
  await drag(page, handle(api, 'pt_result'), handle(graphNode(page, 'Result'), 'pt_content'));
  await expect(page.locator('.react-flow__edge')).toHaveCount(3);

  // 4. Run it in the Preview: the emitted server function does the work.
  await expect(page.locator('.preview__state')).toHaveText('live');
  await preview(page).locator('input').fill('quiet words');
  await preview(page).getByRole('button', { name: 'Shout' }).click();

  await expect(preview(page).locator('span', { hasText: 'QUIET WORDS' })).toBeVisible();
});

test('an illegal wire is refused at the gesture (Problems tier)', async ({ page }) => {
  await page.locator('.layer', { hasText: 'Root' }).first().click();
  await page.getByRole('button', { name: '+ Button' }).click();
  await field(page, 'Name').locator('input').fill('Go');

  await page.getByRole('button', { name: 'Nodes' }).click();
  await page.getByRole('button', { name: '+ API route' }).click();

  // A trigger port cannot feed a data port.
  await drag(
    page,
    handle(graphNode(page, 'Go'), 'pt_click'),
    handle(graphNode(page, 'API route'), 'pt_input'),
  );

  await expect(page.locator('.problem')).toContainText('trigger port to a data port');
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
});

test('changing a Compute operation retypes its ports', async ({ page }) => {
  await page.getByRole('button', { name: 'Nodes' }).click();
  await page.getByRole('button', { name: '+ API route' }).click();
  await page.getByRole('button', { name: '+ Compute' }).click();

  await expect(page.locator('.portline', { hasText: 'input' })).toContainText('text');
  await field(page, 'Operation').locator('select').selectOption('double');
  await expect(page.locator('.portline', { hasText: 'input' })).toContainText('number');
});
