import { expect, test, type Page } from '@playwright/test';
import { drag, graphNode, handle } from './canvas';

/**
 * The calculator: two number fields, two operation buttons, **one** answer.
 *
 * This is the shape that exposed the missing merge point. Every property binds exactly one port,
 * so before screen buckets the only way to show two operations was two Texts — one of them always
 * stale. The proof is the running app: press one button, then the other, and watch the same span
 * change (`docs/specs/binding-trigger-runtime.md`).
 */

const preview = (page: Page) => page.frameLocator('iframe.preview__frame');

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
  await expect(page.locator('.artboard').first()).toBeVisible();
});

async function place(page: Page, button: string, name: string, label?: string): Promise<void> {
  await page.locator('.layer', { hasText: 'Root' }).first().click();
  await page.getByRole('button', { name: button, exact: true }).click();
  await field(page, 'Name').locator('input').fill(name);
  if (label !== undefined) await field(page, 'Label').locator('input').fill(label);
}

test('two operations answer into one display', async ({ page }) => {
  // 1. The UI a person draws: two numbers, two operations, one place for the answer.
  await place(page, '+ Number field', 'Left');
  await place(page, '+ Number field', 'Right');
  await place(page, '+ Button', 'Add', 'Add');
  await place(page, '+ Button', 'Subtract', 'Subtract');
  await place(page, '+ Text', 'Display');

  await page.getByRole('button', { name: 'Nodes' }).click();

  // 2. The bucket both answers land in. Naming it is what tells the two Math nodes apart on the
  //    canvas from the thing they both feed.
  await page.getByRole('button', { name: '+ Variable' }).click();
  await field(page, 'Name').locator('input').fill('total');
  const bucket = graphNode(page, 'total');

  // 3. One Math per operation. A configured node names itself after its operation, so these two
  //    are distinguishable on the canvas rather than two boxes both reading "Math".
  await page.getByRole('button', { name: '+ Math' }).click();
  await field(page, 'Operation').locator('select').selectOption('add');
  const plus = graphNode(page, 'plus');

  await page.getByRole('button', { name: '+ Math' }).click();
  await field(page, 'Operation').locator('select').selectOption('subtract');
  const minus = graphNode(page, 'minus');

  const left = graphNode(page, 'Left');
  const right = graphNode(page, 'Right');

  for (const math of [plus, minus]) {
    await drag(page, handle(left, 'pt_value'), handle(math, 'pt_in_0'));
    await drag(page, handle(right, 'pt_value'), handle(math, 'pt_in_1'));
    // Both results into the same port. This is the wire the editor used to refuse by replacement.
    await drag(page, handle(math, 'pt_result'), handle(bucket, 'pt_set'));
  }

  await drag(page, handle(graphNode(page, 'Add'), 'pt_click'), handle(plus, 'pt_run'));
  await drag(page, handle(graphNode(page, 'Subtract'), 'pt_click'), handle(minus, 'pt_run'));
  await drag(page, handle(bucket, 'pt_value'), handle(graphNode(page, 'Display'), 'pt_content'));

  // Nine wires: the second write did not replace the first.
  await expect(page.locator('.react-flow__edge')).toHaveCount(9);

  // 4. Run it. One span, two operations.
  await expect(page.locator('.preview__state')).toHaveText('live');
  const numbers = preview(page).locator('input[type="number"]');
  await numbers.nth(0).fill('7');
  await numbers.nth(1).fill('3');

  await preview(page).getByRole('button', { name: 'Add' }).click();
  await expect(preview(page).locator('span', { hasText: '10' })).toBeVisible();

  await preview(page).getByRole('button', { name: 'Subtract' }).click();
  await expect(preview(page).locator('span', { hasText: '4' })).toBeVisible();

  // And back again — the display is the bucket, not one operation's held value.
  await preview(page).getByRole('button', { name: 'Add' }).click();
  await expect(preview(page).locator('span', { hasText: '10' })).toBeVisible();
});

test('a bucket refuses a writer that recomputes on its own, and says how to fix it', async ({
  page,
}) => {
  await place(page, '+ Number field', 'Left');
  await place(page, '+ Text', 'Display');

  await page.getByRole('button', { name: 'Nodes' }).click();
  await page.getByRole('button', { name: '+ Variable' }).click();
  const bucket = graphNode(page, 'value');

  await page.getByRole('button', { name: '+ Compute' }).click();
  await field(page, 'Operation').locator('select').selectOption('double');
  const compute = graphNode(page, 'double');

  await drag(page, handle(graphNode(page, 'Left'), 'pt_value'), handle(compute, 'pt_input'));
  await drag(page, handle(compute, 'pt_result'), handle(bucket, 'pt_set'));
  await drag(page, handle(bucket, 'pt_value'), handle(graphNode(page, 'Display'), 'pt_content'));

  // Nothing fires the Compute, so two writers would race on every keystroke. The Build tier says
  // so, and says which wire fixes it.
  await expect(page.locator('.preview__error, .problem')).toContainText('recomputes on its own');
});
