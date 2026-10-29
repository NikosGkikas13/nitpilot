/**
 * The demo video: the real web app and server (the e2e harness), with made-up teammates and the fake agent following
 * demo.json, recorded by Playwright. Not part of the test suite. To re-record (Postgres running, web app built):
 *   cd apps/web && npx playwright test -c demo/demo.config.ts
 *   ffmpeg -i demo/out/demo-demo-demo/video.webm -c:v libx264 -crf 18 -pix_fmt yuv420p -movflags +faststart demo/demo.mp4
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { openPr, resetChats, signIn, startCli, stopCli } from '../e2e/control';

// Relative to apps/cli/src/agents/fake/scenarios, where the harness looks.
const SCENARIO = '../../../../../web/demo/demo.json';

/** A caption bar at the bottom of the page, plus a visible cursor (the video shows no mouse). Survives reloads. */
async function addOverlay(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const style = `
      #demo-badge { position: fixed; right: 16px; bottom: 12px; z-index: 99999; pointer-events: none;
        font: 500 12px/1 system-ui, sans-serif; color: #555; background: rgba(255,255,255,.85); padding: 6px 10px; border-radius: 8px; }
      #demo-caption { position: fixed; left: 50%; bottom: 96px; transform: translateX(-50%); z-index: 99999;
        background: rgba(17,17,17,.88); color: #fff; font: 600 22px/1.35 system-ui, sans-serif; padding: 14px 26px;
        border-radius: 14px; max-width: 1100px; text-align: center; transition: opacity .35s; pointer-events: none; }
      #demo-cursor { position: fixed; width: 22px; height: 22px; border-radius: 50%; z-index: 100000; pointer-events: none;
        background: rgba(255,90,60,.55); border: 2px solid rgba(255,90,60,.95); transform: translate(-50%,-50%);
        transition: left .6s ease, top .6s ease; left: -40px; top: -40px; }`;
    addEventListener('DOMContentLoaded', () => {
      const s = document.createElement('style');
      s.textContent = style;
      document.head.append(s);
      for (const id of ['demo-caption', 'demo-cursor']) {
        const el = document.createElement('div');
        el.id = id;
        document.body.append(el);
      }
      const badge = document.createElement('div');
      badge.id = 'demo-badge';
      badge.textContent = 'Demo with made-up teammates and scripted agents';
      document.body.append(badge);
      const saved = sessionStorage.getItem('demo-caption');
      const cap = document.getElementById('demo-caption')!;
      cap.textContent = saved ?? '';
      cap.style.opacity = saved ? '1' : '0';
    });
  });
}

async function caption(page: Page, text: string, holdMs = 3000): Promise<void> {
  await page.evaluate((t) => {
    sessionStorage.setItem('demo-caption', t);
    const cap = document.getElementById('demo-caption');
    if (cap) {
      cap.textContent = t;
      cap.style.opacity = '1';
    }
  }, text);
  await page.waitForTimeout(holdMs);
}

/** Glide the fake cursor to an element and hover it. */
async function pointAt(page: Page, target: Locator): Promise<void> {
  const box = (await target.boundingBox())!;
  await page.evaluate(({ x, y }) => {
    const c = document.getElementById('demo-cursor')!;
    c.style.left = `${x}px`;
    c.style.top = `${y}px`;
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await page.waitForTimeout(900);
  await target.hover();
}

/** Glide the fake cursor to an element, pause, then click it. */
async function clickSlowly(page: Page, target: Locator): Promise<void> {
  await pointAt(page, target);
  await target.click();
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const c = document.getElementById('demo-cursor');
    if (c) c.style.left = '-40px';
  });
}

test('demo', async ({ page, context }) => {
  await resetChats();
  await addOverlay(page);

  // 1. The pitch.
  await page.goto('/');
  await page.waitForTimeout(800);
  await caption(page, 'Nitpilot: your team’s Claude Code agents review each other’s PRs.', 4000);
  await caption(page, 'People only hear about it when there’s a decision to make.', 3500);

  // 2. Maya opens a PR; Leo is the reviewer, and his agent isn't running yet.
  await signIn(context, 'maya');
  await openPr({ number: 42, title: 'Cursor pagination for orders', author: 'maya', reviewer: 'leo' });
  await page.goto('/');
  await caption(page, 'Maya opens a pull request on GitHub and asks Leo for a review.', 3000);
  await clickSlowly(page, page.getByRole('tab', { name: 'Mine' }));
  const row = page.getByRole('listbox', { name: 'Pull requests' }).getByRole('option').first();
  await expect(row).toContainText('Cursor pagination for orders');
  await caption(page, 'It shows up in her Nitpilot inbox right away.', 2500);
  await clickSlowly(page, row);
  await expect(page.getByRole('heading', { level: 1, name: 'Cursor pagination for orders' })).toBeVisible();

  // 3. The agents work it out between them.
  await startCli('leo', SCENARIO);
  await startCli('maya', SCENARIO);
  try {
    await caption(page, 'Leo’s agent picks up the review on his laptop…', 500);
    await expect(page.getByText("leo's agent is reviewing…")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Two points: the page size, and the README.')).toBeVisible({ timeout: 20_000 });
    await caption(page, '…and posts two points.', 2500);
    await caption(page, 'Maya’s agent fixes the code and answers each point. No one had to step in.', 500);
    await expect(page.getByText('Fixed the page size, answered the README point.')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    await caption(page, 'Leo’s agent checks the fix and settles both points.', 500);
    await expect(page.getByText('Both points settled.')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(2000);

    // 4. Only now is a person needed: Leo approves.
    await signIn(context, 'leo');
    await page.reload();
    await expect(page.getByText('Ready for your approval')).toBeVisible({ timeout: 15_000 });
    await caption(page, 'Leo gets one notification: the PR is ready for his approval.', 3500);
    await pointAt(page, page.getByRole('link', { name: /Approve on GitHub/ }));
    await caption(page, 'He reads the summary and approves on GitHub. That’s it.', 3500);
    await caption(page, 'nitpilot.dev · open source · npm install -g nitpilot', 4000);
  } finally {
    await stopCli('maya');
    await stopCli('leo');
  }
});
