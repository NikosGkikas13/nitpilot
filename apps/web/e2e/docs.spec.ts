import { expect, test } from '@playwright/test';
import { pageProblems } from './control';

test('the docs open signed out, page through, and fit a phone without calling the API', async ({ page }) => {
  const errors = pageProblems(page);
  const apiCalls: string[] = [];
  page.on('request', (req) => {
    const { pathname } = new URL(req.url());
    if (pathname.startsWith('/api/')) apiCalls.push(pathname);
  });

  page.on('websocket', (ws) => apiCalls.push(`websocket ${ws.url()}`));

  await page.goto('/docs');
  await expect(page.getByRole('heading', { level: 1, name: 'Introduction' })).toBeVisible();

  await page.getByRole('link', { name: /Next/ }).click();
  await expect(page).toHaveURL(/\/docs\/quickstart$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Quickstart' })).toBeVisible();

  // A new page opens at the top, not at the old scroll position.
  await page.goto('/docs/architecture');
  await expect(page.getByRole('heading', { level: 1, name: 'Architecture' })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
  await page.getByRole('link', { name: /Next/ }).click();
  await expect(page).toHaveURL(/\/docs\/writing-an-adapter$/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(50);
  // Back returns to where the reader was.
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: 'Architecture' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);

  await page.setViewportSize({ width: 375, height: 812 });
  for (const path of ['/docs', '/docs/quickstart', '/docs/how-it-works']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(375);
  }

  expect(apiCalls).toEqual([]);
  expect(errors).toEqual([]);
});
