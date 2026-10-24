import { expect, test } from '@playwright/test';
import { pageProblems } from './control';
import { FIRST_RUN_BASE_URL, FIRST_RUN_CONTROL_URL } from './ports';

// A server with no GitHub App yet (apps/server/test/e2e/first-run-server.ts, spec §10 "First-run mode"), not the
// server the other specs share. Its control port is also the stand-in for github.com.
test.use({ baseURL: FIRST_RUN_BASE_URL });

const SETUP_CODE = 'E2EF-RSTR';

async function control(path: string, method = 'POST'): Promise<Response> {
  const res = await fetch(`${FIRST_RUN_CONTROL_URL}${path}`, { method });
  if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status} ${await res.text()}`);
  return res;
}

test.beforeEach(async () => {
  await control('/reset');
});

test('every other page sends you to the setup page', async ({ page }) => {
  const problems = pageProblems(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: "This server isn't set up yet" })).toBeVisible();
  await expect(page.getByText('Finish setup at /first-run.')).toBeVisible();
  await page.getByRole('link', { name: 'Open the setup page' }).click();
  await expect(page).toHaveURL(`${FIRST_RUN_BASE_URL}/first-run`);
  await expect(page.getByRole('heading', { level: 1, name: 'Set up Nitpilot' })).toBeVisible();
  expect(problems).toEqual([]);
});

test('the setup code, the form post to GitHub, the restart, then Install and Sign in', async ({ page }) => {
  const problems = pageProblems(page);
  await page.goto('/first-run');
  const code = page.getByRole('textbox', { name: 'Setup code' });
  await expect(page.getByRole('textbox', { name: 'App name' })).toHaveValue('Nitpilot (127.0.0.1:4321)');

  // A wrong code: said on the field, and what was typed stays.
  await code.fill('E2EF-WRNG');
  await page.getByRole('button', { name: 'Create GitHub App' }).click();
  await expect(page.getByText("That code doesn't match the one in the server's log.")).toBeVisible();
  await expect(code).toHaveAttribute('aria-invalid', 'true');
  await expect(code).toHaveValue('E2EF-WRNG');

  // The right one: the browser posts the manifest to "GitHub", which sends it back to the callback, then to ?done=1.
  await code.fill(SETUP_CODE);
  await page.getByRole('button', { name: 'Create GitHub App' }).click();
  await expect(page).toHaveURL(`${FIRST_RUN_BASE_URL}/first-run?done=1`);
  await expect(page.getByRole('status')).toHaveText(/Restarting the server…/);

  const posted = (await (await control('/last-post', 'GET')).json()) as { path: string; state: string; manifest: Record<string, unknown> };
  expect(posted.path).toBe('/settings/apps/new');
  expect(posted.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(posted.manifest).toMatchObject({
    name: 'Nitpilot (127.0.0.1:4321)',
    public: false,
    redirect_url: `${FIRST_RUN_BASE_URL}/first-run/callback`,
    hook_attributes: { url: `${FIRST_RUN_BASE_URL}/webhooks/github`, active: true },
  });

  // Docker starts the server again; the page, asking every 2 seconds, sees it ready.
  await control('/restart');
  await expect(page.getByRole('heading', { level: 1, name: 'Your GitHub App is ready' })).toBeVisible({ timeout: 6_000 });
  await expect(page.getByRole('link', { name: 'Install the app on your repos' })).toHaveAttribute('href', `${FIRST_RUN_CONTROL_URL}/apps/nitpilot-e2e/installations/new`);
  await expect(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/auth/github/login');

  // Nothing was blocked on the way, including the form post to another origin (the CSP's form-action allows it).
  expect(problems).toEqual([]);
});
