import { expect, test } from '@playwright/test';
import { openPr, pageProblems, resetChats, signIn, startCli, stopCli } from './control';

test.beforeEach(resetChats);

test('an escalation: the author lets the agents continue, a round runs, and the reviewer resolves what escalates next', async ({ page, context }) => {
  await openPr({ number: 61, title: 'Cap the page size', author: 'maya', reviewer: 'leo' });
  const errors = pageProblems(page);
  await startCli('leo', 'escalation.json');
  await startCli('maya', 'escalation.json');
  try {
    // leo's agent raises a security point: it goes to a person.
    await signIn(context, 'maya');
    await page.goto('/c/octo/sandbox/61');
    const banner = page.getByRole('alert');
    await expect(banner).toContainText('Needs a human decision', { timeout: 15_000 });
    // maya wrote the PR: she may hand the point back, but only leo, who raised it, may resolve it.
    await expect(banner.getByRole('button', { name: 'Resolve' })).toHaveCount(0);
    await banner.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('Agents will keep going on P1.')).toBeVisible();
    await expect(page.getByText('maya let the agents continue on P1')).toBeVisible();

    // A round runs: maya's agent fixes P1, leo's agent settles it and raises another security point.
    await expect(page.getByRole('article', { name: /P2, Major security point, Escalated/ })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /P1, Blocker security point, Resolved/ })).toBeVisible();

    // leo resolves it, and the chat is ready for his approval.
    await signIn(context, 'leo');
    await page.reload();
    await page.getByRole('alert').getByRole('button', { name: 'Resolve' }).click();
    await expect(page.getByText('P2 resolved.')).toBeVisible();
    await expect(page.getByText('Ready for your approval')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('alert')).toHaveCount(0);
  } finally {
    await stopCli('maya');
    await stopCli('leo');
  }
  expect(errors).toEqual([]);
});
