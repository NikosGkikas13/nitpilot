import { expect, test } from '@playwright/test';
import { openPr, pageProblems, resetChats, signIn, startCli, stopCli } from './control';

test.beforeEach(resetChats);

test("Auto-fix off: maya's agent drafts its fixes, she reads the diff and sends them, and leo's agent re-reviews", async ({ page, context }) => {
  await openPr({ number: 71, title: 'Smaller pages', author: 'maya', reviewer: 'leo' });
  const errors = pageProblems(page);

  // maya turns her Auto-fix off before any agent runs.
  await signIn(context, 'maya');
  await page.goto('/c/octo/sandbox/71');
  const autoFix = page.getByRole('switch', { name: 'Auto-fix' });
  await expect(autoFix).toHaveAttribute('aria-checked', 'true');
  await autoFix.click();
  await expect(page.getByText("Auto-fix is off. Your agent's work will wait as drafts.")).toBeVisible();
  await expect(page.getByText('maya turned Auto-fix off')).toBeVisible();
  await expect(autoFix).toHaveAttribute('aria-checked', 'false');

  await startCli('leo', 'happy.json');
  await startCli('maya', 'happy.json');
  try {
    // leo's review comes in, maya's agent fixes P1 and answers P2, and its commit waits on her laptop.
    const draft = page.getByRole('region', { name: 'Draft: Your agent wants to push fixes for P1 and reply on P2' });
    await expect(draft).toBeVisible({ timeout: 20_000 });
    await expect(draft.getByText('Not pushed')).toBeVisible();
    await expect(draft.getByRole('button', { name: 'src/orders.ts, 1 added, 1 removed' })).toHaveAttribute('aria-expanded', 'true');
    await expect(draft.locator('[data-kind="add"]')).toContainText('export const pageSize = 25;');

    // Send: her CLI pushes the drafted commit, its replies go out, and leo's agent looks again.
    await draft.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText("Sending your agent's fixes.")).toBeVisible();
    await expect(page.getByText('maya is sending the drafted fixes')).toBeVisible();
    await expect(page.getByText(/^maya's agent pushed [0-9a-f]{7}$/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Round 2: leo's agent will review")).toBeVisible();
    await expect(draft).toHaveCount(0);
  } finally {
    await stopCli('maya');
    await stopCli('leo');
  }
  expect(errors).toEqual([]);
});
