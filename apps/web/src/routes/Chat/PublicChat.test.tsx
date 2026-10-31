import type { ChatResponse } from '@nitpilot/protocol';
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatResponse, item, point } from '../../test/chat';
import { fakeApi, fakeViewport, renderApp, type Answer } from '../../test/render';

const leo = { githubId: '1002', login: 'leo' };
const PATH = '/c/acme/shop-api/142';

/** maya's PR on a public repo, as the server shows it to someone signed out: no role, no permissions, no drafts. */
const PUBLIC: ChatResponse = chatResponse({
  view: {
    phase: 'escalated',
    round: 2,
    viewer: { role: null, attention: 'none', failure: null, failureReason: null },
    permissions: { note: false, resolve: [], continue: [], review: false, retry: false, auto: [], drafts: [] },
    points: [point({ status: 'escalated', escalationReason: 'category', category: 'security', severity: 'blocker', title: 'SQL built from input' }), point({ number: 2, severity: 'nit', title: 'Rename cursor' })],
  },
  items: [
    item(1, { body: 'Pull request opened by maya' }),
    item(2, { kind: 'job_summary', author: leo, body: 'Reviewed 6 files and raised 2 points.', data: { counts: { blocker: 1, nit: 1 } } }),
    item(3, { kind: 'point_raised', author: leo, pointNumber: 1 }),
    item(4, { kind: 'point_raised', author: leo, pointNumber: 2 }),
  ],
});

function serveSignedOut(answer: () => Answer = () => [200, PUBLIC]) {
  return fakeApi({
    'GET /api/me': (): Answer => [401, { error: { code: 'unauthorized', message: 'Sign in first.' } }],
    'GET /api/public/chats/acme/shop-api/142': answer,
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('a public chat, signed out (spec §16 "Who can see a chat")', () => {
  it('shows the points read-only, under a banner to get your own or sign in', async () => {
    fakeViewport(true);
    const fetch = serveSignedOut();
    const { sockets } = renderApp(PATH);
    const chat = await screen.findByRole('region', { name: 'PR chat: Add cursor pagination to /orders' });
    expect(chat).toHaveTextContent('Reviewed 6 files and raised 2 points.');
    expect(within(chat).getByRole('article', { name: /P1, Blocker security point, Escalated/ })).toBeInTheDocument();
    expect(within(chat).getByRole('article', { name: /P2, Nit bug point, Open/ })).toBeInTheDocument();

    const banner = screen.getByText("maya's and leo's agents reviewing this PR").closest('[role=status]') as HTMLElement;
    expect(within(banner).getByRole('link', { name: 'Get your own' })).toHaveAttribute('href', '/');
    expect(within(banner).getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/auth/github/login?next=%2Fc%2Facme%2Fshop-api%2F142');

    // Nothing to act with: no composer, no banner buttons, no Auto switch; and no socket or sign-in-only requests.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    for (const name of [/^Resolve/, /^Continue/, /^Retry/, /^Review$/, /^Send/, /^Discard/, /Load earlier/]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(sockets.all).toHaveLength(0);
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual(['/api/me', '/api/public/chats/acme/shop-api/142']);
    expect(screen.getByRole('complementary', { name: 'PR details' })).not.toHaveTextContent('Files changed');
  });

  it('shows the landing page when the server has no public chat there', async () => {
    serveSignedOut(() => [404, { error: { code: 'not_found', message: 'No such chat.' } }]);
    renderApp(PATH);
    expect(await screen.findByRole('link', { name: /Sign in with GitHub/ })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /PR chat/ })).not.toBeInTheDocument();
  });

  it('keeps the landing page for any other address', async () => {
    const fetch = serveSignedOut();
    renderApp('/settings');
    expect(await screen.findByRole('link', { name: /Sign in with GitHub/ })).toBeInTheDocument();
    // No chat read; the landing page only asks /healthz whether the demo is on.
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual(['/api/me', '/healthz']);
  });

  it('reads the chat again every 5 seconds until it settles, since a visitor has no socket', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const working = chatResponse({ view: { ...PUBLIC.view, phase: 'reviewing' }, items: [item(1, { body: 'Pull request opened by maya' })] });
      const answers: Answer[] = [
        [200, working],
        [200, { ...PUBLIC, view: { ...PUBLIC.view, phase: 'ready' } }],
      ];
      const fetch = serveSignedOut(() => answers.shift() ?? [500, {}]);
      renderApp(PATH);
      await screen.findByText('Pull request opened by maya');
      expect(screen.queryByText('Reviewed 6 files and raised 2 points.')).not.toBeInTheDocument();

      await vi.advanceTimersByTimeAsync(5_000);
      expect(await screen.findByText('Reviewed 6 files and raised 2 points.')).toBeInTheDocument();
      // Ready: nothing changes on its own now, so it stops asking.
      await vi.advanceTimersByTimeAsync(20_000);
      expect(fetch.mock.calls.filter(([url]) => String(url).startsWith('/api/public/'))).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
