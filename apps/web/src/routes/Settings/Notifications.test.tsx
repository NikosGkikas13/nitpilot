import type { WebMe } from '@nitpilot/protocol';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HOME_SCREEN_SHEET_SEEN_KEY } from '../../components/IosHomeScreenSheet/IosHomeScreenSheet';
import * as subscribe from '../../push/subscribe';
import { ENDPOINT, fakeBrowser, SAFARI_IPHONE, VAPID_KEY } from '../../test/push';
import { fakeViewport, renderApp, type Answer } from '../../test/render';
import { sent, serveSettings, settingsMe } from '../../test/settings';

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function notifications() {
  return within(await screen.findByRole('region', { name: 'Notifications' }));
}

const PUSH = { name: 'Push notifications' };

describe('Notifications (handoff §7): the push switch for this browser', () => {
  it('turns push on for this browser, and the page knows you are subscribed', async () => {
    fakeViewport(true);
    const browser = fakeBrowser();
    const fetch = serveSettings();
    const { queryClient } = renderApp('/settings');
    const section = await notifications();
    expect(section.getByText("Only when you're needed: approvals, escalations, failures")).toBeInTheDocument();
    const toggle = await section.findByRole('switch', PUSH);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(toggle);
    await waitFor(() => expect(section.getByRole('switch', PUSH)).toHaveAttribute('aria-checked', 'true'));
    expect(browser.pushManager.current).not.toBeNull();
    expect(sent(fetch, '/api/push/subscriptions')).toHaveLength(1);
    expect(queryClient.getQueryData<WebMe>(['me'])?.push.subscribed).toBe(true);
  });

  it('is busy while it works, and not after reading the push state fails', async () => {
    fakeViewport(true);
    fakeBrowser();
    serveSettings();
    renderApp('/settings');
    const toggle = await (await notifications()).findByRole('switch', PUSH);
    // The first read (page load) worked; the one after the press fails.
    vi.spyOn(subscribe, 'pushState').mockRejectedValueOnce(new Error('boom'));
    await userEvent.click(toggle);
    await waitFor(() => expect(toggle).not.toHaveAttribute('aria-busy'));
  });

  it('turns it off again, and asks the server whether you still have a subscription elsewhere', async () => {
    fakeViewport(true);
    const browser = fakeBrowser({ permission: 'granted' });
    await browser.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: new Uint8Array([4]) });
    const fetch = serveSettings({ me: { ...settingsMe, push: { vapidPublicKey: VAPID_KEY, subscribed: true } } });
    renderApp('/settings');
    const section = await notifications();
    await waitFor(() => expect(section.getByRole('switch', PUSH)).toHaveAttribute('aria-checked', 'true'));
    const reads = fetch.mock.calls.filter(([url]) => String(url) === '/api/me').length;
    await userEvent.click(section.getByRole('switch', PUSH));
    await waitFor(() => expect(section.getByRole('switch', PUSH)).toHaveAttribute('aria-checked', 'false'));
    expect(sent(fetch, '/api/push/subscriptions')).toEqual([`DELETE ${JSON.stringify({ endpoint: ENDPOINT })}`]);
    await waitFor(() => expect(fetch.mock.calls.filter(([url]) => String(url) === '/api/me').length).toBeGreaterThan(reads));
  });

  it("says what went wrong when the server doesn't take the subscription", async () => {
    fakeViewport(true);
    fakeBrowser();
    serveSettings({ routes: { 'POST /api/push/subscriptions': (): Answer => [400, { error: { code: 'bad_request', message: 'endpoint: must be an https address of a push service' } }] } });
    renderApp('/settings');
    const section = await notifications();
    await userEvent.click(await section.findByRole('switch', PUSH));
    expect(await section.findByRole('alert')).toHaveTextContent('endpoint: must be an https address of a push service');
    expect(section.getByRole('switch', PUSH)).toHaveAttribute('aria-checked', 'false');
  });

  it.each([
    ['denied', { permission: 'denied' } as const, "Blocked in your browser's settings. Allow notifications for this site there, then reload this page."],
    ['unsupported', { serviceWorker: false } as const, "This browser can't show push notifications."],
  ])('explains %s instead of offering the switch', async (_state, browser, text) => {
    fakeViewport(true);
    fakeBrowser(browser);
    serveSettings();
    renderApp('/settings');
    const section = await notifications();
    expect(await section.findByText(text)).toBeInTheDocument();
    expect(section.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('says so when this server has no push keys', async () => {
    fakeViewport(true);
    fakeBrowser();
    serveSettings({ me: { ...settingsMe, push: { vapidPublicKey: null, subscribed: false } } });
    renderApp('/settings');
    const section = await notifications();
    expect(await section.findByText("Push isn't set up on this server.")).toBeInTheDocument();
    expect(section.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('shows the iPhone tip outside the Home Screen app, with a way to the steps', async () => {
    fakeViewport(false);
    fakeBrowser({ userAgent: SAFARI_IPHONE, maxTouchPoints: 5, pushManager: false });
    localStorage.setItem(HOME_SCREEN_SHEET_SEEN_KEY, '1');
    serveSettings();
    renderApp('/settings');
    const section = await notifications();
    expect(await section.findByText(/Add Nitpilot to your Home Screen to get notifications\. In Safari, tap Share, then Add to Home Screen\./)).toBeInTheDocument();
    expect(section.queryByRole('switch')).not.toBeInTheDocument();
    await userEvent.click(section.getByRole('button', { name: 'Show me how' }));
    expect(screen.getByRole('dialog', { name: 'Add Nitpilot to your Home Screen' })).toBeInTheDocument();
  });
});
