import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * M4's gate: connect a Supabase-shaped project, introspect a table, list its rows in the Preview
 * through a reactive pipeline, and write a row back from a form. The backend here is a stub that
 * speaks PostgREST's protocol — the editor, compiler and emitted client are all the real ones.
 */

const STUB = 'http://localhost:5412';

const preview = (page: Page) => page.frameLocator('iframe.preview__frame');

const field = (page: Page, label: string) =>
  page.locator('.field', { has: page.locator('.field__label', { hasText: label }) });

const graphNode = (page: Page, title: string) =>
  page.locator('.react-flow__node', { has: page.locator('.nnode__title', { hasText: title }) });

const handle = (node: Locator, portId: string) => node.locator(`[data-handleid="${portId}"]`);

async function drag(page: Page, from: Locator, to: Locator): Promise<void> {
  await page.locator('.react-flow__controls-fitview').click();
  // Read a box only once both handles are actually on screen: fitView re-lays the canvas, and a
  // box read mid-layout comes back null and fails the drag for reasons unrelated to the product.
  await from.waitFor({ state: 'visible' });
  await to.waitFor({ state: 'visible' });
  const start = (await from.boundingBox())!;
  const end = (await to.boundingBox())!;
  const centre = (b: { x: number; y: number; width: number; height: number }) => ({
    x: b.x + b.width / 2,
    y: b.y + b.height / 2,
  });
  const a = centre(start);
  const b = centre(end);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 8 });
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
}

async function connect(page: Page): Promise<void> {
  await page.getByTestId('connect-supabase').click();
  await field(page, 'Project URL').locator('input').fill(STUB);
  await field(page, 'Anon key').locator('input').fill('stub-anon-key');
  await field(page, 'Service role key').locator('input').fill('stub-service-key');
  await page.getByRole('button', { name: 'Connect and read schema' }).click();
  await expect(page.locator('.table-row')).toContainText('notes');
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto('/');
  await expect(page.locator('.artboard').first()).toBeVisible();
});

test('connecting introspects the schema and shows its tables', async ({ page }) => {
  await connect(page);
  await expect(page.locator('.table-row')).toContainText('3 cols');
  await expect(page.locator('.connection__url')).toContainText('localhost:5412');
});

test('a bad key is refused at the moment of entry', async ({ page }) => {
  await page.getByTestId('connect-supabase').click();
  await field(page, 'Project URL').locator('input').fill('http://localhost:5999');
  await field(page, 'Anon key').locator('input').fill('nope');
  await page.getByRole('button', { name: 'Connect and read schema' }).click();
  await expect(page.locator('.connect-form__error')).toBeVisible();
});

test('rows from the database render in the Preview, and a form writes one back', async ({
  page,
  request,
}) => {
  await connect(page);

  // A List to render the rows, with a Text inside it reading a column.
  await page.getByRole('button', { name: '+ List' }).click();
  await field(page, 'Name').locator('input').fill('Notes');
  await page.getByRole('button', { name: '+ Text', exact: true }).click();
  await field(page, 'Name').locator('input').fill('Row title');

  // A form: a field and a button.
  await page.locator('.layer', { hasText: 'Root' }).first().click();
  await page.getByRole('button', { name: '+ Text field' }).click();
  await field(page, 'Name').locator('input').fill('Title');
  await page.locator('.layer', { hasText: 'Root' }).first().click();
  await page.getByRole('button', { name: '+ Button' }).click();
  await field(page, 'Name').locator('input').fill('Save');
  await field(page, 'Label').locator('input').fill('Save');

  // The read route: an API route whose body reads the table. Nothing triggers it, so it is
  // reactive — it runs on mount.
  await page.getByRole('button', { name: 'Nodes' }).click();
  await page.getByRole('button', { name: '+ API route' }).click();
  await page.getByRole('button', { name: '+ Read rows' }).click();
  await expect(page.locator('.nstep')).toHaveCount(1);

  await drag(
    page,
    handle(graphNode(page, 'API route'), 'pt_result'),
    handle(graphNode(page, 'Notes'), 'pt_items'),
  );

  // The Text inside the List reads a column of the current row.
  await page.getByRole('button', { name: 'Design' }).click();
  await page.locator('.layer', { hasText: 'Row title' }).first().click();
  await field(page, 'Content').locator('select').selectOption('title');

  await expect(preview(page).locator('span', { hasText: 'first note' })).toBeVisible();

  // The write route: a second API route whose body inserts, wired to the form.
  await page.getByRole('button', { name: 'Nodes' }).click();
  await page.locator('.react-flow__pane').click();
  await page.getByRole('button', { name: '+ API route' }).click();
  await page.getByRole('button', { name: '+ Insert row' }).click();

  const write = graphNode(page, 'API route').last();
  await drag(page, handle(graphNode(page, 'Save'), 'pt_click'), handle(write, 'pt_run'));
  await drag(page, handle(graphNode(page, 'Title'), 'pt_value'), handle(write, 'pt_col_title'));

  // Wait for the wiring to reach the running app before using it: the Preview compiles on a
  // debounce, so the button on screen a moment ago has no handler yet.
  await expect(page.locator('.preview__state')).toHaveText('live');
  await expect(preview(page).getByRole('button', { name: 'Save' })).toBeVisible();

  await preview(page).locator('input').fill('written from loom');
  await preview(page).getByRole('button', { name: 'Save' }).click();

  // The row reached the database.
  await expect
    .poll(async () => {
      const response = await request.get(`${STUB}/rest/v1/notes`);
      return (await response.json()) as { title: string }[];
    })
    .toContainEqual(expect.objectContaining({ title: 'written from loom' }));

  // And it shows in the app on the next read. The read pipeline is reactive with no inputs, so
  // it runs on mount — a write does not invalidate it (`docs/specs/binding-trigger-runtime.md`).
  await page.reload();
  await expect(preview(page).locator('span', { hasText: 'written from loom' })).toBeVisible();
});
