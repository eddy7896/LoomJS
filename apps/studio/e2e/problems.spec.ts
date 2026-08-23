import { expect, test, type Page } from '@playwright/test';
import { drag, graphNode, handle, nameInput } from './canvas';

/**
 * P2's gate: three distinct problems appear in the panel, and clicking one selects the offending
 * node or component (`docs/specs/problems.md`).
 *
 * Everything here is provoked by drawing a half-finished graph — which is the point. The panel
 * exists for work in progress, so the test builds work in progress rather than a broken document.
 */

const field = (page: Page, label: string) =>
  page.locator('.field', { has: page.locator('.field__label', { hasText: label }) });

const rows = (page: Page) => page.locator('.problem-row');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!window.sessionStorage.getItem('loom.e2e.cleared')) {
      window.localStorage.clear();
      window.sessionStorage.setItem('loom.e2e.cleared', '1');
    }
  });
  await page.goto('/');
  await expect(page.locator('.artboard').first()).toBeVisible();
});

test('an empty project has nothing to report', async ({ page }) => {
  await expect(page.getByTestId('problems-count')).toHaveText('none');
  await expect(page.getByTestId('problems')).toContainText('Nothing is wrong');
});

test('three distinct problems appear, and clicking one selects the offender', async ({ page }) => {
  // A number field and a Text, so there is something real to wire.
  await page.locator('.layer--artboard', { hasText: 'Home' }).first().click();
  await page.getByRole('button', { name: '+ Number field', exact: true }).click();
  await nameInput(page).fill('Left');

  await page.locator('.layer--artboard', { hasText: 'Home' }).first().click();
  await page.getByRole('button', { name: '+ Text', exact: true }).click();
  await nameInput(page).fill('Display');

  await page.getByRole('button', { name: 'Nodes' }).click();

  // 1. A node dropped and left alone.
  await page.getByRole('button', { name: '+ Compute' }).click();
  await expect(page.getByTestId('problem-orphan-node')).toBeVisible();

  // 2. A variable read by the Text but written by nothing.
  await page.getByRole('button', { name: '+ Variable' }).click();
  const variable = graphNode(page, 'value');
  await drag(page, handle(variable, 'pt_value'), handle(graphNode(page, 'Display'), 'pt_content'));
  await expect(page.getByTestId('problem-variable-never-written')).toBeVisible();

  // 3. A Math node with one operand wired and one empty.
  await page.getByRole('button', { name: '+ Math' }).click();
  const math = graphNode(page, 'plus');
  await drag(page, handle(graphNode(page, 'Left'), 'pt_value'), handle(math, 'pt_in_0'));
  await expect(page.getByTestId('problem-unwired-input')).toBeVisible();

  // Three distinct kinds at once — the done-when.
  const codes = await rows(page).evaluateAll((nodes) =>
    Array.from(new Set(nodes.map((node) => node.getAttribute('data-code')))),
  );
  expect(codes.length).toBeGreaterThanOrEqual(3);

  // Errors count in the header, warnings do not shout.
  await expect(page.getByTestId('problems-count')).not.toHaveText('none');

  // Clicking selects the offending node.
  await page.getByTestId('problem-variable-never-written').click();
  // React Flow marks the outer element; the node body carries the editor's own selection class.
  await expect(variable.locator('.nnode')).toHaveClass(/is-selected/);
});

test('a problem stops being listed the moment it is fixed', async ({ page }) => {
  await page.locator('.layer--artboard', { hasText: 'Home' }).first().click();
  await page.getByRole('button', { name: '+ Text', exact: true }).click();
  await nameInput(page).fill('Display');

  await page.getByRole('button', { name: 'Nodes' }).click();
  await page.getByRole('button', { name: '+ Variable' }).click();
  const variable = graphNode(page, 'value');
  await drag(page, handle(variable, 'pt_value'), handle(graphNode(page, 'Display'), 'pt_content'));

  await expect(page.getByTestId('problem-variable-never-written')).toBeVisible();

  // The panel holds state, not history: undoing the wire removes the row rather than leaving it
  // to be cleared.
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('problem-variable-never-written')).toHaveCount(0);
});

test('clicking a component row switches to Design mode and selects it', async ({ page }) => {
  // A button that fires a Compute nothing reads: the compiler refuses it, and the row it produces
  // points at the button rather than the node.
  await page.locator('.layer--artboard', { hasText: 'Home' }).first().click();
  await page.getByRole('button', { name: '+ Number field', exact: true }).click();
  await nameInput(page).fill('Left');

  await page.locator('.layer--artboard', { hasText: 'Home' }).first().click();
  await page.getByRole('button', { name: '+ Button' }).click();
  await nameInput(page).fill('Go');
  await field(page, 'Label').locator('input').fill('Go');

  await page.getByRole('button', { name: 'Nodes' }).click();
  await page.getByRole('button', { name: '+ Compute' }).click();
  await field(page, 'Operation').locator('select').selectOption('double');

  const compute = graphNode(page, 'double');
  await drag(page, handle(graphNode(page, 'Left'), 'pt_value'), handle(compute, 'pt_input'));
  await drag(page, handle(graphNode(page, 'Go'), 'pt_click'), handle(compute, 'pt_run'));

  const build = page.getByTestId('problem-build');
  await expect(build).toBeVisible();
  await expect(build).toContainText('nothing on this screen shows or keeps its result');

  await build.click();
  await expect(page.locator('.layer.is-selected', { hasText: 'Go' })).toBeVisible();
});
