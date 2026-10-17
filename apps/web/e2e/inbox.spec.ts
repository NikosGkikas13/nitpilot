import { expect, test } from '@playwright/test';
import { openPr, pageProblems, resetChats, signIn } from './control';

test.beforeEach(resetChats);

test('the inbox lists the PRs you review and your own, each under its tab', async ({ page, context }) => {
  await openPr({ number: 42, title: 'Cursor pagination for orders', author: 'maya', reviewer: 'leo' });
  await openPr({ number: 43, title: 'Retry webhooks with backoff', author: 'leo', reviewer: 'maya' });
  const errors = pageProblems(page);
  await signIn(context, 'maya');
  await page.goto('/');

  const list = page.getByRole('listbox', { name: 'Pull requests' });
  await expect(page.getByRole('tab', { name: 'To review' })).toHaveAttribute('aria-selected', 'true');
  await expect(list.getByRole('option')).toHaveCount(1);
  await expect(list.getByRole('option').first()).toContainText('octo/sandbox #43');
  await expect(list.getByRole('option').first()).toContainText('Retry webhooks with backoff');

  await page.getByRole('tab', { name: 'Mine' }).click();
  await expect(list.getByRole('option')).toHaveCount(1);
  // leo's review is queued, and leo's CLI isn't connected: his agent waits.
  await expect(list.getByRole('option').first()).toContainText('Cursor pagination for orders');
  await expect(list.getByRole('option').first()).toContainText('Waiting');

  await list.getByRole('option').first().click();
  await expect(page.getByRole('heading', { name: 'Cursor pagination for orders' })).toBeVisible();
  await expect(page).toHaveURL(/\/c\/octo\/sandbox\/42$/);
  expect(errors).toEqual([]);
});
