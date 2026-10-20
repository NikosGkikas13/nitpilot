import { expect, test } from '@playwright/test';
import { openPr, pageProblems, resetChats, signIn, startCli, stopCli } from './control';

test.beforeEach(resetChats);

// Spec §20: "Someone who can read the repo but isn't a participant sees the chat read-only; someone who can't gets a
// 404." rita can read octo/sandbox on GitHub but takes no part in its PRs; GitHub hides the repo from otto.

test("someone who can read the repo but takes no part sees the chat, without the composer or the banner's buttons", async ({ page, context }) => {
  await openPr({ number: 81, title: 'Bound the export size', author: 'maya', reviewer: 'leo' });
  const errors = pageProblems(page);
  // leo's agent raises a security point, so the people in the PR would see Continue and Resolve.
  await startCli('leo', 'escalation.json');
  try {
    await signIn(context, 'rita');
    await page.goto('/c/octo/sandbox/81');
    await expect(page.getByRole('heading', { level: 1, name: 'Bound the export size' })).toBeVisible();
    const banner = page.getByRole('alert');
    await expect(banner).toContainText('Needs a human decision', { timeout: 15_000 });
    await expect(page.getByRole('article', { name: /P1, Blocker security point, Escalated/ })).toBeVisible();

    // She reads along: a sentence instead of the field, no Auto switch, and nothing to press on the banner.
    await expect(page.getByText("You're reading along. Only the author and the reviewers can message the agents.")).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Message the agents' })).toHaveCount(0);
    await expect(page.getByRole('switch')).toHaveCount(0);
    await expect(banner.getByRole('button')).toHaveCount(0);

    // The inbox lists the chats you take part in: this one isn't there.
    await expect(page.getByRole('listbox', { name: 'Pull requests' }).getByRole('option')).toHaveCount(0);
  } finally {
    await stopCli('leo');
  }
  expect(errors).toEqual([]);
});

test("someone GitHub doesn't show the repo gets the not-found page, the same as for a chat that doesn't exist", async ({ page, context }) => {
  await openPr({ number: 82, title: 'Bound the import size', author: 'maya', reviewer: 'leo' });
  const errors = pageProblems(page);
  await signIn(context, 'otto');
  await page.goto('/c/octo/sandbox/82');
  await expect(page.getByRole('heading', { level: 1, name: 'Nothing here' })).toBeVisible();
  await expect(page.getByText("This chat doesn't exist, or your GitHub account can't see its repo.")).toBeVisible();
  await expect(page.getByText('Bound the import size')).toHaveCount(0);

  // The API says the same: 404, as for a PR that has no chat.
  const hidden = await page.request.get('/api/chats/octo/sandbox/82');
  const missing = await page.request.get('/api/chats/octo/sandbox/999');
  expect(hidden.status()).toBe(404);
  expect(missing.status()).toBe(404);
  expect(await hidden.json()).toEqual(await missing.json());
  expect(errors).toEqual([]);
});
