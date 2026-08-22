import { expect, test, type Page } from '@playwright/test';
import { drag, graphNode, handle, openPreview } from './canvas';

/**
 * M5's gate: draw a form, ask for a backend, and get a working one — Validate, a POST route, a
 * Supabase insert, and a screen-bucket write — materialised as AUTO, accepted, and then run for
 * real in the Preview. The database is the PostgREST stub; everything else is the real thing.
 */

const STUB = 'http://localhost:5412';

const preview = (page: Page) => page.frameLocator('iframe.preview__frame');

const field = (page: Page, label: string) =>
  page.locator('.field', { has: page.locator('.field__label', { hasText: label }) });


async function connect(page: Page): Promise<void> {
  // Connections live behind the Data section of the icon rail (S0).
  await page.getByTestId('rail-data').click();
  await page.getByTestId('connect-supabase').click();
  await field(page, 'Project URL').locator('input').fill(STUB);
  await field(page, 'Anon key').locator('input').fill('stub-anon-key');
  await field(page, 'Service role key').locator('input').fill('stub-service-key');
  await page.getByRole('button', { name: 'Connect and read schema' }).click();
  await expect(page.locator('.table-row')).toContainText('notes');
  // Back to the elements column; connecting is a detour, not a destination.
  await page.getByTestId('rail-design').click();
}

const rows = async (request: { get: (url: string) => Promise<{ json: () => Promise<unknown> }> }) =>
  (await (await request.get(`${STUB}/rest/v1/notes`)).json()) as { title: string }[];

/** Draw the form the designer would draw: a frame, two fields named after columns, one button. */
async function drawForm(page: Page): Promise<void> {
  await page.locator('.layer--artboard', { hasText: 'Home' }).first().click();
  await page.getByRole('button', { name: '+ Frame' }).click();
  await field(page, 'Name').locator('input').fill('New note');

  await page.getByRole('button', { name: '+ Text field' }).click();
  await field(page, 'Name').locator('input').fill('Title');

  await page.locator('.layer', { hasText: 'New note' }).first().click();
  await page.getByRole('button', { name: '+ Text field' }).click();
  await field(page, 'Name').locator('input').fill('Body');

  await page.locator('.layer', { hasText: 'New note' }).first().click();
  await page.getByRole('button', { name: '+ Button' }).click();
  await field(page, 'Name').locator('input').fill('Save');
  await field(page, 'Label').locator('input').fill('Save');
}

test.beforeEach(async ({ page }) => {
  // Clear once per test, not per navigation: an init script runs again on reload, and two of
  // these tests reload on purpose. sessionStorage survives the reload; the flag makes the clear
  // happen exactly once.
  await page.addInitScript(() => {
    if (!window.sessionStorage.getItem('loom.e2e.cleared')) {
      window.localStorage.clear();
      window.sessionStorage.setItem('loom.e2e.cleared', '1');
    }
  });
  await page.goto('/');
  await expect(page.locator('.artboard').first()).toBeVisible();
});

test('the inspector explains what it would build, and why it cannot', async ({ page }) => {
  await page.locator('.layer--artboard', { hasText: 'Home' }).first().click();
  await page.getByRole('button', { name: '+ Frame' }).click();
  await expect(page.getByTestId('auto-backend')).toContainText('no input fields');

  await page.getByRole('button', { name: '+ Text field' }).click();
  await field(page, 'Name').locator('input').fill('Title');
  await page.locator('.layer', { hasText: 'Frame' }).first().click();
  await expect(page.getByTestId('auto-backend')).toContainText('Add a button to submit');

  await page.getByRole('button', { name: '+ Button' }).click();
  await page.locator('.layer', { hasText: 'Frame' }).first().click();
  await expect(page.getByTestId('auto-backend')).toContainText('Connect a database first');
});

test('a form and a click become a working backend', async ({ page, request }) => {
  await connect(page);
  await drawForm(page);

  // Somewhere to show what came back, so the screen bucket is visibly read.
  await page.locator('.layer--artboard', { hasText: 'Home' }).first().click();
  await page.getByRole('button', { name: '+ Text', exact: true }).click();
  await field(page, 'Name').locator('input').fill('Saved');

  await page.locator('.layer', { hasText: 'New note' }).first().click();
  await expect(page.getByTestId('auto-backend')).toContainText('notes');
  await expect(page.getByTestId('auto-backend')).toContainText('title, body');

  await page.getByTestId('generate-backend').click();

  // It lands the designer on the generated route, in Nodes mode, marked as loom's work.
  await expect(page.locator('.nnode.is-auto')).toHaveCount(2);
  await expect(page.getByTestId('auto-controls')).toContainText('proposed');
  const route = graphNode(page, 'Create notes');
  await expect(route.locator('.nstep')).toHaveCount(2);
  await expect(route.locator('.nstep').first()).toContainText('Validate');
  await expect(route.locator('.nstep').last()).toContainText('Insert notes');

  await page.getByTestId('accept-auto').click();
  await expect(page.getByTestId('auto-controls')).toContainText('accepted');

  // Read the screen bucket from the artboard: the row the insert returned. The drag helper
  // retries, so the Preview can stay open — toggling it remounts the iframe and races the
  // assertions that follow.
  await drag(
    page,
    handle(graphNode(page, 'New notes'), 'pt_value'),
    handle(graphNode(page, 'Saved'), 'pt_content'),
  );
  await expect(page.locator('.react-flow__edge')).toHaveCount(5);

  await openPreview(page);
  await expect(page.locator('.preview__state')).toHaveText('live');
  await expect(preview(page).getByRole('button', { name: 'Save' })).toBeVisible();

  const before = (await rows(request)).length;

  await preview(page).locator('input').first().fill('written by inference');
  await preview(page).locator('input').nth(1).fill('with a body');
  await preview(page).getByRole('button', { name: 'Save' }).click();

  await expect
    .poll(async () => await rows(request))
    .toContainEqual(expect.objectContaining({ title: 'written by inference', body: 'with a body' }));

  // The inserted row came back and landed in screen state, which the Text reads.
  await expect(preview(page).locator('span', { hasText: 'written by inference' })).toBeVisible();

  // The required check runs on the server, so an empty title never reaches the table.
  await preview(page).locator('input').first().fill('');
  await preview(page).getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(1500);
  expect(await rows(request)).toHaveLength(before + 1);
});

test('regenerating replaces the proposal instead of stacking another', async ({ page }) => {
  await connect(page);
  await drawForm(page);

  await page.locator('.layer', { hasText: 'New note' }).first().click();
  await page.getByTestId('generate-backend').click();
  await expect(graphNode(page, 'Create notes')).toHaveCount(1);

  await page.getByRole('button', { name: 'Design' }).click();
  await page.locator('.layer', { hasText: 'New note' }).first().click();
  await page.getByTestId('generate-backend').click();
  await expect(graphNode(page, 'Create notes')).toHaveCount(1);
  await expect(page.getByTestId('auto-controls')).toContainText('proposed');
});

test('detaching leaves the pipeline in the designer’s hands', async ({ page }) => {
  await connect(page);
  await drawForm(page);

  await page.locator('.layer', { hasText: 'New note' }).first().click();
  await page.getByTestId('generate-backend').click();
  await page.getByTestId('detach-auto').click();

  // The nodes stay; only the mark goes.
  await expect(graphNode(page, 'Create notes')).toHaveCount(1);
  await expect(page.locator('.nnode.is-auto')).toHaveCount(0);
  await expect(page.getByTestId('auto-controls')).toHaveCount(0);
});
