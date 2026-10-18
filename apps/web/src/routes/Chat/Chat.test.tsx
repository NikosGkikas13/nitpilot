import type { ChatResponse, WebMe } from '@nitpilot/protocol';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatResponse, chatView, item, point } from '../../test/chat';
import { fakeApi, fakeViewport, renderApp, type Answer } from '../../test/render';

const me: WebMe = { id: 'u1', githubId: '1001', login: 'maya', avatarUrl: null, githubAuth: 'ok', agentOnline: true, settings: { autoReview: true, autoAddress: true, dailyJobCap: 40 }, usedToday: 0 };
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

function serve(answer: () => Answer | Promise<Answer> = () => [200, CHAT], extra: Record<string, () => Answer> = {}) {
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
    // The feed scrolls with ↑/↓ once focused, so it is a named, focusable region.
    expect(within(chat).getByRole('region', { name: 'Timeline' })).toHaveAttribute('tabindex', '0');

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

  it('says so when "Load earlier" fails, and lets you ask again', async () => {
    serve(() => [200, chatResponse({ items: [item(201, { body: 'newer' })], hasOlder: true })], {
      'GET /api/chats/chat_142/messages': (): Answer => [502, { error: { code: 'github_unavailable', message: "GitHub didn't answer. Try again in a minute." } }],
    });
    renderApp(PATH);
    await userEvent.click(await screen.findByRole('button', { name: 'Load earlier' }));
    expect(await screen.findByText("GitHub didn't answer. Try again in a minute.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load earlier' })).toBeEnabled();
  });

  it('says it is still trying after a first answer that failed, instead of only "Loading…"', async () => {
    let calls = 0;
    serve(() => (++calls === 1 ? [502, { error: { code: 'github_unavailable', message: "GitHub didn't answer." } }] : new Promise<Answer>(() => {})));
    renderApp(PATH);
    expect(await screen.findByText('Loading…')).toBeInTheDocument();
    expect(await screen.findByText('Still trying…')).toBeInTheDocument();
  });

  it("starts the review of an outside contributor's PR from its card", async () => {
    const fetch = serve(() => [200, chatResponse({ view: { trusted: false, viewer: { role: 'reviewer', attention: 'manual_review', failure: null }, permissions: { note: true, resolve: [], continue: [], review: true, retry: false, auto: ['reviewer'], drafts: [] } } })], {
      'POST /api/chats/chat_142/review': (): Answer => [200, { ok: true }],
    });
    renderApp(PATH);
    const card = await screen.findByRole('region', { name: 'First-time contributor' });
    await userEvent.click(within(card).getByRole('button', { name: 'Review' }));
    expect(await screen.findByText('Your agent will start the review.')).toBeInTheDocument();
    expect(fetch.mock.calls.some(([url, init]) => String(url).endsWith('/api/chats/chat_142/review') && init?.method === 'POST')).toBe(true);
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

describe('Chat: a GitHub blip does not replace a working chat', () => {
  const chatGets = (fetch: ReturnType<typeof serve>) => fetch.mock.calls.filter(([url, init]) => String(url).endsWith('/api/chats/acme/shop-api/142') && (init?.method ?? 'GET') === 'GET').length;

  it('makes no new request when the socket says GitHub could not be asked (it asks again itself)', async () => {
    const fetch = serve();
    const { sockets } = renderApp(PATH);
    await screen.findByRole('region', { name: /PR chat/ });
    const before = chatGets(fetch);
    act(() => sockets.last().receive({ v: 1, t: 'chat.error', d: { chatId: 'chat_142', code: 'unavailable' } }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(chatGets(fetch)).toBe(before);
    expect(screen.getByRole('region', { name: /PR chat/ })).toBeInTheDocument();
  });

  it('keeps the chat on screen when a background refetch answers 502', async () => {
    let down = false;
    serve(() => (down ? [502, { error: { code: 'unavailable', message: 'GitHub is not answering.' } }] : [200, CHAT]));
    const { queryClient } = renderApp(PATH);
    await screen.findByRole('region', { name: /PR chat/ });
    down = true;
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['chat'] });
    });
    await waitFor(() => expect(queryClient.getQueryState(['chat', 'acme', 'shop-api', '142'])?.status).toBe('error'));
    expect(screen.getByRole('heading', { level: 1, name: 'Add cursor pagination to /orders' })).toBeInTheDocument();
    expect(screen.getByText('Keep the old endpoint working')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });
});

describe('Chat: a REST answer and the socket (Review Focus 1)', () => {
  it('keeps an item the socket delivered while the chat was being fetched again', async () => {
    fakeViewport(true);
    let calls = 0;
    let finish: (a: Answer) => void = () => {};
    const slow = new Promise<Answer>((resolve) => (finish = resolve));
    // The first GET answers at once; the second waits until the test lets it go.
    const fetch = serve(() => [200, CHAT]);
    const original = fetch.getMockImplementation()!;
    fetch.mockImplementation(async (input, init) => {
      if (String(input).endsWith('/api/chats/acme/shop-api/142') && ++calls === 2) {
        const [status, body] = await slow;
        return new Response(JSON.stringify(body), { status });
      }
      return original(input, init);
    });
    const { sockets, queryClient } = renderApp(PATH);
    await screen.findByRole('region', { name: /PR chat/ });
    act(() => sockets.last().open());

    // A second GET starts and hangs...
    void queryClient.invalidateQueries({ queryKey: ['chat'] });
    await waitFor(() => expect(calls).toBe(2));
    // ...the socket delivers seq 6 meanwhile...
    act(() => sockets.last().receive({ v: 1, t: 'chat.items', d: { chatId: 'chat_142', items: [item(6, { body: 'Round 2 started' })], lastSeq: 6 } }));
    expect(await screen.findByText('Round 2 started')).toBeInTheDocument();
    // ...and the GET answers with what it read before seq 6 was committed.
    await act(async () => finish([200, CHAT]));
    await waitFor(() => expect(queryClient.isFetching({ queryKey: ['chat'] })).toBe(0));
    expect(screen.getByText('Round 2 started')).toBeInTheDocument();
  });

  it('keeps the pages loaded with "Load earlier" when the chat is fetched again', async () => {
    serve(() => [200, chatResponse({ items: [item(201, { body: 'newer' })], hasOlder: true })], {
      'GET /api/chats/chat_142/messages': (): Answer => [200, { items: [item(200, { body: 'older' })], hasOlder: false }],
    });
    const { queryClient } = renderApp(PATH);
    await userEvent.click(await screen.findByRole('button', { name: 'Load earlier' }));
    expect(await screen.findByText('older')).toBeInTheDocument();
    await act(async () => queryClient.invalidateQueries({ queryKey: ['chat'] }));
    // Read the cache itself: the screen redraws a moment later.
    expect(queryClient.getQueryData<ChatResponse>(['chat', 'acme', 'shop-api', '142'])).toMatchObject({ hasOlder: false });
    expect(queryClient.getQueryData<ChatResponse>(['chat', 'acme', 'shop-api', '142'])!.items.map((i) => i.seq)).toEqual([200, 201]);
    expect(screen.getByText('older')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load earlier' })).not.toBeInTheDocument();
  });
});
