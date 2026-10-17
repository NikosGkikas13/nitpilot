import type { ChatResponse, WebMe } from '@nitpilot/protocol';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatResponse, chatView, item, point } from '../../test/chat';
import { fakeApi, fakeViewport, renderApp, type Answer } from '../../test/render';

const me: WebMe = { id: 'u1', githubId: '1001', login: 'maya', avatarUrl: null, githubAuth: 'ok', agentOnline: true };
const maya = { githubId: '1001', login: 'maya' };
const leo = { githubId: '1002', login: 'leo' };
const PATH = '/c/acme/shop-api/142';

/** maya's PR in round 2: leo's agent reviewed it, raised two points, and one went to a person. */
const CHAT: ChatResponse = chatResponse({
  view: {
    phase: 'escalated',
    round: 2,
    points: [point({ status: 'escalated', escalationReason: 'category', category: 'security', severity: 'blocker', title: 'SQL built from input' }), point({ number: 2, severity: 'nit', title: 'Rename cursor' })],
    summaryUrl: 'https://github.com/acme/shop-api/pull/142#issuecomment-555',
  },
  items: [
    item(1, { body: 'Pull request opened by maya' }),
    item(2, { kind: 'job_summary', author: leo, body: 'Reviewed 6 files and raised 2 points.', data: { counts: { blocker: 1, nit: 1 } } }),
    item(3, { kind: 'point_raised', author: leo, pointNumber: 1 }),
    item(4, { kind: 'point_raised', author: leo, pointNumber: 2 }),
    item(5, { kind: 'human', author: maya, body: 'Keep the old endpoint working' }),
  ],
});

function serve(answer: () => Answer = () => [200, CHAT], extra: Record<string, () => Answer> = {}) {
  return fakeApi({
    'GET /api/me': (): Answer => [200, me],
    'GET /api/inbox': (): Answer => [200, { rows: [] }],
    'GET /api/chats/acme/shop-api/142': answer,
    'GET /api/chats/chat_142/files': (): Answer => [200, { files: [{ path: 'src/orders/list.ts', oldPath: null, status: 'modified', adds: 12, dels: 3 }], adds: 12, dels: 3, truncated: false }],
    'POST /api/chats/chat_142/read': (): Answer => [204, null],
    ...extra,
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('Chat (handoff §2)', () => {
  it('shows the header, the banner, the feed and the details panel', async () => {
    fakeViewport(true);
    serve();
    renderApp(PATH);
    const chat = await screen.findByRole('region', { name: 'PR chat: Add cursor pagination to /orders' });
    expect(within(chat).getByRole('heading', { level: 1, name: 'Add cursor pagination to /orders' })).toBeInTheDocument();
    expect(chat).toHaveTextContent('Author');
    expect(chat).toHaveTextContent('acme/shop-api #142');
    expect(chat).toHaveTextContent('feature/cursor-pagination → main');
    expect(chat).toHaveTextContent('Round 2 of 3');
    expect(within(chat).getByRole('link', { name: /Open on GitHub/ })).toHaveAttribute('href', 'https://github.com/acme/shop-api/pull/142');

    const alert = within(chat).getByRole('alert');
    expect(alert).toHaveTextContent('Needs a human decision');
    expect(alert).toHaveTextContent('Security points always go to a person.');
    expect(alert).toHaveTextContent('P1SQL built from input');

    expect(chat).toHaveTextContent('Pull request opened by maya');
    expect(chat).toHaveTextContent("leo's agent");
    expect(chat).toHaveTextContent('Reviewed 6 files and raised 2 points. 1 blocker · 1 nit');
    expect(within(chat).getByRole('article', { name: /P1, Blocker security point, Escalated/ })).toBeInTheDocument();
    expect(within(chat).getByRole('article', { name: /P2, Nit bug point, Open/ })).toBeInTheDocument();
    expect(chat).toHaveTextContent('Youto the agents');

    const details = screen.getByRole('complementary', { name: 'PR details' });
    expect(await within(details).findByText('src/orders/list.ts')).toBeInTheDocument();
    expect(details).toHaveTextContent('1 · +12 −3');
    expect(details).toHaveTextContent('leoReviewer');
    expect(details).toHaveTextContent('Always escalatesecurity');
    expect(within(details).getByRole('link', { name: /Summary comment on GitHub/ })).toHaveAttribute('href', 'https://github.com/acme/shop-api/pull/142#issuecomment-555');
  });

  it('hides the details panel below 1180 px; above, the header toggles it', async () => {
    fakeViewport(1000);
    serve();
    const { unmount } = renderApp(PATH);
    await screen.findByRole('region', { name: /PR chat/ });
    expect(screen.queryByRole('complementary', { name: 'PR details' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'PR details' })).not.toBeInTheDocument();
    unmount();

    fakeViewport(1280);
    renderApp(PATH);
    await userEvent.click(await screen.findByRole('button', { name: 'PR details', pressed: true }));
    expect(screen.queryByRole('complementary', { name: 'PR details' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'PR details', pressed: false }));
    expect(screen.getByRole('complementary', { name: 'PR details' })).toBeInTheDocument();
  });

  it('subscribes from its newest item and shows new items, state and progress as they arrive, without reloading', async () => {
    fakeViewport(true);
    serve();
    const { sockets } = renderApp(PATH);
    await screen.findByRole('region', { name: /PR chat/ });
    const socket = sockets.last();
    act(() => socket.open());
    expect(socket.sent).toEqual([{ v: 1, t: 'chat.subscribe', d: { chatId: 'chat_142', afterSeq: 5 } }]);

    act(() => socket.receive({ v: 1, t: 'job.progress', d: { chatId: 'chat_142', who: 'leo', action: 'reviewing', stage: 'running_agent', text: 'reading src/orders/list.ts' } }));
    expect(await screen.findByText("leo's agent is reviewing…")).toBeInTheDocument();
    expect(screen.getByText('reading src/orders/list.ts')).toBeInTheDocument();

    act(() => socket.receive({ v: 1, t: 'chat.items', d: { chatId: 'chat_142', items: [item(6, { body: 'Round 2 started' })], lastSeq: 6 } }));
    expect(await screen.findByText('Round 2 started')).toBeInTheDocument();

    act(() => socket.receive({ v: 1, t: 'chat.state', d: { chatId: 'chat_142', view: chatView({ phase: 'ready', round: 2, lastSeq: 6 }) } }));
    expect(await screen.findByText("Waiting for leo's approval")).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText("leo's agent is reviewing…")).not.toBeInTheDocument();
  });

  it('says "Nothing here" for a chat that does not exist or you cannot see', async () => {
    serve(() => [404, { error: { code: 'not_found', message: 'No such chat.' } }]);
    renderApp(PATH);
    expect(await screen.findByRole('heading', { name: 'Nothing here' })).toBeInTheDocument();
  });

  it('asks you to reconnect GitHub when your sign-in expired (Review Focus 2)', async () => {
    serve(() => [401, { error: { code: 'reauth', message: 'Sign in with GitHub again to see this chat.' } }]);
    renderApp(PATH);
    expect(await screen.findByRole('heading', { name: 'Sign in with GitHub again' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Reconnect GitHub' })).toHaveAttribute('href', `/auth/github/login?next=${encodeURIComponent(PATH)}`);
  });

  it('asks the server again when the socket says you lost access, and shows "Nothing here"', async () => {
    let gone = false;
    serve(() => (gone ? [404, { error: { code: 'not_found', message: 'No such chat.' } }] : [200, CHAT]));
    const { sockets } = renderApp(PATH);
    await screen.findByRole('region', { name: /PR chat/ });
    gone = true;
    act(() => sockets.last().receive({ v: 1, t: 'chat.error', d: { chatId: 'chat_142', code: 'not_found' } }));
    expect(await screen.findByRole('heading', { name: 'Nothing here' })).toBeInTheDocument();
  });

  it('loads earlier items on request', async () => {
    serve(() => [200, chatResponse({ items: [item(201, { body: 'newer' })], hasOlder: true })], {
      'GET /api/chats/chat_142/messages': (): Answer => [200, { items: [item(200, { body: 'older' })], hasOlder: false }],
    });
    renderApp(PATH);
    await userEvent.click(await screen.findByRole('button', { name: 'Load earlier' }));
    expect(await screen.findByText('older')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load earlier' })).not.toBeInTheDocument();
  });

  it('marks the chat read up to its newest item, for someone in it', async () => {
    const fetch = serve();
    renderApp(PATH);
    await screen.findByRole('region', { name: /PR chat/ });
    await waitFor(() => expect(fetch.mock.calls.some(([url, init]) => String(url).endsWith('/read') && init?.method === 'POST')).toBe(true), { timeout: 2_000 });
    const [, init] = fetch.mock.calls.find(([url]) => String(url).endsWith('/read'))!;
    expect(JSON.parse(String(init!.body))).toEqual({ seq: 5 });
  });

  it('has a way back to the inbox on a phone', async () => {
    fakeViewport(false);
    serve();
    renderApp(PATH);
    await screen.findByRole('region', { name: /PR chat/ });
    expect(screen.getByRole('link', { name: 'Back to inbox' })).toHaveAttribute('href', '/');
  });
});
