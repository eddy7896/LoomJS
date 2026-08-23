import { expect, test, type Page } from '@playwright/test';
import { firstScreen } from './canvas';

/**
 * Connecting a project to data: a database directly, and a document store (D2, D4).
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

/**
 * The document store, through the same panel.
 *
 * Firestore is the connector that is genuinely a different model, so what this checks is the
 * mapping showing up as a designer would meet it: collections listed as tables, the document id
 * as the key, and the comparisons Firestore cannot make simply absent from the menu.
 */
const KEY = JSON.stringify({
  type: 'service_account',
  project_id: 'demo-app',
  client_email: 'x@demo-app.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nsecretsecret\n-----END PRIVATE KEY-----\n',
});

async function stubFirestore(page: Page): Promise<void> {
  await page.route('**/__loom/introspect-firestore', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        projectId: 'demo-app',
        docs: [
          { collection: 'notes', id: 'a', fields: { title: 'One', weight: 2 } },
          { collection: 'notes', id: 'b', fields: { done: true } },
        ],
      }),
    });
  });
  await page.route('**/__loom/env', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, names: [], values: {} }),
    });
  });
}

test('a Firestore project lists its collections, with the document id as the key', async ({
  page,
}) => {
  await stubFirestore(page);
  await page.getByTestId('rail-data').click();
  await page.getByTestId('connect-supabase').click();
  await page.getByTestId('module-firestore').click();
  await page.getByTestId('service-account').fill(KEY);
  await page.getByRole('button', { name: 'Connect and read collections' }).click();

  await expect(page.locator('.table-row')).toContainText('notes');
  await page.getByTestId('table-notes').click();

  const schema = page.getByTestId('schema-notes');
  // Every field any sampled document carried, and the id — which no document carries.
  await expect(schema).toContainText('title');
  await expect(schema).toContainText('done');
  await expect(schema.locator('tr', { hasText: 'id' })).toContainText('key');

  // The key file went to the dev server and nowhere the browser keeps.
  expect(await page.evaluate(() => JSON.stringify(window.localStorage))).not.toContain(
    'secretsecret',
  );
});

test('a comparison Firestore cannot make is not on the menu', async ({ page }) => {
  await stubFirestore(page);
  await page.getByTestId('rail-data').click();
  await page.getByTestId('connect-supabase').click();
  await page.getByTestId('module-firestore').click();
  await page.getByTestId('service-account').fill(KEY);
  await page.getByRole('button', { name: 'Connect and read collections' }).click();
  await expect(page.locator('.table-row')).toContainText('notes');

  // A read step, so the filter editor is on screen.
  await page.getByRole('button', { name: 'Nodes' }).click();
  await page.getByRole('button', { name: '+ API route' }).click();
  await page.getByRole('button', { name: '+ Read rows' }).click();
  await page.getByTestId('add-filter').click();

  const operators = page.getByTestId('filter-0-operator').locator('option');
  await expect(operators).toHaveText(['is', 'is not', 'is more than', 'is less than']);
});
