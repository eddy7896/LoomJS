import { expect, test } from '@playwright/test';
import { firstScreen } from './canvas';

/**
 * The panels hold their shape (`docs/26-panel-layout.md`).
 *
 * Two things that were wrong and are easy to get wrong again: Problems drifted to wherever the
 * panel above it happened to end, and the inspector's dense rows clipped their own controls when
 * there was not room — a select reading "cus" is a control you can see and cannot use.
 *
 * Measured rather than eyeballed: a screenshot review catches this once, and a test catches it
 * every time.
 */

/** Every element type the palette offers, since each one draws a different set of sections. */
const TYPES = ['Text', 'Button', 'Text field', 'Select', 'Table', 'Radio buttons', 'Shape', 'Image'];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto('/');
  await firstScreen(page);
});

test('Problems sits at the bottom of the rail, wherever the panel above ends', async ({ page }) => {
  const rail = page.locator('.rail');
  const problems = page.locator('.problems');

  const railBox = (await rail.boundingBox())!;
  const problemsBox = (await problems.boundingBox())!;

  // Pinned: its bottom is the rail's bottom, not wherever the content above ran out.
  expect(Math.abs(railBox.y + railBox.height - (problemsBox.y + problemsBox.height))).toBeLessThan(2);

  // And it stays there when the section above changes size.
  await page.getByTestId('rail-logs').click();
  const afterBox = (await problems.boundingBox())!;
  expect(Math.abs(afterBox.y - problemsBox.y)).toBeLessThan(2);
});

test('no inspector control is clipped or painted over another', async ({ page }) => {
  const problems: string[] = [];

  for (const label of TYPES) {
    await page.locator('.layer--artboard', { hasText: 'Home' }).first().click();
    await page.getByRole('button', { name: `+ ${label}`, exact: true }).click();

    problems.push(
      ...(await page.evaluate((type) => {
        const panel = document.querySelector('.inspector');
        if (!panel) return [`[${type}] no inspector`];
        const found: string[] = [];

        // Content wider than the box holding it: the "cus" case.
        for (const node of panel.querySelectorAll<HTMLElement>('*')) {
          if (node.clientWidth > 0 && node.scrollWidth > node.clientWidth + 1) {
            found.push(`[${type}] clipped: ${node.className || node.tagName}`);
          }
        }

        // Anything reaching past the panel's own edge.
        const box = panel.getBoundingClientRect();
        for (const node of panel.querySelectorAll<HTMLElement>('*')) {
          const rect = node.getBoundingClientRect();
          if (rect.width > 0 && rect.right > box.right + 1) {
            found.push(`[${type}] outside the panel: ${node.className || node.tagName}`);
          }
        }

        // Two controls in one row occupying the same pixels.
        for (const row of panel.querySelectorAll<HTMLElement>('.ins__row')) {
          const kids = [...row.children] as HTMLElement[];
          for (let i = 0; i < kids.length; i += 1) {
            for (let j = i + 1; j < kids.length; j += 1) {
              const a = kids[i]!.getBoundingClientRect();
              const b = kids[j]!.getBoundingClientRect();
              const overlaps =
                a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
              if (overlaps) found.push(`[${type}] overlap: ${kids[i]!.className} × ${kids[j]!.className}`);
            }
          }
        }

        return found;
      }, label)),
    );
  }

  expect([...new Set(problems)]).toEqual([]);
});

test('the inspector holds together in a narrower window too', async ({ page }) => {
  // The panel is narrow to begin with and gets narrower; a row that only ever shrank ended with
  // a control clipped behind another.
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.locator('.layer--artboard', { hasText: 'Home' }).first().click();
  await page.getByRole('button', { name: '+ Table', exact: true }).click();

  const clipped = await page.evaluate(() => {
    const panel = document.querySelector('.inspector')!;
    return [...panel.querySelectorAll<HTMLElement>('*')].filter(
      (node) => node.clientWidth > 0 && node.scrollWidth > node.clientWidth + 1,
    ).length;
  });

  expect(clipped).toBe(0);
});
