import { expect, test } from '@playwright/test';
import { forgetDevices, installApp, resetChats, signIn, startCli } from './control';

// The setup checklist against the real server (spec §16 "Onboarding", handoff §5). /reset makes everyone's checklist
// unfinished again and lists no installation; forgetDevices takes maya back to before `nitpilot login`.
test.beforeEach(async () => {
  await forgetDevices('maya');
  await resetChats();
});
test.afterAll(async () => {
  await forgetDevices('maya');
  await resetChats();
});

test("a first sign-in lands on the checklist, with GitHub's install page next", async ({ page }) => {
  // A real sign-in: the server sends the browser to GitHub, and GitHub (the pretend one) sends it back with a code.
  const login = await page.request.get('/auth/github/login', { maxRedirects: 0 });
  const state = new URL(login.headers()['location']!).searchParams.get('state');
  await page.goto(`/auth/github/callback?code=any&state=${state}`);
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Set up Nitpilot' })).toBeVisible();
  await expect(page.getByText('1 of 5')).toBeVisible();
  await expect(page.getByText('Signed in as @sam.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Install on GitHub' })).toHaveAttribute('href', 'https://github.com/apps/nitpilot-dev/installations/new');
});

test('the checklist ticks itself off: the install when the window comes back, the rest when the CLI connects', async ({ page, context }) => {
  await signIn(context, 'maya');
  await page.goto('/setup');
  await expect(page.getByText('1 of 5')).toBeVisible();

  // GitHub's install page was another tab: coming back to this one asks again.
  await installApp('maya');
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByText('2 of 5')).toBeVisible();
  const steps = page.getByRole('list', { name: 'Setup steps' }).getByRole('listitem');
  await expect(steps.nth(2)).toHaveAttribute('aria-current', 'step');
  await expect(steps.nth(2)).toContainText('Waiting for your terminal…');

  // `nitpilot start` connects with a linked repo and the fake agent: rows 3 to 5 tick, with no reload.
  await startCli('maya', 'happy.json');
  await expect(page.getByText('5 of 5')).toBeVisible();
  await expect(steps.nth(2)).toContainText('✓ Connected: test laptop');
  await expect(page.getByRole('link', { name: 'Open your inbox' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Skip for now' })).toHaveCount(0);
});
