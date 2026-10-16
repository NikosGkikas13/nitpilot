import type { InboxRow, WebMe } from '@nitpilot/protocol';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, renderApp, type Answer } from '../../test/render';

const me: WebMe = { id: 'u1', githubId: '1001', login: 'maya', avatarUrl: null, githubAuth: 'ok', agentOnline: true };

function row(over: Partial<InboxRow>): InboxRow {
  return {
    chatId: 'chat', repo: 'acme/shop-api', number: 1, title: 'A PR', url: 'https://github.com/acme/shop-api/pull/1', role: 'reviewer',
    other: { login: 'sam', avatarUrl: null, agentActive: false }, status: { kind: 'quiet', who: null, reason: null },
    round: 1, maxRounds: 3, lastActivity: '', updatedAt: '2026-10-15T10:00:00.000Z', unread: 0, needsYou: false, ...over,
  };
}

const ROWS: InboxRow[] = [
  row({ chatId: 'r144', number: 144, title: 'Refactor webhook retries', status: { kind: 'waiting', who: 'maya', reason: 'offline' }, updatedAt: '2026-10-15T18:11:00.000Z' }),
  row({ chatId: 'r139', number: 139, title: 'Fix race in session refresh', status: { kind: 'escalated', who: null, reason: 'decision' }, needsYou: true, unread: 2, lastActivity: 'P1 needs a human decision', round: 2 }),
  row({ chatId: 'm147', number: 147, role: 'author', title: 'Bump Prisma to 7.2', other: { login: 'leo', avatarUrl: null, agentActive: true }, status: { kind: 'working', who: 'leo', reason: null } }),
];

function serve(opts: { me?: Partial<WebMe>; rows?: InboxRow[] } = {}) {
  return fakeApi({
    'GET /api/me': (): Answer => [200, { ...me, ...opts.me }],
    'GET /api/inbox': (): Answer => [200, { rows: opts.rows ?? ROWS }],
  });
}

const list = async () => within(await screen.findByRole('listbox', { name: 'Pull requests' }));
const titles = async () => (await list()).getAllByRole('option').map((o) => within(o).getByTestId('title').textContent);

afterEach(() => vi.unstubAllGlobals());

describe('Inbox (handoff §1)', () => {
  it('opens on the tab that needs you, with the rows that need you first', async () => {
    serve();
    renderApp('/');
    expect(await screen.findByRole('tab', { name: /To review/ })).toHaveAttribute('aria-selected', 'true');
    expect(await titles()).toEqual(['Fix race in session refresh', 'Refactor webhook retries']);
    expect(within(screen.getByRole('tab', { name: /To review/ })).getByText('1 need you')).toBeInTheDocument();
  });

  it("shows each row's repo and number, pill, last activity, round and unread dot", async () => {
    serve();
    renderApp('/');
    const first = (await list()).getAllByRole('option')[0]!;
    expect(first).toHaveTextContent('acme/shop-api #139');
    expect(within(first).getByText('Needs you')).toBeInTheDocument();
    expect(first).toHaveTextContent('P1 needs a human decision');
    expect(within(first).getByText('Round 2 of 3')).toBeInTheDocument();
    expect(within(first).getByLabelText('Unread')).toBeInTheDocument();
  });

  it('switches to Mine, where the other side’s agent badge shows', async () => {
    serve();
    renderApp('/');
    await userEvent.click(await screen.findByRole('tab', { name: /Mine/ }));
    expect(await titles()).toEqual(['Bump Prisma to 7.2']);
    expect(screen.getByRole('img', { name: "leo's agent is active" })).toBeInTheDocument();
    expect(screen.getByText("leo's agent working")).toBeInTheDocument();
  });

  it('says your agent is offline, with the command to copy', async () => {
    serve({ me: { agentOnline: false } });
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(async () => {}) } });
    renderApp('/');
    expect(await screen.findByText('Your agent is offline')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Copy nitpilot start' }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('nitpilot start');
    expect(screen.getByRole('button', { name: 'Copy nitpilot start' })).toHaveTextContent('Copied');
  });

  it('asks to reconnect GitHub when the sign-in expired, and stays quiet when all is well', async () => {
    serve({ me: { githubAuth: 'needs_reauth' } });
    renderApp('/');
    expect(await screen.findByRole('alert')).toHaveTextContent('GitHub sign-in expired');
    expect(screen.getByRole('link', { name: 'Reconnect' })).toHaveAttribute('href', '/auth/github/login?next=%2F');
    expect(screen.queryByText('Your agent is offline')).not.toBeInTheDocument();
  });

  it('asks to reconnect GitHub when the inbox itself answers 401, with the server’s words and no retry', async () => {
    const message = "Your GitHub sign-in expired, so Nitpilot can't check which repos you can see. Sign in again.";
    fakeApi({
      'GET /api/me': (): Answer => [200, me],
      'GET /api/inbox': (): Answer => [401, { error: { code: 'unauthorized', message } }],
    });
    renderApp('/');
    expect(await screen.findByRole('alert')).toHaveTextContent('GitHub sign-in expired');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Reconnect' })).toBeInTheDocument();
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('searches, and says when nothing matches', async () => {
    serve();
    renderApp('/');
    await userEvent.type(await screen.findByRole('textbox', { name: 'Search pull requests' }), 'webhook');
    expect(await titles()).toEqual(['Refactor webhook retries']);
    await userEvent.type(screen.getByRole('textbox', { name: 'Search pull requests' }), 'zzz');
    expect(screen.getByText('No matches')).toBeInTheDocument();
    expect(screen.getByText('No pull requests match “webhookzzz”.')).toBeInTheDocument();
  });

  it('filters by status, and counts the filters on the button', async () => {
    serve();
    renderApp('/');
    await userEvent.click(await screen.findByRole('button', { name: 'Filter' }));
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Waiting' }));
    expect(await titles()).toEqual(['Refactor webhook retries']);
    expect(screen.getByRole('button', { name: 'Filter · 1' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('is all quiet when there is nothing', async () => {
    serve({ rows: [] });
    renderApp('/');
    expect(await screen.findByText('All quiet.')).toBeInTheDocument();
    expect(screen.getByText("Nitpilot will ping you when you're needed.")).toBeInTheDocument();
  });

  it('opens a chat by click, and by j and Enter', async () => {
    serve();
    renderApp('/');
    await userEvent.click((await list()).getAllByRole('option')[1]!);
    expect(await screen.findByRole('heading', { name: 'Refactor webhook retries' })).toBeInTheDocument();
    expect((await list()).getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('j{Enter}');
    expect(await screen.findByRole('heading', { name: 'Fix race in session refresh' })).toBeInTheDocument();
  });

  it('shows the error with a way to try again', async () => {
    let calls = 0;
    fakeApi({
      'GET /api/me': (): Answer => [200, me],
      'GET /api/inbox': (): Answer => (++calls <= 3 ? [500, { error: { code: 'server_error', message: 'internal server error' } }] : [200, { rows: ROWS }]),
    });
    renderApp('/');
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await titles()).toHaveLength(2);
  });

  it('keeps the tab it opened on when a refetch would pick the other one', async () => {
    let rows = ROWS;
    fakeApi({ 'GET /api/me': (): Answer => [200, me], 'GET /api/inbox': (): Answer => [200, { rows }] });
    const { queryClient } = renderApp('/');
    // Wait for the first answer (the tabs show before it arrives).
    expect(await titles()).toHaveLength(2);
    expect(screen.getByRole('tab', { name: /To review/ })).toHaveAttribute('aria-selected', 'true');
    // Now it is the Mine row that needs you, so a fresh default would be Mine.
    rows = [ROWS[0]!, { ...ROWS[1]!, needsYou: false }, { ...ROWS[2]!, needsYou: true }];
    await act(() => queryClient.invalidateQueries({ queryKey: ['inbox'] }));
    expect(await screen.findByRole('tab', { name: /Mine/ })).toHaveTextContent('1 need you');
    expect(screen.getByRole('tab', { name: /To review/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('puts the focus back on Filter when Esc closes the menu', async () => {
    serve();
    renderApp('/');
    const filter = await screen.findByRole('button', { name: 'Filter' });
    await userEvent.click(filter);
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Waiting' }));
    expect(screen.getByRole('menuitemcheckbox', { name: 'Waiting' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filter · 1' })).toHaveFocus();
  });

  it('names the filter menu’s two groups', async () => {
    serve();
    renderApp('/');
    await userEvent.click(await screen.findByRole('button', { name: 'Filter' }));
    const repo = screen.getByRole('group', { name: 'Repo' });
    const status = screen.getByRole('group', { name: 'Status' });
    expect(within(repo).getAllByRole('menuitemcheckbox').map((i) => i.textContent)).toEqual(['acme/shop-api']);
    expect(within(status).getAllByRole('menuitemcheckbox').map((i) => i.textContent)).toEqual(['Needs you', 'Agent working', 'Waiting', 'Their turn', 'Ready', 'Closed']);
  });
});
