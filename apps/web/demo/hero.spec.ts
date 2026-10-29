/**
 * The landing page's looping clip (src/routes/Landing/clip/): maya's chat while the two agents work a PR out, no captions.
 * Recorded once per theme by demo.config.ts's hero-light and hero-dark projects; see demo.spec.ts for how to run, and
 * `demo/clip.sh` for cropping the recordings into the files the landing page plays.
 */
import { expect, test } from '@playwright/test';
import { openPr, resetChats, signIn, startCli, stopCli } from '../e2e/control';

const SCENARIO = '../../../../../web/demo/demo.json';

test('hero clip', async ({ page, context }) => {
  await resetChats();
  await signIn(context, 'maya');
  await openPr({ number: 42, title: 'Cursor pagination for orders', author: 'maya', reviewer: 'leo' });
  await page.goto('/c/octo/sandbox/42');
  await expect(page.getByRole('heading', { level: 1, name: 'Cursor pagination for orders' })).toBeVisible();
  // Where the chat starts, for clip.sh's crop (the inbox column is left of it).
  const chat = (await page.getByRole('region', { name: 'Timeline' }).boundingBox())!;
  console.log(`CHAT_LEFT=${Math.round(chat.x)}`);
  await page.waitForTimeout(1000);

  await startCli('leo', SCENARIO);
  await startCli('maya', SCENARIO);
  try {
    await expect(page.getByText('Both points settled.')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/Waiting for leo's approval/)).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(4000);
  } finally {
    await stopCli('maya');
    await stopCli('leo');
  }
});
