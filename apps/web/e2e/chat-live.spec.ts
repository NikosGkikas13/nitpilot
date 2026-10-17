import { expect, test } from '@playwright/test';
import { openPr, pageProblems, resetChats, signIn, startCli, stopCli } from './control';

test.beforeEach(resetChats);

test('a chat updates while an agent reviews: its progress line, then its summary and point, without a reload', async ({ page, context }) => {
  await openPr({ number: 52, title: 'Paginate invoices', author: 'maya', reviewer: 'leo' });
  const errors = pageProblems(page);
  await signIn(context, 'maya');
  await page.goto('/c/octo/sandbox/52');
  await expect(page.getByRole('heading', { level: 1, name: 'Paginate invoices' })).toBeVisible();
  // leo's CLI isn't connected yet: his review waits.
  await expect(page.getByText("leo's agent · offline")).toBeVisible();

  await startCli('leo', 'paced.json');
  try {
    await expect(page.getByText("leo's agent is reviewing…")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('One point: the page size.')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('article', { name: /P1, Major bug point, Open: Page size is too big/ })).toBeVisible();
    await expect(page.getByText("leo's agent is reviewing…")).toBeHidden();
  } finally {
    await stopCli('leo');
  }
  expect(errors).toEqual([]);
});
