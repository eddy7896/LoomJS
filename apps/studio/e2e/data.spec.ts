import { expect, test, type Page } from '@playwright/test';
import { drag, graphNode, handle } from './canvas';

/**
 * M4's gate: connect a Supabase-shaped project, introspect a table, list its rows in the Preview
 * through a reactive pipeline, and write a row back from a form. The backend here is a stub that
 * speaks PostgREST's protocol — the editor, compiler and emitted client are all the real ones.
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
}

test.beforeEach(async ({ page, request }) => {
  // Fresh rows: these specs now edit and delete, so one must not leak into the next.
  await request.get(`${STUB}/__reset`);
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

test('connecting introspects the schema and shows its tables', async ({ page }) => {
  await connect(page);
  await expect(page.locator('.table-row')).toContainText('3 cols');
  await expect(page.locator('.connection__url')).toContainText('localhost:5412');
});

test('a bad key is refused at the moment of entry', async ({ page }) => {
  await page.getByTestId('rail-data').click();
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
  // Back to the elements column; connecting is a detour, not a destination.
  await page.getByTestId('rail-design').click();

  // A List to render the rows, with a Text inside it reading a column.
  await page.getByRole('button', { name: '+ List' }).click();
  await field(page, 'Name').locator('input').fill('Notes');
  await page.getByRole('button', { name: '+ Text', exact: true }).click();
  await field(page, 'Name').locator('input').fill('Row title');

  // A form: a field and a button.
  await page.locator('.layer--artboard', { hasText: 'Home' }).first().click();
  await page.getByRole('button', { name: '+ Text field' }).click();
  await field(page, 'Name').locator('input').fill('Title');
  await page.locator('.layer--artboard', { hasText: 'Home' }).first().click();
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

  // And it shows in the app **without a reload**. Until P4 the read ran on mount and never again,
  // so a row you had just added was invisible until you refreshed; a write now makes a read of the
  // same table stale (`docs/specs/binding-trigger-runtime.md`).
  await expect(preview(page).locator('span', { hasText: 'written from loom' })).toBeVisible();
});

test('a row can be edited and removed, and the list keeps up', async ({ page, request }) => {
  await connect(page);
  await page.getByTestId('rail-design').click();

  // The list, and a Text in it reading each row's title.
  await page.locator('.layer--artboard', { hasText: 'Home' }).first().click();
  await page.getByRole('button', { name: '+ List', exact: true }).click();
  await field(page, 'Name').locator('input').fill('Notes');
  await page.getByRole('button', { name: '+ Text', exact: true }).click();
  await field(page, 'Name').locator('input').fill('Row title');

  // A field for the new title, and two buttons.
  for (const [button, name] of [
    ['+ Number field', 'Which'],
    ['+ Text field', 'NewTitle'],
    ['+ Button', 'Rename'],
    ['+ Button', 'Remove'],
  ] as const) {
    await page.locator('.layer--artboard', { hasText: 'Home' }).first().click();
    await page.getByRole('button', { name: button, exact: true }).click();
    await field(page, 'Name').locator('input').fill(name);
    if (button === '+ Button') await field(page, 'Label').locator('input').fill(name);
  }

  await page.getByTestId('rail-nodes').click();

  // Read.
  await page.getByRole('button', { name: '+ API route' }).click();
  await page.getByRole('button', { name: '+ Read rows' }).click();
  await drag(
    page,
    handle(graphNode(page, 'API route'), 'pt_result'),
    handle(graphNode(page, 'Notes'), 'pt_items'),
  );

  // Update.
  await page.locator('.react-flow__pane').click();
  await page.getByRole('button', { name: '+ API route' }).click();
  await page.getByRole('button', { name: '+ Update row' }).click();
  const edit = graphNode(page, 'API route').last();
  await drag(page, handle(graphNode(page, 'Rename'), 'pt_click'), handle(edit, 'pt_run'));
  await drag(page, handle(graphNode(page, 'Which'), 'pt_value'), handle(edit, 'pt_id'));
  await drag(page, handle(graphNode(page, 'NewTitle'), 'pt_value'), handle(edit, 'pt_col_title'));

  // Delete.
  await page.locator('.react-flow__pane').click();
  await page.getByRole('button', { name: '+ API route' }).click();
  await page.getByRole('button', { name: '+ Delete row' }).click();
  const remove = graphNode(page, 'API route').last();
  await drag(page, handle(graphNode(page, 'Remove'), 'pt_click'), handle(remove, 'pt_run'));
  await drag(page, handle(graphNode(page, 'Which'), 'pt_value'), handle(remove, 'pt_id'));

  await page.getByRole('button', { name: 'Design' }).click();
  await page.locator('.layer', { hasText: 'Row title' }).first().click();
  await field(page, 'Content').locator('select').selectOption('title');

  await expect(page.locator('.preview__state')).toHaveText('live');
  await expect(preview(page).locator('span', { hasText: 'first note' })).toBeVisible();

  // Edit row 1. The identity comes from the primary key, which the designer never had to name.
  await preview(page).locator('input[type="number"]').fill('1');
  await preview(page).locator('input[type="text"]').fill('renamed by loom');
  await preview(page).getByRole('button', { name: 'Rename' }).click();

  await expect(preview(page).locator('span', { hasText: 'renamed by loom' })).toBeVisible();
  await expect
    .poll(async () => {
      const response = await request.get(`${STUB}/rest/v1/notes`);
      return (await response.json()) as { title: string }[];
    })
    .toContainEqual(expect.objectContaining({ title: 'renamed by loom' }));

  // Remove it. The list empties itself, again with no reload.
  await preview(page).getByRole('button', { name: 'Remove' }).click();
  await expect(preview(page).locator('span', { hasText: 'renamed by loom' })).toHaveCount(0);
});
