import type { ChatView, Permissions, WebMe } from '@nitpilot/protocol';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatResponse, point } from '../../test/chat';
import { fakeApi, renderApp, type Answer } from '../../test/render';

const leoMe: WebMe = { id: 'u2', githubId: '1002', login: 'leo', avatarUrl: null, githubAuth: 'ok', agentOnline: true, settings: { autoReview: true, autoAddress: true, dailyJobCap: 40 }, usedToday: 0, push: { vapidPublicKey: null, subscribed: false }, onboarded: true };
const PATH = '/c/acme/shop-api/142';
const none: Permissions = { note: true, resolve: [], continue: [], review: false, retry: false, auto: [], drafts: [] };

/** maya's PR, read by leo: P1 (leo's agent's security point) and P2 (a disagreement) need a person. */
function escalatedView(permissions: Partial<Permissions>): Partial<ChatView> {
  return {
    phase: 'escalated',
    viewer: { role: 'reviewer', attention: 'decision', failure: null },
    points: [
      point({ number: 1, status: 'escalated', escalationReason: 'category', category: 'security', severity: 'blocker', title: 'SQL built from input' }),
      point({ number: 2, status: 'escalated', escalationReason: 'disagreement', title: 'Keep the cursor opaque' }),
    ],
    permissions: { ...none, ...permissions },
  };
}

function serve(view: Partial<ChatView>, routes: Record<string, () => Answer | Promise<Answer>> = {}) {
  return fakeApi({
    'GET /api/me': (): Answer => [200, leoMe],
    'GET /api/inbox': (): Answer => [200, { rows: [] }],
    'GET /api/chats/acme/shop-api/142': (): Answer => [200, chatResponse({ view })],
    ...routes,
  });
}

const rowOf = async (id: string) => {
  const banner = await screen.findByRole('alert');
  return within(within(banner).getByText(id).closest('li')!);
};

afterEach(() => vi.unstubAllGlobals());

describe('the escalation banner (handoff §2 "Escalated")', () => {
  it('offers Resolve and Continue only on the points the server says you may', async () => {
    serve(escalatedView({ resolve: [1], continue: [1, 2] }));
    renderApp(PATH);
    const p1 = await rowOf('P1');
    expect(p1.getByRole('button', { name: 'Resolve' })).toBeInTheDocument();
    expect(p1.getByRole('button', { name: 'Continue' })).toHaveAttribute('title', 'Let the agents keep going on this point');
    const p2 = await rowOf('P2');
    expect(p2.queryByRole('button', { name: 'Resolve' })).not.toBeInTheDocument();
    expect(p2.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
  });

  it('shows no buttons to someone who may do neither', async () => {
    serve(escalatedView({}));
    renderApp(PATH);
    const banner = await screen.findByRole('alert');
    expect(within(banner).queryAllByRole('button')).toEqual([]);
  });

  it('waits while Resolve is on its way, then says it worked; the chat changes when the server says so', async () => {
    let answer: (a: Answer) => void = () => {};
    const fetch = serve(escalatedView({ resolve: [1] }), { 'POST /api/chats/chat_142/points/1/resolve': () => new Promise<Answer>((resolve) => (answer = resolve)) });
    renderApp(PATH);
    await userEvent.click((await rowOf('P1')).getByRole('button', { name: 'Resolve' }));
    const pending = (await rowOf('P1')).getByRole('button', { name: 'Resolving…' });
    expect(pending).toBeDisabled();
    await userEvent.click(pending);
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/resolve'))).toHaveLength(1);
    answer([200, { ok: true }]);
    expect(await screen.findByText('P1 resolved.')).toBeInTheDocument();
    // No optimistic update: P1 stays in the banner until the socket's chat.state says otherwise.
    expect((await rowOf('P1')).getByRole('button', { name: 'Resolve' })).toBeEnabled();
  });

  it("shows a 409's words as an error toast (Review Focus 3)", async () => {
    serve(escalatedView({ resolve: [1] }), { 'POST /api/chats/chat_142/points/1/resolve': (): Answer => [409, { error: { code: 'conflict', message: 'P1 is already resolved.' } }] });
    renderApp(PATH);
    await userEvent.click((await rowOf('P1')).getByRole('button', { name: 'Resolve' }));
    const toast = await screen.findByText('P1 is already resolved.');
    expect(toast.closest('[data-error]')).not.toBeNull();
  });

  it('refetches the chat when a press is refused as forbidden (403), so a button you may no longer press goes', async () => {
    let refused = false;
    serve(escalatedView({ resolve: [1] }), {
      'GET /api/chats/acme/shop-api/142': (): Answer => [200, chatResponse({ view: escalatedView({ resolve: refused ? [] : [1] }) })],
      'POST /api/chats/chat_142/points/1/resolve': (): Answer => {
        refused = true;
        return [403, { error: { code: 'forbidden', message: 'Only leo, who raised P1, can resolve it.' } }];
      },
    });
    renderApp(PATH);
    await userEvent.click((await rowOf('P1')).getByRole('button', { name: 'Resolve' }));
    expect(await screen.findByText('Only leo, who raised P1, can resolve it.')).toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByRole('alert')).queryByRole('button', { name: 'Resolve' })).not.toBeInTheDocument());
  });

  it('lets the agents continue, and says so', async () => {
    serve(escalatedView({ continue: [2] }), { 'POST /api/chats/chat_142/points/2/continue': (): Answer => [200, { ok: true }] });
    renderApp(PATH);
    await userEvent.click((await rowOf('P2')).getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Agents will keep going on P2.')).toBeInTheDocument();
  });
});

describe('the failure banners (handoff §2 "Failed")', () => {
  it('offers Retry when your agent failed, and says it will try again', async () => {
    const fetch = serve({ viewer: { role: 'reviewer', attention: 'failed', failure: 'agent' }, permissions: { ...none, retry: true } }, {
      'POST /api/chats/chat_142/retry': (): Answer => [200, { status: 'queued' }],
    });
    renderApp(PATH);
    expect(await screen.findByText("Your agent couldn't finish")).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Your agent will try again.')).toBeInTheDocument();
    expect(fetch.mock.calls.some(([url, init]) => String(url).endsWith('/api/chats/chat_142/retry') && init?.method === 'POST')).toBe(true);
  });

  it('says when the retry waits for the step before it', async () => {
    serve({ viewer: { role: 'reviewer', attention: 'failed', failure: 'agent' }, permissions: { ...none, retry: true } }, {
      'POST /api/chats/chat_142/retry': (): Answer => [200, { status: 'waiting' }],
    });
    renderApp(PATH);
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Your agent will try again once the step before it is done.')).toBeInTheDocument();
  });

  it('sends you to reconnect GitHub, never to Retry, when a post in your name failed', async () => {
    serve({ viewer: { role: 'reviewer', attention: 'failed', failure: 'github_post' }, permissions: { ...none, retry: true } });
    renderApp(PATH);
    expect(await screen.findByRole('link', { name: 'Reconnect GitHub' })).toHaveAttribute('href', `/auth/github/login?next=${encodeURIComponent(PATH)}`);
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });
});
