import { expect, test, type Page } from '@playwright/test';
import { drag, graphNode, handle, nameInput, openPreview } from './canvas';

/**
 * P3's done-when: a submit button runs a pipeline, clears the form, shows a confirmation, and
 * navigates — in that order, in the Preview (`docs/specs/actions.md`).
 *
 * The order is the claim, so the assertions check *state after each step* rather than presence:
 * a cleared field and a visible toast on the screen you navigated to would mean nothing.
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
  await page.locator('.layer--artboard', { hasText: 'Home' }).first().click();
  await page.getByRole('button', { name: button, exact: true }).click();
  await nameInput(page).fill(name);
  if (label !== undefined) await field(page, 'Label').locator('input').fill(label);
}

test('a click can do four things, in order', async ({ page }) => {
  // A field, a button, and a second screen to land on.
  await place(page, '+ Text field', 'Title');
  await place(page, '+ Button', 'Save', 'Save');
  await page.getByRole('button', { name: '+ Screen' }).click();

  // Back to Home, and wire the button to a pipeline that uppercases what was typed.
  await page.locator('.layer', { hasText: 'Home' }).first().click();
  await page.getByRole('button', { name: 'Nodes' }).click();
  await page.getByRole('button', { name: '+ API route' }).click();
  await page.getByRole('button', { name: '+ Compute' }).click();

  const api = graphNode(page, 'API route');
  await drag(page, handle(graphNode(page, 'Save'), 'pt_click'), handle(api, 'pt_run'));
  await drag(page, handle(graphNode(page, 'Title'), 'pt_value'), handle(api, 'pt_input'));

  // The wire appended step 1. The rest are added in the Inspector, in order.
  await page.getByRole('button', { name: 'Design' }).click();
  await page.locator('.layer', { hasText: 'Save' }).first().click();
  await expect(page.getByTestId('action-0-kind')).toContainText('1. Run');

  await page.getByTestId('add-action').selectOption('clearField');
  await page.getByTestId('add-action').selectOption('message');
  await page.getByTestId('action-2-text').fill('Saved');
  await page.getByTestId('add-action').selectOption('navigate');

  await expect(page.getByTestId('action-1-kind')).toContainText('2. Clear a field');
  await expect(page.getByTestId('action-2-kind')).toContainText('3. Show a message');
  await expect(page.getByTestId('action-3-kind')).toContainText('4. Go to screen');

  // Run it for real.
  await openPreview(page);
  await expect(page.locator('.preview__state')).toHaveText('live');
  await preview(page).locator('input[type="text"]').fill('hello');
  await preview(page).getByRole('button', { name: 'Save' }).click();

  // The confirmation appears, and we landed on the other screen — which only happens after the
  // request came back, because the run is awaited.
  await expect(preview(page).locator('[role="status"]')).toHaveText('Saved');
  await expect(preview(page).locator('input[type="text"]')).toHaveCount(0);
});

test('a step can be reordered, and the order is what runs', async ({ page }) => {
  await place(page, '+ Text field', 'Title');
  await place(page, '+ Button', 'Go', 'Go');

  await page.locator('.layer', { hasText: 'Go' }).first().click();
  await page.getByTestId('add-action').selectOption('setField');
  await page.getByTestId('action-0-value').fill('second');
  await page.getByTestId('add-action').selectOption('clearField');

  // Set-then-clear leaves the field empty.
  await openPreview(page);
  await expect(page.locator('.preview__state')).toHaveText('live');
  await preview(page).getByRole('button', { name: 'Go' }).click();
  await expect(preview(page).locator('input[type="text"]')).toHaveValue('');

  // Clear-then-set leaves the value. Same two steps, different order, different app.
  await page.getByTestId('action-1-up').click();
  await expect(page.getByTestId('action-0-kind')).toContainText('1. Clear a field');
  await openPreview(page);
  await expect(page.locator('.preview__state')).toHaveText('live');
  await preview(page).getByRole('button', { name: 'Go' }).click();
  await expect(preview(page).locator('input[type="text"]')).toHaveValue('second');
});

test('a step runs only when its condition holds', async ({ page }) => {
  await place(page, '+ Checkbox', 'Agree', 'Agree');
  await place(page, '+ Text field', 'Title');
  await place(page, '+ Button', 'Go', 'Go');

  await page.locator('.layer', { hasText: 'Go' }).first().click();
  await page.getByTestId('add-action').selectOption('setField');
  await page.getByTestId('action-0-field').selectOption({ label: 'Title' });
  await page.getByTestId('action-0-value').fill('done');
  await page.getByTestId('action-0-when').selectOption({ label: 'Agree is checked' });

  await openPreview(page);
  await expect(page.locator('.preview__state')).toHaveText('live');

  await preview(page).getByRole('button', { name: 'Go' }).click();
  await expect(preview(page).locator('input[type="text"]')).toHaveValue('');

  await preview(page).locator('input[type="checkbox"]').check();
  await preview(page).getByRole('button', { name: 'Go' }).click();
  await expect(preview(page).locator('input[type="text"]')).toHaveValue('done');
});

test('removing a step removes its wire, and the rest of the sequence survives', async ({ page }) => {
  await place(page, '+ Text field', 'Title');
  await place(page, '+ Button', 'Save', 'Save');

  await page.getByRole('button', { name: 'Nodes' }).click();
  await page.getByRole('button', { name: '+ API route' }).click();
  const api = graphNode(page, 'API route');
  await drag(page, handle(graphNode(page, 'Save'), 'pt_click'), handle(api, 'pt_run'));
  await drag(page, handle(graphNode(page, 'Title'), 'pt_value'), handle(api, 'pt_input'));
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);

  await page.getByRole('button', { name: 'Design' }).click();
  await page.locator('.layer', { hasText: 'Save' }).first().click();
  await page.getByTestId('add-action').selectOption('message');

  await page.getByTestId('action-0-remove').click();

  // The message step is still there; the trigger wire is gone with its step.
  await expect(page.getByTestId('action-0-kind')).toContainText('1. Show a message');
  await page.getByRole('button', { name: 'Nodes' }).click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
});
