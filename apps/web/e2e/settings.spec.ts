import { expect, test } from '@playwright/test';
import { addDevice, resetChats, signIn } from './control';

// The Settings page against the real server (spec §16, handoff §7). /reset puts the daily cap back to 40.
test.beforeEach(async () => {
  await resetChats();
});
test.afterAll(async () => {
  await resetChats();
});

test('the daily cap stepper saves at once, and the new cap is still there after a reload', async ({ page, context }) => {
  await signIn(context, 'maya');
  await page.goto('/settings');
  const defaults = page.getByRole('region', { name: 'Defaults for new chats' });
  await expect(defaults.getByText(/^Max 40 agent runs per day · \d+ used today$/)).toBeVisible();
  const saved = page.waitForResponse((res) => res.url().endsWith('/api/me/settings') && res.request().method() === 'PUT');
  await defaults.getByRole('button', { name: 'Raise cap' }).click();
  expect((await saved).status()).toBe(200);
  await expect(defaults.getByText(/^Max 45 agent runs per day/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Defaults for new chats' }).getByText(/^Max 45 agent runs per day/)).toBeVisible();
});

test('a computer is revoked from the Devices section, and is gone for good', async ({ page, context }) => {
  await addDevice({ login: 'maya', name: 'maya-linux-desk', lastSeenAt: new Date(Date.now() - 3 * 86_400_000).toISOString(), agent: { id: 'claude-code', version: '2.1.290' } });
  await signIn(context, 'maya');
  await page.goto('/settings');
  const devices = page.getByRole('region', { name: 'Devices' });
  await expect(devices.getByText('maya-linux-desk')).toBeVisible();
  await expect(devices.getByText('Last seen 3 days ago')).toBeVisible();
  await devices.getByRole('button', { name: 'Revoke maya-linux-desk' }).click();
  await expect(page.getByText('Revoked. That computer has to log in again.')).toBeVisible();
  await expect(devices.getByText('maya-linux-desk')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Devices' })).toBeVisible();
  await expect(page.getByText('maya-linux-desk')).toHaveCount(0);
});
