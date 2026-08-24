import { expect, test, type Page } from '@playwright/test';
import { firstScreen } from './canvas';

/**
 * Tools, end to end (T1–T3, `docs/22-api-connectors.md`).
 *
 * Attaching a model, adding a call, and the two things that must stay true however the panel
 * looks: the key leaves for the dev server and is kept nowhere here, and the call is a step
 * inside an API route — never something a screen does on its own.
 */

const KEY = 'sk-ant-super-secret-value';

/** What the studio sent the dev server, so a test can say what did not happen too. */
async function watchEnv(page: Page): Promise<string[]> {
  const sent: string[] = [];
  await page.route('**/__loom/env', async (route) => {
    if (route.request().method() === 'POST') sent.push(route.request().postData() ?? '');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, names: [], values: {} }),
    });
  });
  return sent;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto('/');
  await firstScreen(page);
});

test('the rail has a Tools section listing what loom can call', async ({ page }) => {
  await page.getByTestId('rail-tools').click();

  await expect(page.getByTestId('tools-panel')).toBeVisible();
  await expect(page.getByTestId('tool-anthropic')).toContainText('Claude');
  await expect(page.getByTestId('tool-openai')).toContainText('OpenAI');
  await expect(page.getByTestId('tool-request')).toContainText('HTTP request');
});

test('attaching a model sends the key to the server and keeps none of it here', async ({ page }) => {
  const sent = await watchEnv(page);

  await page.getByTestId('rail-tools').click();
  await page.getByTestId('tool-anthropic-toggle').click();
  await page.getByTestId('tool-anthropic-key').fill(KEY);
  await page.getByTestId('tool-anthropic-attach').click();

  await expect(page.getByTestId('tool-anthropic')).toContainText('attached');

  // It went to the dev server…
  expect(sent.some((body) => body.includes(KEY))).toBe(true);
  // …and nowhere this browser keeps.
  expect(await page.evaluate(() => JSON.stringify(window.localStorage))).not.toContain(KEY);
});

test('a call lands inside an API route, with the operation as its inputs', async ({ page }) => {
  await watchEnv(page);

  await page.getByTestId('rail-tools').click();
  await page.getByTestId('tool-anthropic-toggle').click();
  await page.getByTestId('tool-anthropic-key').fill(KEY);
  await page.getByTestId('tool-anthropic-attach').click();

  // No route selected: the call brings its own, the way a table step does.
  await page.getByTestId('tool-anthropic-add-ask').click();

  await page.getByTestId('rail-nodes').click();
  await expect(page.locator('.nstep')).toHaveCount(1);

  // Its ports are the operation's parameters, ready to wire a field into.
  await expect(page.locator('.portline')).toContainText(['prompt', 'system', 'answer']);
});

test('the call says where it runs and which name holds the key', async ({ page }) => {
  await watchEnv(page);

  await page.getByTestId('rail-tools').click();
  await page.getByTestId('tool-anthropic-toggle').click();
  await page.getByTestId('tool-anthropic-key').fill(KEY);
  await page.getByTestId('tool-anthropic-attach').click();
  await page.getByTestId('tool-anthropic-add-ask').click();

  // The inspector, where the call is selected.
  await expect(page.getByTestId('tool-model')).toBeVisible();
  await expect(page.locator('.inspector')).toContainText('Runs on the server');
  await expect(page.locator('.inspector')).toContainText('ANTHROPIC_API_KEY');
});

test('a request you write yourself asks for an address', async ({ page }) => {
  await watchEnv(page);

  await page.getByTestId('rail-tools').click();
  await page.getByTestId('tool-request-toggle').click();
  await page.getByTestId('tool-request-attach').click();
  await page.getByTestId('tool-request-add').click();

  await expect(page.getByTestId('tool-url')).toBeVisible();
  await expect(page.getByTestId('tool-method')).toHaveValue('POST');
});

test('tools are grouped the way a person thinks about them', async ({ page }) => {
  await page.getByTestId('rail-tools').click();

  await expect(page.getByTestId('tool-family-ai')).toContainText('Models');
  await expect(page.getByTestId('tool-family-email')).toContainText('Resend');
  await expect(page.getByTestId('tool-family-payments')).toContainText('Stripe');
  await expect(page.getByTestId('tool-family-messaging')).toContainText('Twilio');
  await expect(page.getByTestId('tool-family-messaging')).toContainText('Slack');
  await expect(page.getByTestId('tool-family-iot')).toContainText('Home Assistant');
});

test('a tool that needs two names asks for both', async ({ page }) => {
  await watchEnv(page);
  await page.getByTestId('rail-tools').click();
  await page.getByTestId('tool-twilio-toggle').click();

  // Twilio wants an account SID beside its token; asking for one would be asking for half.
  await expect(page.getByTestId('tool-twilio-key')).toBeVisible();
  await expect(page.getByTestId('tool-twilio-key-TWILIO_AUTH_TOKEN')).toBeVisible();

  // And it will not attach until both are there.
  await expect(page.getByTestId('tool-twilio-attach')).toBeDisabled();
  await page.getByTestId('tool-twilio-key').fill('ACxxxx');
  await page.getByTestId('tool-twilio-key-TWILIO_AUTH_TOKEN').fill('token');
  await expect(page.getByTestId('tool-twilio-attach')).toBeEnabled();
});

test('a self-hosted device hub asks where it lives, in the clear', async ({ page }) => {
  await watchEnv(page);
  await page.getByTestId('rail-tools').click();
  await page.getByTestId('tool-homeAssistant-toggle').click();

  // An address is not a secret, and masking it would only make it hard to check.
  await expect(page.getByTestId('tool-homeAssistant-key')).toHaveAttribute('type', 'text');
});

test('a tool call reads as its own kind of work in the node viewer', async ({ page }) => {
  await watchEnv(page);

  await page.getByTestId('rail-tools').click();
  await page.getByTestId('tool-resend-toggle').click();
  await page.getByTestId('tool-resend-key').fill('re_test_key');
  await page.getByTestId('tool-resend-attach').click();
  await page.getByTestId('tool-resend-add-send').click();

  await page.getByTestId('rail-nodes').click();

  // Inside the route, coloured as a tool rather than looking like a computation.
  const step = page.getByTestId('nstep-tool');
  await expect(step).toHaveCount(1);
  await expect(step).toContainText('Resend: Send email');
  await expect(step).toContainText('send');
});
