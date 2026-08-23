import { expect, test, type Page } from '@playwright/test';
import { firstScreen } from './canvas';

/**
 * Connecting to a database directly, and writing a statement against it (D2).
 *
 * The dev server is the only thing that can open a database socket, so *its* answer is what this
 * intercepts — the studio, the panel, the schema table and the query editor are all real, and
 * what stands in for a database is the rows `information_schema` would have returned. That keeps
 * the spec honest about the seam it covers: everything above the socket, nothing below it.
 */

const ROWS = [
  {
    table_name: 'notes',
    column_name: 'id',
    data_type: 'bigint',
    is_nullable: 'NO',
    column_default: "nextval('notes_id_seq')",
    is_primary: true,
  },
  {
    table_name: 'notes',
    column_name: 'title',
    data_type: 'text',
    is_nullable: 'NO',
    column_default: null,
    is_primary: false,
  },
  {
    table_name: 'authors',
    column_name: 'name',
    data_type: 'character varying',
    is_nullable: 'YES',
    column_default: null,
    is_primary: false,
  },
];

const CONNECTION = 'postgresql://app:hunter2@db.example.com:5432/app';

/** What the dev server sent, so a test can say the string never went anywhere else. */
async function stubDatabase(page: Page): Promise<{ bodies: string[] }> {
  const sent = { bodies: [] as string[] };

  await page.route('**/__loom/introspect-sql', async (route) => {
    sent.bodies.push(route.request().postData() ?? '');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, rows: ROWS }),
    });
  });
  await page.route('**/__loom/env', async (route) => {
    if (route.request().method() === 'POST') sent.bodies.push(route.request().postData() ?? '');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, names: [], values: {} }),
    });
  });

  return sent;
}

async function connect(page: Page): Promise<void> {
  await page.getByTestId('rail-data').click();
  await page.getByTestId('connect-supabase').click();
  await page.getByTestId('module-postgres').click();
  await page.getByTestId('connection-string').fill(CONNECTION);
  await page.getByRole('button', { name: 'Connect and read schema' }).click();
  await expect(page.locator('.table-row')).toContainText(['authors', 'notes']);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto('/');
  await firstScreen(page);
});

test('a connection string reads the schema and is never kept in the browser', async ({ page }) => {
  const sent = await stubDatabase(page);
  await connect(page);

  // The schema name travelled as a parameter, and the string went to the dev server.
  expect(sent.bodies.some((body) => body.includes('hunter2'))).toBe(true);
  expect(await page.evaluate(() => JSON.stringify(window.localStorage))).not.toContain('hunter2');

  const stored = await page.evaluate(() =>
    JSON.stringify(JSON.parse(window.localStorage.getItem('loom.project') ?? '{}')),
  );
  expect(stored).not.toContain('hunter2');
});

test('a table opens to show its columns, their types and its key', async ({ page }) => {
  await stubDatabase(page);
  await connect(page);

  await page.getByTestId('table-notes').click();
  const schema = page.getByTestId('schema-notes');
  await expect(schema).toContainText('title');
  await expect(schema).toContainText('text');
  // An identity column the database fills in is marked as both.
  await expect(schema.locator('tr', { hasText: 'id' })).toContainText('key');
  await expect(schema.locator('tr', { hasText: 'id' })).toContainText('auto');
});

test('a statement becomes a step whose inputs are the names it asks for', async ({ page }) => {
  await stubDatabase(page);
  await connect(page);

  // A route to hold it: database work only ever runs on the server.
  await page.getByRole('button', { name: 'Nodes' }).click();
  await page.getByRole('button', { name: '+ API route' }).click();
  await page.getByRole('button', { name: '+ Query (SQL)' }).click();

  const editor = page.getByTestId('query-sql');
  await editor.fill('SELECT * FROM notes WHERE title = :title AND id > :since');
  await editor.blur();

  // The names it asks for are ports on the step, ready to wire.
  await expect(page.locator('.portline')).toContainText(['title', 'since']);

  // And the schema is readable without leaving the statement.
  await page.getByTestId('query-schema-table').selectOption('notes');
  await expect(page.getByTestId('schema-notes')).toContainText('title');
});
