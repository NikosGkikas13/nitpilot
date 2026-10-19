import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as subscribe from '../../push/subscribe';
import { ENDPOINT, fakeBrowser } from '../../test/push';
import { fakeViewport, renderApp } from '../../test/render';
import { sent, serveSettings, settingsMe } from '../../test/settings';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const SECTIONS = ['Devices', 'Agent', 'Notifications', 'Defaults for new chats', 'Account'];

describe('Settings (handoff §7): the page', () => {
  it('is a page of its own on a desktop: "‹ Inbox", the title, the section nav and the five sections, without the inbox', async () => {
    fakeViewport(true);
    fakeBrowser();
    serveSettings();
    renderApp('/settings');
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '‹ Inbox' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('region', { name: 'Inbox' })).not.toBeInTheDocument();
    const nav = within(screen.getByRole('navigation', { name: 'Settings sections' }));
    expect(nav.getAllByRole('link').map((a) => a.textContent)).toEqual(['Devices', 'Agent', 'Notifications', 'Defaults', 'Account']);
    expect(nav.getByRole('link', { name: 'Devices' })).toHaveAttribute('aria-current', 'true');
    for (const name of SECTIONS) expect(screen.getByRole('region', { name })).toBeInTheDocument();
  });

  it('highlights the section you pick in the nav', async () => {
    fakeViewport(true);
    fakeBrowser();
    serveSettings();
    renderApp('/settings');
    const nav = within(await screen.findByRole('navigation', { name: 'Settings sections' }));
    await userEvent.click(nav.getByRole('link', { name: 'Defaults' }));
    expect(nav.getByRole('link', { name: 'Defaults' })).toHaveAttribute('aria-current', 'true');
    expect(nav.getByRole('link', { name: 'Devices' })).not.toHaveAttribute('aria-current');
    expect(nav.getByRole('link', { name: 'Defaults' })).toHaveAttribute('href', '#defaults');
  });

  it('moves focus to the heading of the section you pick in the nav, so a keyboard or screen reader user lands there', async () => {
    fakeViewport(true);
    fakeBrowser();
    serveSettings();
    renderApp('/settings');
    const nav = within(await screen.findByRole('navigation', { name: 'Settings sections' }));
    await userEvent.click(nav.getByRole('link', { name: 'Defaults' }));
    expect(screen.getByRole('heading', { name: 'Defaults for new chats' })).toHaveFocus();
  });

  it('goes back to the inbox with "‹ Inbox"', async () => {
    fakeViewport(true);
    fakeBrowser();
    serveSettings();
    renderApp('/settings');
    await userEvent.click(await screen.findByRole('link', { name: '‹ Inbox' }));
    expect(await screen.findByRole('region', { name: 'Inbox' })).toBeInTheDocument();
  });

  it('stacks the cards on a phone, with no nav, and Esc goes back to the inbox', async () => {
    fakeViewport(false);
    fakeBrowser();
    serveSettings();
    renderApp('/settings');
    expect(await screen.findByRole('region', { name: 'Devices' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Settings sections' })).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(await screen.findByRole('region', { name: 'Inbox' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Settings' })).not.toBeInTheDocument();
  });

  it('asks for you again when it opens, so the usage today is fresh', async () => {
    fakeViewport(true);
    fakeBrowser();
    const fetch = serveSettings();
    renderApp('/settings');
    await screen.findByRole('region', { name: 'Defaults for new chats' });
    await waitFor(() => expect(fetch.mock.calls.filter(([url]) => String(url) === '/api/me').length).toBe(2));
  });

  it('reads the devices again when the server says something about you changed (me.update)', async () => {
    fakeViewport(true);
    fakeBrowser();
    const fetch = serveSettings();
    const { sockets } = renderApp('/settings');
    await screen.findByRole('region', { name: 'Devices' });
    await waitFor(() => expect(sent(fetch, '/api/devices')).toHaveLength(1));
    sockets.last().receive({ v: 1, t: 'me.update', d: { me: settingsMe } });
    await waitFor(() => expect(sent(fetch, '/api/devices')).toHaveLength(2));
  });
});

describe('Settings: finishing setup', () => {
  it('offers the setup checklist at the top until you have finished it', async () => {
    fakeViewport(true);
    fakeBrowser();
    serveSettings({ me: { ...settingsMe, onboarded: false } });
    renderApp('/settings');
    const card = within(await screen.findByRole('region', { name: 'Finish setting up' }));
    expect(card.getByRole('link', { name: 'Open the checklist' })).toHaveAttribute('href', '/setup');
  });

  it('is gone once you have', async () => {
    fakeViewport(true);
    fakeBrowser();
    serveSettings();
    renderApp('/settings');
    await screen.findByRole('region', { name: 'Devices' });
    expect(screen.queryByRole('region', { name: 'Finish setting up' })).not.toBeInTheDocument();
  });
});

describe('Account (handoff §7)', () => {
  it('shows who you are on GitHub', async () => {
    fakeViewport(true);
    fakeBrowser();
    serveSettings();
    renderApp('/settings');
    const account = within(await screen.findByRole('region', { name: 'Account' }));
    expect(account.getByRole('img', { name: 'maya' })).toHaveTextContent('MA');
    expect(account.getByText('maya')).toBeInTheDocument();
    expect(account.getByText('github.com/maya')).toBeInTheDocument();
  });

  it("signs out after removing this browser's push subscription, so a shared browser stops getting your notifications", async () => {
    fakeViewport(true);
    const browser = fakeBrowser({ permission: 'granted' });
    await browser.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: new Uint8Array([4]) });
    const fetch = serveSettings();
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {});
    renderApp('/settings');
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(browser.pushManager.current).toBeNull();
    expect(sent(fetch, '/api/push/subscriptions')).toEqual([`DELETE ${JSON.stringify({ endpoint: ENDPOINT })}`]);
    expect(submit.mock.contexts[0]).toHaveAttribute('action', '/auth/logout');
    expect(submit.mock.contexts[0]).toHaveAttribute('method', 'post');
  });

  it('ignores a second press while it is signing out', async () => {
    fakeViewport(true);
    fakeBrowser({ permission: 'granted' });
    serveSettings();
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
    serveSettings();
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {});
    renderApp('/settings');
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  });
});
