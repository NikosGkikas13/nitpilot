import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeQueryClient } from '../../app';
import { Home } from './Home';

function renderHome() {
  return render(
    <QueryClientProvider client={makeQueryClient({ retryDelay: 0 })}>
      <Home />
    </QueryClientProvider>,
  );
}

function answers(...responses: [number, unknown][]) {
  const fetch = vi.fn();
  for (const [status, body] of responses) fetch.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

afterEach(() => vi.unstubAllGlobals());

describe('Home', () => {
  it('shows the landing page to someone who is not signed in', async () => {
    answers([401, { error: { code: 'unauthorized', message: 'Sign in with GitHub first.' } }]);
    renderHome();
    expect(await screen.findByRole('link', { name: /Sign in with GitHub/ })).toBeInTheDocument();
  });

  it('greets someone who is signed in', async () => {
    answers([200, { id: 'u1', githubId: '1001', login: 'maya', avatarUrl: null, githubAuth: 'ok' }]);
    renderHome();
    expect(await screen.findByRole('heading', { name: 'Signed in as @maya' })).toBeInTheDocument();
  });

  it('shows the error with a way to try again, instead of a blank page', async () => {
    const fail: [number, unknown] = [500, { error: { code: 'server_error', message: 'internal server error' } }];
    // The first try and the client's two retries (no waiting between them in tests) fail; "Try again" then succeeds.
    answers(fail, fail, fail, [200, { id: 'u1', githubId: '1001', login: 'maya', avatarUrl: null, githubAuth: 'ok' }]);
    renderHome();
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Signed in as @maya' })).toBeInTheDocument();
  });
});
