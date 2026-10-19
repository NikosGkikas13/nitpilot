import { expect, test, type APIRequestContext } from '@playwright/test';
import { forgetDevices, pageProblems, signIn } from './control';

// Device approval against the real server (handoff §6, docs/why/cli-login.md): the same two requests `nitpilot login`
// makes (start, then poll), with the web app's page in between. forgetDevices revokes the token the test makes.
test.afterAll(async () => {
  await forgetDevices('maya');
});

/** Start a login the way the CLI does. Answers the secret device code and the short code the terminal would print. */
async function startLogin(request: APIRequestContext) {
  const res = await request.post('/api/cli/login', { data: { deviceName: 'playwright-laptop' } });
  expect(res.ok()).toBe(true);
  return (await res.json()) as { deviceCode: string; userCode: string; verifyUrl: string };
}

test("approving on the page gives the CLI's next poll its token", async ({ page, context }) => {
  const problems = pageProblems(page);
  const login = await startLogin(page.request);
  expect(new URL(login.verifyUrl).pathname).toBe('/cli/approve');

  await signIn(context, 'maya');
  await page.goto(`/cli/approve?code=${login.userCode}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Approve this device?' })).toBeVisible();
  await expect(page.getByRole('img', { name: /^Code / })).toHaveText(login.userCode);
  await expect(page.getByText('playwright-laptop')).toBeVisible();
  await expect(page.getByText(/The code expires in (10:00|9:\d\d)\./)).toBeVisible();

  const poll = async () => (await page.request.post('/api/cli/login/poll', { data: { deviceCode: login.deviceCode } })).json();
  expect(await poll()).toEqual({ status: 'pending' });

  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Device approved' })).toBeVisible();
  await expect(page.getByText('playwright-laptop can now run your agent. You can close this tab.')).toBeVisible();
  expect(await poll()).toMatchObject({ status: 'approved', token: expect.stringMatching(/^nit_/) });
  expect(problems).toEqual([]);
});

test('signed out, the page sends you through GitHub sign-in and asks to come back to the same code', async ({ page }) => {
  // The server would send the browser on to github.com: answer that here, so nothing leaves the machine.
  await page.route('https://github.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>GitHub</title>' }));
  const signInRequest = page.waitForRequest((req) => new URL(req.url()).pathname === '/auth/github/login');
  await page.goto('/cli/approve?code=WDJB-MJHT');
  const url = new URL((await signInRequest).url());
  expect(url.searchParams.get('next')).toBe('/cli/approve?code=WDJB-MJHT');
});
