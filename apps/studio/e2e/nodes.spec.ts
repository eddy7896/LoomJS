import { expect, test, type Page } from '@playwright/test';
import { drag, graphNode, handle } from './canvas';

/**
 * M3's gate: a button in the Preview calls the emitted serverless function and shows the result.
 * Everything here goes through the real editor, the real compiler, and the real dev server that
 * mounts the emitted `api/*.ts` — no stubs anywhere in the path.
 */

const preview = (page: Page) => page.frameLocator('iframe.preview__frame');

const field = (page: Page, label: string) =>
  page.locator('.field', { has: page.locator('.field__label', { hasText: label }) });


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

test('a wired graph calls the emitted function and shows its result', async ({ page }) => {
  // 1. The UI: an input, a button, and somewhere to put the answer.
  await page.getByRole('button', { name: '+ Text field' }).click();
  await field(page, 'Name').locator('input').fill('Input');

  await page.locator('.layer--artboard', { hasText: 'Home' }).first().click();
  await page.getByRole('button', { name: '+ Button' }).click();
  await field(page, 'Name').locator('input').fill('Shout');
  await field(page, 'Label').locator('input').fill('Shout');

  await page.locator('.layer--artboard', { hasText: 'Home' }).first().click();
  await page.getByRole('button', { name: '+ Text', exact: true }).click();
  await field(page, 'Name').locator('input').fill('Result');

  // 2. The graph: an API route with an uppercase step inside its body.
  await page.getByRole('button', { name: 'Nodes' }).click();
  await page.getByRole('button', { name: '+ API route' }).click();
  await page.getByRole('button', { name: '+ Compute' }).click();
  await expect(page.locator('.nstep')).toHaveCount(1);

  // 3. Wire it: the button fires it, the field feeds it, the text reads it.
  const api = graphNode(page, 'API route');
  await drag(page, handle(graphNode(page, 'Shout'), 'pt_click'), handle(api, 'pt_run'));
  await drag(page, handle(graphNode(page, 'Input'), 'pt_value'), handle(api, 'pt_input'));
  await drag(page, handle(api, 'pt_result'), handle(graphNode(page, 'Result'), 'pt_content'));
  await expect(page.locator('.react-flow__edge')).toHaveCount(3);

  // 4. Run it in the Preview: the emitted server function does the work.
  await expect(page.locator('.preview__state')).toHaveText('live');
  await preview(page).locator('input').fill('quiet words');
  await preview(page).getByRole('button', { name: 'Shout' }).click();

  await expect(preview(page).locator('span', { hasText: 'QUIET WORDS' })).toBeVisible();
});

test('an illegal wire is refused at the gesture (Problems tier)', async ({ page }) => {
  await page.locator('.layer--artboard', { hasText: 'Home' }).first().click();
  await page.getByRole('button', { name: '+ Button' }).click();
  await field(page, 'Name').locator('input').fill('Go');

  await page.getByRole('button', { name: 'Nodes' }).click();
  await page.getByRole('button', { name: '+ API route' }).click();

  // A trigger port cannot feed a data port. The wire must NOT land, so this attempt stands alone.
  await drag(
    page,
    handle(graphNode(page, 'Go'), 'pt_click'),
    handle(graphNode(page, 'API route'), 'pt_input'),
    { expectWire: false },
  );

  await expect(page.locator('.problem')).toContainText('trigger port to a data port');
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
});

test('changing a Compute operation retypes its ports', async ({ page }) => {
  await page.getByRole('button', { name: 'Nodes' }).click();
  await page.getByRole('button', { name: '+ API route' }).click();
  await page.getByRole('button', { name: '+ Compute' }).click();

  await expect(page.locator('.portline', { hasText: 'input' })).toContainText('text');
  await field(page, 'Operation').locator('select').selectOption('double');
  await expect(page.locator('.portline', { hasText: 'input' })).toContainText('number');
});

test('a function node outside a route derives a value in the browser', async ({ page }) => {
  // The graph a designer draws first: a field, a Compute, a Text. No API route anywhere, so all
  // of it runs in the browser — no request, no server, no state.
  await page.getByRole('button', { name: '+ Text field' }).click();
  await field(page, 'Name').locator('input').fill('Input');

  await page.locator('.layer--artboard', { hasText: 'Home' }).first().click();
  await page.getByRole('button', { name: '+ Text', exact: true }).click();
  await field(page, 'Name').locator('input').fill('Length');

  await page.getByRole('button', { name: 'Nodes' }).click();
  await page.getByRole('button', { name: '+ Compute' }).click();
  // Retype the ports before wiring: length turns text into a number.
  await field(page, 'Operation').locator('select').selectOption('length');

  const compute = graphNode(page, 'Compute');
  await drag(page, handle(graphNode(page, 'Input'), 'pt_value'), handle(compute, 'pt_input'));
  await drag(page, handle(compute, 'pt_result'), handle(graphNode(page, 'Length'), 'pt_content'));
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);

  await expect(page.locator('.preview__state')).toHaveText('live');
  await preview(page).locator('input').fill('hello');

  // It updates as the person types: a derived value is a const recomputed on render.
  await expect(preview(page).locator('span', { hasText: '5' })).toBeVisible();
  await preview(page).locator('input').fill('hello there');
  await expect(preview(page).locator('span', { hasText: '11' })).toBeVisible();
});

test('a trigger holds a derivation until the button is pressed', async ({ page }) => {
  // Same graph as above, plus a button wired into the Compute's run port. The value should now
  // stay put while typing and only catch up on a click.
  await page.getByRole('button', { name: '+ Text field' }).click();
  await field(page, 'Name').locator('input').fill('Input');

  await page.locator('.layer--artboard', { hasText: 'Home' }).first().click();
  await page.getByRole('button', { name: '+ Button' }).click();
  await field(page, 'Name').locator('input').fill('Go');
  await field(page, 'Label').locator('input').fill('Go');

  await page.locator('.layer--artboard', { hasText: 'Home' }).first().click();
  await page.getByRole('button', { name: '+ Text', exact: true }).click();
  await field(page, 'Name').locator('input').fill('Length');

  await page.getByRole('button', { name: 'Nodes' }).click();
  await page.getByRole('button', { name: '+ Compute' }).click();
  await field(page, 'Operation').locator('select').selectOption('length');

  const compute = graphNode(page, 'Compute');
  await drag(page, handle(graphNode(page, 'Input'), 'pt_value'), handle(compute, 'pt_input'));
  await drag(page, handle(compute, 'pt_result'), handle(graphNode(page, 'Length'), 'pt_content'));
  await drag(page, handle(graphNode(page, 'Go'), 'pt_click'), handle(compute, 'pt_run'));
  await expect(page.locator('.react-flow__edge')).toHaveCount(3);

  await expect(page.locator('.preview__state')).toHaveText('live');
  await preview(page).locator('input').fill('hello');

  // Typing no longer recomputes: the held value is still its starting one.
  await expect(preview(page).locator('span', { hasText: '0' })).toBeVisible();

  await preview(page).getByRole('button', { name: 'Go' }).click();
  await expect(preview(page).locator('span', { hasText: '5' })).toBeVisible();

  // And it stays at 5 until the next press, however much the field changes.
  await preview(page).locator('input').fill('hello there');
  await expect(preview(page).locator('span', { hasText: '5' })).toBeVisible();
  await preview(page).getByRole('button', { name: 'Go' }).click();
  await expect(preview(page).locator('span', { hasText: '11' })).toBeVisible();
});

test('a field wired straight to a Text shows what the person types', async ({ page }) => {
  // The simplest wire on the canvas, and the first one anyone draws.
  await page.getByRole('button', { name: '+ Text field' }).click();
  await field(page, 'Name').locator('input').fill('Input');

  await page.locator('.layer--artboard', { hasText: 'Home' }).first().click();
  await page.getByRole('button', { name: '+ Text', exact: true }).click();
  await field(page, 'Name').locator('input').fill('Echo');

  await page.getByRole('button', { name: 'Nodes' }).click();
  await drag(
    page,
    handle(graphNode(page, 'Input'), 'pt_value'),
    handle(graphNode(page, 'Echo'), 'pt_content'),
  );

  await expect(page.locator('.preview__state')).toHaveText('live');
  await preview(page).locator('input').fill('typed live');
  await expect(preview(page).locator('span', { hasText: 'typed live' })).toBeVisible();
});
