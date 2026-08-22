import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Shared Nodes-canvas helpers.
 *
 * Wiring is driven by raw pointer coordinates rather than `dragTo`: React Flow starts a
 * connection from a `mousedown` on a handle and follows the pointer, and a synthesised drag skips
 * the intermediate moves it needs. At fit-zoom the handles of one node sit a few pixels apart, so
 * a single attempt occasionally lands on the neighbouring port — the drag is therefore *verified*
 * (the edge count has to rise) and retried rather than assumed.
 */

export const graphNode = (page: Page, title: string): Locator =>
  page.locator('.react-flow__node', { has: page.locator('.nnode__title', { hasText: title }) });

export const handle = (node: Locator, portId: string): Locator =>
  node.locator(`[data-handleid="${portId}"]`);

const centre = (box: { x: number; y: number; width: number; height: number }) => ({
  x: box.x + box.width / 2,
  y: box.y + box.height / 2,
});

async function attempt(page: Page, from: Locator, to: Locator): Promise<void> {
  await page.locator('.react-flow__controls-fitview').click();
  // Read a box only once both handles are on screen: fitView re-lays the canvas, and a box read
  // mid-layout comes back null.
  await from.waitFor({ state: 'visible' });
  await to.waitFor({ state: 'visible' });

  const a = centre((await from.boundingBox())!);
  const b = centre((await to.boundingBox())!);

  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 8 });
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
}

/**
 * Wire two handles, and prove the wire exists before moving on.
 *
 * Pass `{ expectWire: false }` when the wire *should* be refused — a Problems-tier test drags an
 * illegal connection on purpose, and retrying it would be retrying the thing under test.
 */
export async function drag(
  page: Page,
  from: Locator,
  to: Locator,
  { expectWire = true }: { expectWire?: boolean } = {},
): Promise<void> {
  const edges = page.locator('.react-flow__edge');
  const before = await edges.count();

  if (!expectWire) {
    await attempt(page, from, to);
    return;
  }

  for (let tries = 0; tries < 3; tries += 1) {
    await attempt(page, from, to);
    if ((await edges.count()) > before) return;
  }

  await expect(edges).toHaveCount(before + 1);
}

/**
 * Open the Preview if it is folded.
 *
 * The Preview window folds to its bar in Nodes mode, because a floating window over the graph
 * eats the drop that finishes a wire. A spec that wants to *use* the running app there opens it
 * first, exactly as a person would.
 */
export async function openPreview(page: Page): Promise<void> {
  // Ask the window whether it is folded, rather than whether the frame is there yet: an absent
  // frame also means "the first build has not been written", and folding an already-open window
  // is a wait for something that will never appear.
  const window_ = page.getByTestId('preview-window');
  if (((await window_.getAttribute('class')) ?? '').includes('is-collapsed')) {
    await page.getByTestId('preview-collapse').click();
  }
  await expect(page.locator('iframe.preview__frame')).toBeVisible();
}
