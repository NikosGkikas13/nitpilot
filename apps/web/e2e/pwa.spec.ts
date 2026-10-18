import { expect, test } from '@playwright/test';
import { notify, pageProblems, signIn } from './control';
import { BASE_URL } from './ports';

test('the signed-in app links its manifest and runs its service worker, with nothing blocked', async ({ page, context }) => {
  const errors = pageProblems(page);
  await signIn(context, 'maya');
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Inbox' })).toBeVisible();
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
  // Resolves once public/sw.js is installed and active for the whole site.
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(scope).toBe(`${BASE_URL}/`);
  expect(errors).toEqual([]);
});

test('the build puts the manifest, the service worker and the icons at the root, and they are re-checked on every load', async ({ request }) => {
  const files: [path: string, type: string][] = [
    ['/manifest.webmanifest', 'application/manifest+json'],
    ['/sw.js', 'text/javascript'],
    ['/icons/icon.svg', 'image/svg+xml'],
    ['/icons/icon-192.png', 'image/png'],
    ['/icons/apple-touch-icon.png', 'image/png'],
  ];
  for (const [path, type] of files) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
    expect(res.headers()['content-type'], path).toContain(type);
    // Not under assets/, so no content hash in the name: the browser asks again each time (a new sw.js is seen).
    expect(res.headers()['cache-control'], path).toBe('no-cache');
  }
  const manifest = (await (await request.get('/manifest.webmanifest')).json()) as { name: string; start_url: string };
  expect(manifest).toMatchObject({ name: 'Nitpilot', start_url: '/' });
});

test("Settings reads push from the real browser; nobody subscribed means nothing is pushed", async ({ page, context }) => {
  await signIn(context, 'maya');
  await page.goto('/settings');
  // The server's VAPID key reached the page (without one it says push isn't set up), and pushState() ran against
  // Chromium's real APIs. Headless Chromium always blocks notifications, whatever the test allows, so this is the
  // "denied" state; the switch itself is checked by hand (the live step). Never subscribe here: that reaches
  // Google's push service.
  await expect(page.getByText("Notifications are blocked for this site. Allow them in your browser's site settings, then reload this page.")).toBeVisible();
  expect((await notify('maya')).recorded).toEqual([]);
});
