import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { unzipSync, strFromU8 } from 'fflate';
import { firstScreen, nameInput } from './canvas';

/**
 * The Code tab (`docs/24-code.md`).
 *
 * "You own the code" is not a promise anyone can check if they cannot see it. These check that
 * they can: the files, the file they picked, and a download that is a real zip with the real
 * source in it.
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto('/');
  await firstScreen(page);

  await page.getByRole('button', { name: '+ Text', exact: true }).click();
  await nameInput(page).fill('Greeting');
  // The *content*, not the name: what should turn up in the emitted source is what the screen
  // says, and a component's name never leaves the editor.
  await page
    .locator('.field', { has: page.locator('.field__label', { hasText: 'Content' }) })
    .locator('input')
    .fill('Hello from loom');
});

test('the rail has a Code section showing the emitted repo', async ({ page }) => {
  await page.getByTestId('rail-code').click();

  await expect(page.getByTestId('code-panel')).toBeVisible();
  await expect(page.getByTestId('code-panel')).toContainText('the same ones the Preview is running');

  // The things that make it a repo somebody else can run.
  await expect(page.getByTestId('code-file-package.json')).toBeVisible();
  await expect(page.getByTestId('code-file-vite.config.ts')).toBeVisible();
  await expect(page.getByTestId('code-file-src/main.tsx')).toBeVisible();
});

test('picking a file shows its source', async ({ page }) => {
  await page.getByTestId('rail-code').click();
  await page.getByTestId('code-file-src/artboards/Home.tsx').click();

  await expect(page.getByTestId('code-open-path')).toHaveText('src/artboards/Home.tsx');
  // The screen that was drawn, as the React it compiles to.
  await expect(page.getByTestId('code-content')).toContainText('export default function Home');
  await expect(page.getByTestId('code-content')).toContainText('Hello from loom');
});

test('the download is a real zip with the real source in it', async ({ page }) => {
  await page.getByTestId('rail-code').click();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('download-project').click(),
  ]);

  expect(download.suggestedFilename()).toMatch(/\.zip$/);

  const path = await download.path();
  const bytes = await readFile(path);
  const files = unzipSync(new Uint8Array(bytes));

  // Not a stub or a manifest: the project, as files.
  expect(Object.keys(files)).toContain('package.json');
  expect(Object.keys(files)).toContain('src/artboards/Home.tsx');
  expect(strFromU8(files['src/artboards/Home.tsx']!)).toContain('Hello from loom');
  expect(JSON.parse(strFromU8(files['package.json']!)).scripts.build).toContain('vite build');
});

test('a build that will not compile says so where the code would have been', async ({ page }) => {
  // A Link with its address emptied is a Build error the compiler names.
  await page.getByTestId('palette-Link').click();
  await nameInput(page).fill('Nowhere');
  await page
    .locator('.field', { has: page.locator('.field__label', { hasText: 'Address' }) })
    .locator('input')
    .fill('');

  await page.getByTestId('rail-code').click();

  await expect(page.getByTestId('code-problem')).toContainText('nowhere to go');
  // And there is nothing to hand over, so the button says no rather than shipping a broken zip.
  await expect(page.getByTestId('download-project')).toBeDisabled();
});
