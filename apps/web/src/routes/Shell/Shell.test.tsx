import type { WebMe } from '@nitpilot/protocol';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatRoutes } from '../../test/chat';
import { VAPID_KEY } from '../../test/push';
import { fakeApi, fakeViewport, renderApp, type Answer } from '../../test/render';

// Everything real except the re-send of this browser's push subscription, which would need a browser.
const resyncPush = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../../push/subscribe', async (original) => ({ ...(await original<typeof import('../../push/subscribe')>()), resyncPush }));

const me: WebMe = { id: 'u1', githubId: '1001', login: 'maya', avatarUrl: null, githubAuth: 'ok', agentOnline: true, settings: { autoReview: true, autoAddress: true, dailyJobCap: 40 }, usedToday: 0, push: { vapidPublicKey: null, subscribed: false }, onboarded: true };

function serve() {
  fakeApi({
    'GET /api/me': (): Answer => [200, me],
    'GET /api/inbox': (): Answer => [200, { rows: [] }],
    'GET /api/devices': (): Answer => [200, { devices: [] }],
    ...chatRoutes([{ repo: 'acme/shop-api', number: 139, title: 'Fix race in session refresh' }]),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  resyncPush.mockClear();
});

describe('Shell (handoff "App shell and layout")', () => {
  it("re-sends this browser's push subscription once after sign-in, when the server has push keys", async () => {
    fakeViewport(true);
    fakeApi({ 'GET /api/me': (): Answer => [200, { ...me, push: { vapidPublicKey: VAPID_KEY, subscribed: false } }], 'GET /api/inbox': (): Answer => [200, { rows: [] }] });
    renderApp('/');
    await screen.findByRole('region', { name: 'Inbox' });
    expect(resyncPush).toHaveBeenCalledTimes(1);
    expect(resyncPush).toHaveBeenCalledWith(VAPID_KEY);
  });

  it("doesn't re-send anything on a server without push keys", async () => {
    fakeViewport(true);
    serve();
    renderApp('/');
    await screen.findByRole('region', { name: 'Inbox' });
    expect(resyncPush).not.toHaveBeenCalled();
  });

  it('shows the inbox beside the open page on a desktop', async () => {
    fakeViewport(true);
    serve();
    renderApp('/');
    expect(await screen.findByRole('region', { name: 'Inbox' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pick a pull request' })).toBeInTheDocument();
  });

  it('shows one pane on a phone: the inbox at /, the page elsewhere, and Esc goes back', async () => {
    fakeViewport(false);
    serve();
    renderApp('/c/acme/shop-api/139');
    expect(await screen.findByRole('heading', { name: 'Fix race in session refresh' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Inbox' })).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(await screen.findByRole('region', { name: 'Inbox' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Fix race in session refresh' })).not.toBeInTheDocument();
  });

  it('opens Settings from your avatar, as a page of its own (no inbox beside it), with Sign out', async () => {
    fakeViewport(true);
    serve();
    renderApp('/');
    await userEvent.click(await screen.findByRole('link', { name: 'Settings · maya' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Inbox' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });
});
