import type { WebMe } from '@nitpilot/protocol';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pretendIphone, VAPID_KEY } from '../../test/push';
import { fakeApi, fakeViewport, renderApp, type Answer } from '../../test/render';
import { HOME_SCREEN_SHEET_SEEN_KEY } from './IosHomeScreenSheet';

const me: WebMe = { id: 'u1', githubId: '1001', login: 'maya', avatarUrl: null, githubAuth: 'ok', agentOnline: true, settings: { autoReview: true, autoAddress: true, dailyJobCap: 40 }, usedToday: 0, push: { vapidPublicKey: VAPID_KEY, subscribed: false } };

function serve() {
  fakeApi({ 'GET /api/me': (): Answer => [200, me], 'GET /api/inbox': (): Answer => [200, { rows: [] }] });
}

const NAME = 'Add Nitpilot to your Home Screen';
let restore: () => void = () => {};

beforeEach(() => {
  localStorage.clear();
  fakeViewport(false);
  serve();
});

afterEach(() => {
  restore();
  vi.unstubAllGlobals();
});

describe('IosHomeScreenSheet (handoff §9 "iOS Home Screen hint")', () => {
  it('opens once after sign-in on an iPhone outside the Home Screen app, with its three steps, focus on Got it', async () => {
    restore = pretendIphone();
    renderApp('/');
    const sheet = await screen.findByRole('dialog', { name: NAME });
    expect(sheet).toHaveAttribute('aria-modal', 'true');
    expect(sheet).toHaveAccessibleDescription('On iPhone, notifications only work from the Home Screen app.');
    const steps = within(sheet).getAllByRole('listitem');
    expect(steps.map((step) => step.textContent)).toEqual(["1Tap Share in Safari's toolbar", '2Choose Add to Home Screen', '3Open Nitpilot from there and allow notifications']);
    const gotIt = within(sheet).getByRole('button', { name: 'Got it' });
    expect(gotIt).toHaveFocus();
    // Focus stays inside while it's open.
    await userEvent.tab();
    expect(gotIt).toHaveFocus();
    await userEvent.click(gotIt);
    expect(screen.queryByRole('dialog', { name: NAME })).not.toBeInTheDocument();
  });

  it('is remembered: the next visit goes straight to the inbox', async () => {
    restore = pretendIphone();
    const first = renderApp('/');
    await userEvent.click(within(await screen.findByRole('dialog', { name: NAME })).getByRole('button', { name: 'Got it' }));
    first.unmount();
    renderApp('/');
    expect(await screen.findByRole('region', { name: 'Inbox' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: NAME })).not.toBeInTheDocument();
  });

  it('Esc closes it without leaving the page; so does a tap on the dimmed page behind', async () => {
    restore = pretendIphone();
    renderApp('/settings');
    await screen.findByRole('dialog', { name: NAME });
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: NAME })).not.toBeInTheDocument();
    // On a phone Esc also means "back to the inbox"; the sheet keeps it.
    expect(screen.getByRole('heading', { name: 'Signed in as @maya' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Show me how' }));
    await userEvent.click(screen.getByTestId('sheet-backdrop'));
    expect(screen.queryByRole('dialog', { name: NAME })).not.toBeInTheDocument();
  });

  it('keeps Esc working after a click on the sheet itself (the click moves focus into the dialog, not out to the page)', async () => {
    restore = pretendIphone();
    renderApp('/settings');
    const sheet = await screen.findByRole('dialog', { name: NAME });
    // jsdom doesn't move focus on a click; this is what the browser does for a click on text inside a tabindex=-1 element.
    await userEvent.click(within(sheet).getByText('On iPhone, notifications only work from the Home Screen app.'));
    expect(sheet).toHaveAttribute('tabindex', '-1');
    act(() => sheet.focus());
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: NAME })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Signed in as @maya' })).toBeInTheDocument();
  });

  it('opens again from Settings, and gives focus back to the button that opened it', async () => {
    restore = pretendIphone();
    localStorage.setItem(HOME_SCREEN_SHEET_SEEN_KEY, '1');
    renderApp('/settings');
    const showMe = await screen.findByRole('button', { name: 'Show me how' });
    expect(screen.queryByRole('dialog', { name: NAME })).not.toBeInTheDocument();
    await userEvent.click(showMe);
    await userEvent.click(within(screen.getByRole('dialog', { name: NAME })).getByRole('button', { name: 'Got it' }));
    expect(showMe).toHaveFocus();
  });

  it('never opens on its own anywhere else: another browser, or the Home Screen app itself', async () => {
    const first = renderApp('/');
    expect(await screen.findByRole('region', { name: 'Inbox' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: NAME })).not.toBeInTheDocument();
    first.unmount();

    restore = pretendIphone({ homeScreenApp: true });
    renderApp('/');
    expect(await screen.findByRole('region', { name: 'Inbox' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: NAME })).not.toBeInTheDocument();
  });
});
