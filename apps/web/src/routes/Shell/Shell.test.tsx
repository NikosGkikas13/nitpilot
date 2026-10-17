import type { WebMe } from '@nitpilot/protocol';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatRoutes } from '../../test/chat';
import { fakeApi, fakeViewport, renderApp, type Answer } from '../../test/render';

const me: WebMe = { id: 'u1', githubId: '1001', login: 'maya', avatarUrl: null, githubAuth: 'ok', agentOnline: true };

function serve() {
  fakeApi({
    'GET /api/me': (): Answer => [200, me],
    'GET /api/inbox': (): Answer => [200, { rows: [] }],
    ...chatRoutes([{ repo: 'acme/shop-api', number: 139, title: 'Fix race in session refresh' }]),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('Shell (handoff "App shell and layout")', () => {
  it('shows the inbox beside the open page on a desktop', async () => {
    fakeViewport(true);
    serve();
    renderApp('/');
    expect(await screen.findByRole('region', { name: 'Inbox' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pick a pull request' })).toBeInTheDocument();
  });

  it('shows one pane on a phone: the inbox at /, the page elsewhere, and Esc goes back', async () => {
    fakeViewport(false);
    serve();
    renderApp('/c/acme/shop-api/139');
    expect(await screen.findByRole('heading', { name: 'Fix race in session refresh' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Inbox' })).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(await screen.findByRole('region', { name: 'Inbox' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Fix race in session refresh' })).not.toBeInTheDocument();
  });

  it('keeps Sign out on the Settings page, reached from your avatar', async () => {
    fakeViewport(true);
    serve();
    renderApp('/');
    await userEvent.click(await screen.findByRole('link', { name: 'Settings · maya' }));
    expect(await screen.findByRole('heading', { name: 'Signed in as @maya' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });
});
