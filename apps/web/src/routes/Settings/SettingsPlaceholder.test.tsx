import type { WebMe } from '@nitpilot/protocol';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HOME_SCREEN_SHEET_SEEN_KEY } from '../../components/IosHomeScreenSheet/IosHomeScreenSheet';
import { ENDPOINT, fakeBrowser, SAFARI_IPHONE, VAPID_KEY } from '../../test/push';
import { fakeApi, fakeViewport, renderApp, type Answer } from '../../test/render';
import * as subscribe from '../../push/subscribe';

const me: WebMe = { id: 'u1', githubId: '1001', login: 'maya', avatarUrl: null, githubAuth: 'ok', agentOnline: true, settings: { autoReview: true, autoAddress: true, dailyJobCap: 40 }, usedToday: 0, push: { vapidPublicKey: VAPID_KEY, subscribed: false } };

/** The server: you, an empty inbox, and the push routes (`push` answers both). */
function serve(opts: { me?: WebMe; push?: () => Answer | Promise<Answer> } = {}) {
  const push = opts.push ?? ((): Answer => [200, { ok: true }]);
  return fakeApi({
    'GET /api/me': (): Answer => [200, opts.me ?? me],
    'GET /api/inbox': (): Answer => [200, { rows: [] }],
    'POST /api/push/subscriptions': push,
    'DELETE /api/push/subscriptions': push,
  });
}

/** The requests sent to a path, as "METHOD body". */
function sent(fetch: ReturnType<typeof fakeApi>, path: string): string[] {
  return fetch.mock.calls.filter(([url]) => String(url) === path).map(([, init]) => `${init?.method ?? 'GET'} ${String(init?.body ?? '')}`);
}

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SettingsPlaceholder: the push switch until Task 21', () => {
  it('turns push on for this browser, and the page knows you are subscribed', async () => {
    fakeViewport(true);
    const browser = fakeBrowser();
    const fetch = serve();
    const { queryClient } = renderApp('/settings');
    expect(await screen.findByText('Off for this browser.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Turn push on' }));
    expect(await screen.findByText("On: this browser gets a notification when you're needed.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn push off' })).toBeInTheDocument();
    expect(browser.pushManager.current).not.toBeNull();
    expect(sent(fetch, '/api/push/subscriptions')).toHaveLength(1);
    expect(queryClient.getQueryData<WebMe>(['me'])?.push.subscribed).toBe(true);
  });

  it("doesn't stay busy when reading the push state fails afterwards", async () => {
    fakeViewport(true);
    fakeBrowser();
    serve();
    renderApp('/settings');
    const button = await screen.findByRole('button', { name: 'Turn push on' });
    // The first read (page load) worked; the one after the click fails.
    vi.spyOn(subscribe, 'pushState').mockRejectedValueOnce(new Error('boom'));
    await userEvent.click(button);
    await waitFor(() => expect(screen.getByRole('button', { name: /Turn push/ })).toBeEnabled());
  });

  it('turns it off again', async () => {
    fakeViewport(true);
    const browser = fakeBrowser({ permission: 'granted' });
    await browser.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: new Uint8Array([4]) });
    const fetch = serve({ me: { ...me, push: { vapidPublicKey: VAPID_KEY, subscribed: true } } });
    renderApp('/settings');
    await userEvent.click(await screen.findByRole('button', { name: 'Turn push off' }));
    expect(await screen.findByRole('button', { name: 'Turn push on' })).toBeInTheDocument();
    expect(sent(fetch, '/api/push/subscriptions')).toEqual([`DELETE ${JSON.stringify({ endpoint: ENDPOINT })}`]);
    // This browser can't know whether your other devices are still subscribed: the page asks the server again.
    await waitFor(() => expect(fetch.mock.calls.filter(([url]) => String(url) === '/api/me').length).toBeGreaterThan(1));
  });

  it("says what went wrong when the server doesn't take the subscription", async () => {
    fakeViewport(true);
    fakeBrowser();
    serve({ push: (): Answer => [400, { error: { code: 'bad_request', message: 'endpoint: must be an https address of a push service' } }] });
    renderApp('/settings');
    await userEvent.click(await screen.findByRole('button', { name: 'Turn push on' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('endpoint: must be an https address of a push service');
    expect(screen.getByRole('button', { name: 'Turn push on' })).toBeInTheDocument();
  });

  it.each([
    ['denied', { permission: 'denied' } as const, "Notifications are blocked for this site. Allow them in your browser's site settings, then reload this page."],
    ['unsupported', { serviceWorker: false } as const, "This browser can't show push notifications."],
  ])('explains %s instead of offering the switch', async (_state, browser, text) => {
    fakeViewport(true);
    fakeBrowser(browser);
    serve();
    renderApp('/settings');
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Turn push/ })).not.toBeInTheDocument();
  });

  it("says so when this server has no push keys", async () => {
    fakeViewport(true);
    fakeBrowser();
    serve({ me: { ...me, push: { vapidPublicKey: null, subscribed: false } } });
    renderApp('/settings');
    expect(await screen.findByText("Push isn't set up on this server.")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Turn push/ })).not.toBeInTheDocument();
  });

  it("shows the iPhone tip outside the Home Screen app", async () => {
    fakeViewport(false);
    fakeBrowser({ userAgent: SAFARI_IPHONE, maxTouchPoints: 5, pushManager: false });
    localStorage.setItem(HOME_SCREEN_SHEET_SEEN_KEY, '1');
    serve();
    renderApp('/settings');
    expect(await screen.findByText(/Add Nitpilot to your Home Screen to get notifications\. In Safari, tap Share, then Add to Home Screen\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show me how' })).toBeInTheDocument();
  });
});

describe('SettingsPlaceholder: Sign out', () => {
  it("removes this browser's push subscription first, so a shared browser stops getting your notifications", async () => {
    fakeViewport(true);
    const browser = fakeBrowser({ permission: 'granted' });
    await browser.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: new Uint8Array([4]) });
    const fetch = serve();
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {});
    renderApp('/settings');
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(browser.pushManager.current).toBeNull();
    expect(sent(fetch, '/api/push/subscriptions')).toEqual([`DELETE ${JSON.stringify({ endpoint: ENDPOINT })}`]);
    expect(submit.mock.contexts[0]).toHaveAttribute('action', '/auth/logout');
  });

  it('ignores a second press while it is signing out', async () => {
    fakeViewport(true);
    fakeBrowser({ permission: 'granted' });
    serve();
    let finish: () => void = () => {};
    const wait = vi.spyOn(subscribe, 'turnPushOffBeforeSignOut').mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {});
    renderApp('/settings');
    const button = await screen.findByRole('button', { name: 'Sign out' });
    await userEvent.click(button);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(button);
    finish();
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(wait).toHaveBeenCalledTimes(1);
  });

  it('signs out all the same in a browser without push', async () => {
    fakeViewport(true);
    fakeBrowser({ serviceWorker: false });
    serve();
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {});
    renderApp('/settings');
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  });
});
