import { expect, test } from '@playwright/test';
import { firstScreen, nameInput } from './canvas';

/**
 * Grouping (G1, `docs/16-grouping.md`).
 *
 * A group is a Frame, so what these check is the part that is not free: picking more than one
 * thing, and the geometry surviving a round trip through group and ungroup.
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto('/');
  await firstScreen(page);
});

async function twoTexts(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: '+ Text', exact: true }).click();
  await nameInput(page).fill('First');
  await page.locator('.layer--artboard', { hasText: 'Home' }).first().click();
  await page.getByRole('button', { name: '+ Text', exact: true }).click();
  await nameInput(page).fill('Second');
}

test('shift-click picks a second thing, and Group wraps both', async ({ page }) => {
  await twoTexts(page);

  await page.locator('.layer', { hasText: 'First' }).first().click();
  await page.locator('.layer', { hasText: 'Second' }).first().click({ modifiers: ['Shift'] });

  // Both rows read as picked, and the button says how many it will wrap.
  await expect(page.locator('.layer.is-also')).toHaveCount(1);
  await expect(page.getByTestId('group')).toContainText('Group 2');

  await page.getByTestId('group').click();

  // A group is a Frame holding them, and the tree shows it that way.
  await expect(page.getByTestId('component-name')).toHaveValue('Group');
  const group = page.locator('.layer', { hasText: 'Group' }).first();
  await expect(group).toBeVisible();
});

test('ungroup puts everything back where it looked', async ({ page }) => {
  await twoTexts(page);

  await page.locator('.layer', { hasText: 'First' }).first().click();
  await page.locator('.layer', { hasText: 'Second' }).first().click({ modifiers: ['Shift'] });

  // Where they sit before grouping, straight from the inspector's own X/Y.
  await page.locator('.layer', { hasText: 'Second' }).first().click();
  const before = await page.getByTestId('position-x').inputValue();

  await page.locator('.layer', { hasText: 'First' }).first().click();
  await page.locator('.layer', { hasText: 'Second' }).first().click({ modifiers: ['Shift'] });
  await page.getByTestId('group').click();
  await page.getByTestId('ungroup').click();

  await page.locator('.layer', { hasText: 'Second' }).first().click();
  await expect(page.getByTestId('position-x')).toHaveValue(before);
});

test('one thing alone is not offered a group', async ({ page }) => {
  await twoTexts(page);
  await page.locator('.layer', { hasText: 'First' }).first().click();
  await expect(page.getByTestId('group')).toHaveCount(0);
});
