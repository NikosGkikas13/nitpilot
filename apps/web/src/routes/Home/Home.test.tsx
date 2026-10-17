import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, renderApp, type Answer } from '../../test/render';

const me = { id: 'u1', githubId: '1001', login: 'maya', avatarUrl: null, githubAuth: 'ok', agentOnline: true, settings: { autoReview: true, autoAddress: true, dailyJobCap: 40 }, usedToday: 0 };
const noRows = (): Answer => [200, { rows: [] }];

afterEach(() => vi.unstubAllGlobals());

describe('Home', () => {
  it('tells a screen reader it is loading while /api/me has not answered', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    renderApp('/');
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
  });

  it('shows the landing page to someone who is not signed in', async () => {
    fakeApi({ 'GET /api/me': (): Answer => [401, { error: { code: 'unauthorized', message: 'Sign in with GitHub first.' } }] });
    renderApp('/');
    expect(await screen.findByRole('link', { name: /Sign in with GitHub/ })).toBeInTheDocument();
  });

  it('opens the inbox for someone who is signed in', async () => {
    fakeApi({ 'GET /api/me': (): Answer => [200, me], 'GET /api/inbox': noRows });
    renderApp('/');
    expect(await screen.findByRole('region', { name: 'Inbox' })).toBeInTheDocument();
  });

  it('shows the error with a way to try again, instead of a blank page', async () => {
    let calls = 0;
    // The first try and the client's two retries (no waiting between them in tests) fail; "Try again" then succeeds.
    fakeApi({
      'GET /api/me': (): Answer => (++calls <= 3 ? [500, { error: { code: 'server_error', message: 'internal server error' } }] : [200, me]),
      'GET /api/inbox': noRows,
    });
    renderApp('/');
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('region', { name: 'Inbox' })).toBeInTheDocument();
  });
});
