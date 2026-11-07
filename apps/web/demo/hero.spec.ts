/**
 * The landing page's looping clip (src/routes/Landing/clip/): maya's chat while the two agents work a PR out, no captions.
 * Her Auto-fix is off, so her agent's fix waits as a draft with its diff (the only place the chat shows the fix as code)
 * until she presses Send: viewers see the code leo's agent flags and the code hers changes.
 * Recorded once per theme by demo.config.ts's hero-light and hero-dark projects; see demo.spec.ts for how to run, and
 * `demo/clip.sh` for cropping the recordings into the files the landing page plays.
 *
 * Playwright's built-in video is 1x and already lossy, so this saves the screencast's own frames instead: 2x (sharp on
 * Retina screens), near-lossless JPEGs, plus a frames.txt that tells ffmpeg how long each one stays on screen.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { openPr, resetChats, signIn, startCli, stopCli } from '../e2e/control';

const SCENARIO = '../../../../../web/demo/demo.json';

test('hero clip', async ({ page, context }, testInfo) => {
  await resetChats();
  await signIn(context, 'maya');
  await openPr({ number: 42, title: 'Cursor pagination for orders', author: 'maya', reviewer: 'leo' });
  await page.goto('/c/octo/sandbox/42');
  await expect(page.getByRole('heading', { level: 1, name: 'Cursor pagination for orders' })).toBeVisible();
  // Auto-fix off before recording: the clip opens on the line that says so.
  const autoFix = page.getByRole('switch', { name: 'Auto-fix' });
  await autoFix.click();
  await expect(autoFix).toHaveAttribute('aria-checked', 'false');
  // Off the switch, so its tooltip doesn't stay on screen for the whole clip.
  await autoFix.blur();
  await page.mouse.move(900, 600);
  // Where the chat starts, for clip.sh's crop (the inbox column is left of it).
  const chat = (await page.getByRole('region', { name: 'Timeline' }).boundingBox())!;
  console.log(`CHAT_LEFT=${Math.round(chat.x)}`);

  const dir = join(import.meta.dirname, 'out', testInfo.project.name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const frames: { file: string; at: number }[] = [];
  await page.screencast.start({
    size: { width: 2880, height: 1520 }, // demo.config.ts's 1440x760 window at 2x
    quality: 100,
    onFrame: ({ data, timestamp }) => {
      const file = `${String(frames.length).padStart(5, '0')}.jpg`;
      writeFileSync(join(dir, file), data);
      frames.push({ file, at: timestamp });
    },
  });
  await page.waitForTimeout(1000);

  await startCli('leo', SCENARIO);
  await startCli('maya', SCENARIO);
  try {
    // maya's agent's fix waits as a draft: hold on its diff long enough to read, then she sends it.
    const draft = page.getByRole('region', { name: /^Draft: Your agent wants to push fixes/ });
    const added = draft.locator('[data-kind="add"]');
    await expect(added).toContainText('export const pageSize = 25;', { timeout: 60_000 });
    await added.scrollIntoViewIfNeeded();
    await page.waitForTimeout(3500);
    await draft.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText('Both points settled.')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/Waiting for leo's approval/)).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(4000);
  } finally {
    await stopCli('maya');
    await stopCli('leo');
  }
  const end = Date.now();
  await page.screencast.stop();

  // Frames only arrive when the page changes, so each one lasts until the next (timestamps are ms since the epoch).
  const lines = ['ffconcat version 1.0'];
  frames.forEach((f, i) => lines.push(`file ${f.file}`, `duration ${((frames[i + 1]?.at ?? end) - f.at) / 1000}`));
  lines.push(`file ${frames.at(-1)!.file}`);
  writeFileSync(join(dir, 'frames.txt'), `${lines.join('\n')}\n`);
});
