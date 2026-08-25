import { expect, test, type Page } from '@playwright/test';
import { firstScreen } from './canvas';

/**
 * Editing a node from its own card (N1, `docs/V1-COMPLETION.md` §10).
 *
 * The card showed a title, a subtitle and its ports, all read-only — every change was a trip to
 * the inspector. For an audience that arrives from Figma that is the wrong default: direct
 * manipulation is the gesture they already have.
 *
 * The awkward part is not the markup, it is that React Flow claims a pointer-down on a node to
 * drag it. A field on a card that cannot be clicked into is worse than no field, so what these
 * assert is the *gesture*, not the element.
 */

const nodesMode = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: 'Nodes' }).click();
  await expect(page.locator('.react-flow')).toBeVisible();
};

/** Put one node on the graph and hand back its id. */
async function addMath(page: Page): Promise<string> {
  await page.getByTestId('palette-fn:math').click();
  const card = page.locator('.nnode').first();
  await expect(card).toBeVisible();

  const testId = await card.locator('input[data-testid^="node-name-"]').getAttribute('data-testid');
  return testId!.replace('node-name-', '');
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!window.sessionStorage.getItem('loom.e2e.cleared')) {
      window.localStorage.clear();
      window.sessionStorage.setItem('loom.e2e.cleared', '1');
    }
  });
  await page.goto('/');
  await firstScreen(page);
  await nodesMode(page);
});

test('a node can be renamed on its own card', async ({ page }) => {
  const id = await addMath(page);
  const name = page.getByTestId(`node-name-${id}`);

  // Empty, showing the default as a placeholder: the node has no name of its own yet, which is a
  // different fact from being called "Math".
  await expect(name).toHaveValue('');

  await name.fill('Order total');
  await expect(name).toHaveValue('Order total');

  // And it survives leaving the field, which is what makes it a rename rather than a draft.
  await page.locator('.react-flow__pane').click({ position: { x: 20, y: 20 } });
  await expect(page.getByTestId(`node-name-${id}`)).toHaveValue('Order total');
});

test('clearing the name puts the default back rather than leaving it blank', async ({ page }) => {
  const id = await addMath(page);
  const name = page.getByTestId(`node-name-${id}`);

  await name.fill('Temporary');
  await name.fill('');

  // A node called nothing is a node you cannot refer to, so the label comes back as the
  // placeholder it started as.
  await expect(name).toHaveValue('');
  await expect(name).toHaveAttribute('placeholder', /Math/);
});

test('the operation can be changed from the card', async ({ page }) => {
  const id = await addMath(page);

  /**
   * The field whose whole value is a choice from a short list. Reading one on the card and having
   * to open a panel to change it is the frustration this closes.
   */
  const pick = page.getByTestId(`node-pick-${id}-operator`);
  await expect(pick).toBeVisible();

  await pick.selectOption('multiply');
  await expect(pick).toHaveValue('multiply');

  // The card's own title follows the configuration while the name is untouched, so the graph says
  // what the node does rather than four nodes all reading "Math". `multiply` is the value; `times`
  // is what a person reads.
  await expect(page.getByTestId(`node-name-${id}`)).toHaveAttribute('placeholder', /times/i);
});

test('clicking into a field places a caret instead of dragging the node', async ({ page }) => {
  const id = await addMath(page);
  const card = page.locator('.nnode').first();

  const before = await card.boundingBox();
  const name = page.getByTestId(`node-name-${id}`);

  // A real press-and-move over the field: React Flow would take this as a drag without `nodrag`.
  await name.click();
  await page.mouse.move(before!.x + 40, before!.y + 8);

  const after = await card.boundingBox();
  expect(Math.round(after!.x)).toBe(Math.round(before!.x));
  expect(Math.round(after!.y)).toBe(Math.round(before!.y));
});
