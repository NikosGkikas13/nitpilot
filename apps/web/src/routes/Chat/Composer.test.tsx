import type { InboxRow, WebMe } from '@nitpilot/protocol';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatResponse, chatView } from '../../test/chat';
import { fakeApi, fakeViewport, renderApp, type Answer } from '../../test/render';

const me: WebMe = { id: 'u1', githubId: '1001', login: 'maya', avatarUrl: null, githubAuth: 'ok', agentOnline: true, settings: { autoReview: true, autoAddress: true, dailyJobCap: 40 }, usedToday: 0, push: { vapidPublicKey: null, subscribed: false } };
const PATH = '/c/acme/shop-api/142';
const SENT = "Sent. Included in the agents' next round.";

function row(number: number, title: string): InboxRow {
  return {
    chatId: `chat_${number}`, repo: 'acme/shop-api', number, title, url: `https://github.com/acme/shop-api/pull/${number}`, role: 'author',
    other: null, status: { kind: 'quiet', who: null, reason: null }, round: 1, maxRounds: 3, lastActivity: '', updatedAt: '2026-10-16T10:00:00.000Z', unread: 0, needsYou: false,
  };
}

/** maya's PRs #142 and #143; `notes` answers a note sent in #142. */
function serve(opts: { me?: Partial<WebMe>; view?: Parameters<typeof chatView>[0]; notes?: () => Answer | Promise<Answer>; chat?: () => Answer } = {}) {
  return fakeApi({
    'GET /api/me': (): Answer => [200, { ...me, ...opts.me }],
    'GET /api/inbox': (): Answer => [200, { rows: [row(142, 'Add cursor pagination'), row(143, 'Retry webhooks')] }],
    'GET /api/chats/acme/shop-api/142': opts.chat ?? ((): Answer => [200, chatResponse({ view: { title: 'Add cursor pagination', ...opts.view } })]),
    'GET /api/chats/acme/shop-api/143': (): Answer => [200, chatResponse({ view: { id: 'chat_143', number: 143, title: 'Retry webhooks' } })],
    'POST /api/chats/chat_142/notes': opts.notes ?? ((): Answer => [200, { ok: true }]),
  });
}

const field = () => screen.findByRole('textbox', { name: 'Message the agents' });
const sentNotes = (fetch: ReturnType<typeof serve>) =>
  fetch.mock.calls.filter(([url, init]) => String(url).endsWith('/notes') && init?.method === 'POST').map(([, init]) => JSON.parse(String(init!.body)));

afterEach(() => vi.unstubAllGlobals());

describe('Composer (handoff §2 "Composer")', () => {
  it('sends with Enter, makes a new line with Shift+Enter, and says it was sent', async () => {
    const fetch = serve();
    renderApp(PATH);
    const box = await field();
    expect(box).toHaveAttribute('placeholder', 'Message the agents…');
    expect(screen.getByText('Notes are included in the agents\' next round')).toBeInTheDocument();
    await userEvent.type(box, 'Keep the old endpoint{Shift>}{Enter}{/Shift}for a release');
    expect(box).toHaveValue('Keep the old endpoint\nfor a release');
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByText(SENT)).toBeInTheDocument();
    expect(sentNotes(fetch)).toEqual([{ body: 'Keep the old endpoint\nfor a release' }]);
    expect(box).toHaveValue('');
    expect(box).toHaveFocus();
  });

  it("can't send an empty note: Send waits for text, and Enter does nothing", async () => {
    const fetch = serve();
    renderApp(PATH);
    const box = await field();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await userEvent.type(box, '   {Enter}');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await userEvent.type(box, 'x');
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    expect(sentNotes(fetch)).toEqual([]);
  });

  it('sends once while the first send is on its way, however often you press', async () => {
    let answer: (a: Answer) => void = () => {};
    const fetch = serve({ notes: () => new Promise<Answer>((resolve) => (answer = resolve)) });
    renderApp(PATH);
    await userEvent.type(await field(), 'Once{Enter}');
    await userEvent.keyboard('{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(sentNotes(fetch)).toHaveLength(1);
    answer([200, { ok: true }]);
    expect(await screen.findByText(SENT)).toBeInTheDocument();
  });

  it("keeps what you wrote when sending fails, and shows the server's words", async () => {
    serve({ notes: () => [409, { error: { code: 'conflict', message: 'This PR is closed, so its chat is read-only.' } }] });
    renderApp(PATH);
    await userEvent.type(await field(), 'Too late{Enter}');
    expect(await screen.findByText('This PR is closed, so its chat is read-only.')).toBeInTheDocument();
    expect(await field()).toHaveValue('Too late');
  });

  it.each([
    ['a merged PR', { view: { closed: true, merged: true, permissions: { note: false, resolve: [], continue: [], review: false, retry: false, auto: [], drafts: [] } } }, 'This PR was merged. The chat is read-only.'],
    ['a PR closed without merging', { view: { closed: true, merged: false, permissions: { note: false, resolve: [], continue: [], review: false, retry: false, auto: [], drafts: [] } } }, 'This PR was closed. The chat is read-only.'],
    ['an expired GitHub sign-in', { me: { githubAuth: 'needs_reauth' as const } }, 'Reconnect GitHub to send notes as yourself.'],
    ['someone reading along', { view: { viewer: { role: null, attention: 'none' as const, failure: null }, permissions: { note: false, resolve: [], continue: [], review: false, retry: false, auto: [], drafts: [] } } }, "You're reading along. Only the author and the reviewers can message the agents."],
  ])('is read-only for %s', async (_case, opts, text) => {
    serve(opts);
    renderApp(PATH);
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Message the agents' })).not.toBeInTheDocument();
  });

  it('keeps a half-written note for each chat while you look at another', async () => {
    fakeViewport(true);
    serve();
    renderApp(PATH);
    await userEvent.type(await field(), 'Half a thought');
    await userEvent.click(screen.getByRole('option', { name: /Retry webhooks/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Retry webhooks' })).toBeInTheDocument();
    expect(await field()).toHaveValue('');
    await userEvent.click(screen.getByRole('option', { name: /Add cursor pagination/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Add cursor pagination' })).toBeInTheDocument();
    expect(await field()).toHaveValue('Half a thought');
  });

  it('does not send again after you come back to a chat whose note is still on its way, and clears the draft when it lands', async () => {
    fakeViewport(true);
    let answer: (a: Answer) => void = () => {};
    const fetch = serve({ notes: () => new Promise<Answer>((resolve) => (answer = resolve)) });
    renderApp(PATH);
    await userEvent.type(await field(), 'Still going{Enter}');
    await userEvent.click(screen.getByRole('option', { name: /Retry webhooks/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Retry webhooks' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('option', { name: /Add cursor pagination/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Add cursor pagination' })).toBeInTheDocument();
    const box = await field();
    expect(box).toHaveValue('Still going');
    await userEvent.type(box, '{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(sentNotes(fetch)).toHaveLength(1);
    answer([200, { ok: true }]);
    await waitFor(() => expect(box).toHaveValue(''));
  });

  it('refreshes only this chat when a send is refused as forbidden (403), so the screen shows what you may do now', async () => {
    fakeViewport(true);
    let refused = false;
    const fetch = serve({
      chat: () => [200, chatResponse({ view: { title: 'Add cursor pagination', ...(refused ? { permissions: { note: false, resolve: [], continue: [], review: false, retry: false, auto: [], drafts: [] } } : {}) } })],
      notes: () => {
        refused = true;
        return [403, { error: { code: 'forbidden', message: "You can't message the agents in this chat." } }];
      },
    });
    const { queryClient } = renderApp(PATH);
    await userEvent.click(await screen.findByRole('option', { name: /Retry webhooks/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Retry webhooks' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('option', { name: /Add cursor pagination/ }));
    await userEvent.type(await field(), 'Hello{Enter}');
    expect(await screen.findByText("You're reading along. Only the author and the reviewers can message the agents.")).toBeInTheDocument();
    expect(queryClient.getQueryState(['chat', 'acme', 'shop-api', '143'])?.isInvalidated).toBe(false);
    expect(fetch.mock.calls.filter(([url]) => String(url) === '/api/chats/acme/shop-api/142').length).toBeGreaterThan(1);
  });

  it("leaves the other cached chats alone when a send finds this chat gone", async () => {
    fakeViewport(true);
    let gone = false;
    serve({
      chat: () => (gone ? [404, { error: { code: 'not_found', message: 'No such chat.' } }] : [200, chatResponse({ view: { title: 'Add cursor pagination' } })]),
      notes: () => {
        gone = true;
        return [404, { error: { code: 'not_found', message: 'No such chat.' } }];
      },
    });
    const { queryClient } = renderApp(PATH);
    await userEvent.click(await screen.findByRole('option', { name: /Retry webhooks/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Retry webhooks' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('option', { name: /Add cursor pagination/ }));
    await userEvent.type(await field(), 'Hello{Enter}');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Nothing here' })).toBeInTheDocument());
    expect(queryClient.getQueryState(['chat', 'acme', 'shop-api', '143'])?.isInvalidated).toBe(false);
  });

  it('asks who you are again when a send is refused as signed out (401)', async () => {
    const fetch = serve({ notes: () => [401, { error: { code: 'unauthorized', message: 'Sign in to continue.' } }] });
    renderApp(PATH);
    await userEvent.type(await field(), 'Hello{Enter}');
    expect(await screen.findByText('Sign in to continue.')).toBeInTheDocument();
    await waitFor(() => expect(fetch.mock.calls.filter(([url]) => String(url) === '/api/me').length).toBeGreaterThan(1));
  });

  it('shows "Sign in with GitHub again" when a send finds your GitHub sign-in expired', async () => {
    let expired = false;
    serve({
      chat: () => (expired ? [401, { error: { code: 'reauth', message: 'Your GitHub sign-in expired.' } }] : [200, chatResponse({ view: { title: 'Add cursor pagination' } })]),
      notes: () => {
        expired = true;
        return [401, { error: { code: 'reauth', message: 'Your GitHub sign-in expired.' } }];
      },
    });
    renderApp(PATH);
    await userEvent.type(await field(), 'Hello{Enter}');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sign in with GitHub again' })).toBeInTheDocument());
  });

  it('shows "Nothing here" when a send finds the chat gone (Review Focus 2)', async () => {
    let gone = false;
    serve({
      chat: () => (gone ? [404, { error: { code: 'not_found', message: 'No such chat.' } }] : [200, chatResponse({ view: { title: 'Add cursor pagination' } })]),
      notes: () => {
        gone = true;
        return [404, { error: { code: 'not_found', message: 'No such chat.' } }];
      },
    });
    renderApp(PATH);
    await userEvent.type(await field(), 'Hello{Enter}');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Nothing here' })).toBeInTheDocument());
  });
});
