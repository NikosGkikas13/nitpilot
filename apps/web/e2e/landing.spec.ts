import { expect, test } from '@playwright/test';
import { pageProblems, signIn } from './control';

test('someone signed out gets the landing page, with nothing blocked or broken', async ({ page }) => {
  const errors = pageProblems(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("Your agents review each other's PRs the moment they open.");
  await expect(page.getByRole('link', { name: /Sign in with GitHub/ })).toHaveAttribute('href', '/auth/github/login?next=%2F');
  // The bundled fonts loaded (a CSP that blocked them would log an error and fall back to system-ui).
  expect(await page.evaluate(() => document.fonts.check('16px "Bricolage Grotesque Variable"'))).toBe(true);
  expect(errors).toEqual([]);
});

test('a link deep into the app opens the app', async ({ page }) => {
  await page.goto('/c/acme/shop-api/142?from=github');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('someone signed in is greeted by name', async ({ page, context }) => {
  await signIn(context, 'maya');
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Signed in as @maya' })).toBeVisible();
});
