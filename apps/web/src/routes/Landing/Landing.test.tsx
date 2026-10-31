import { QueryClientProvider } from '@tanstack/react-query';
import { render as renderBare, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeQueryClient } from '../../app';
import { chatResponse } from '../../test/chat';
import { fakeApi, renderApp, type Answer } from '../../test/render';
import { Landing } from './Landing';

/** The landing page on its own, with a data cache and a router; the server answers 404 to everything unless a test says. */
function render(ui: ReactNode) {
  const client = makeQueryClient({ retryDelay: 0 });
  return renderBare(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => fakeApi({}));
afterEach(() => vi.unstubAllGlobals());

describe('Landing', () => {
  it('pitches Nitpilot and starts GitHub sign-in, coming back to the home page', () => {
    render(<Landing />);
    expect(screen.getByRole('heading', { level: 1, name: "Your agents review each other's PRs the moment they open." })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Sign in with GitHub/ })).toHaveAttribute('href', '/auth/github/login?next=%2F');
  });

  it('links to the docs site', () => {
    render(<Landing />);
    expect(screen.getByRole('link', { name: 'Docs' })).toHaveAttribute('href', '/docs');
  });

  it('explains how it works in three steps', () => {
    render(<Landing />);
    const steps = screen.getByRole('region', { name: 'How it works' });
    expect(steps.querySelectorAll('h2')).toHaveLength(3);
  });

  it('keeps the sample inbox out of the accessibility tree', () => {
    render(<Landing />);
    expect(screen.queryByText('Fix race in session refresh')?.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('shows the chat clip, silent and hidden from screen readers, with a caption that says the run is scripted', () => {
    const { container } = render(<Landing />);
    const video = container.querySelector('video')!;
    expect(video.muted).toBe(true);
    expect(video).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText(/A scripted run with made-up teammates/)).toBeInTheDocument();
  });

  it('does not make a screen reader say the arrow in the GitHub link', () => {
    render(<Landing />);
    expect(screen.getByRole('link', { name: 'GitHub' })).toBeInTheDocument();
  });

  it('keeps the whole page body, steps included, in one main landmark', () => {
    render(<Landing />);
    const main = screen.getByRole('main');
    expect(within(main).getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(within(main).getByRole('heading', { level: 2, name: 'You make the call' })).toBeInTheDocument();
  });
});

describe('Run a demo', () => {
  const signedOut = (): Answer => [401, { error: { code: 'unauthorized', message: 'Sign in first.' } }];
  const health = (demo?: boolean) => (): Answer => [200, { ok: true, version: '0.5.0', ...(demo === undefined ? {} : { demo }) }];

  it('is hidden unless the server says the demo is on', async () => {
    for (const demo of [undefined, false]) {
      const fetch = fakeApi({ 'GET /api/me': signedOut, 'GET /healthz': health(demo) });
      const { unmount } = renderApp('/');
      await screen.findByRole('heading', { level: 1 });
      await vi.waitFor(() => expect(fetch.mock.calls.map(([url]) => String(url))).toContain('/healthz'));
      expect(screen.queryByRole('button', { name: 'Run a demo' })).not.toBeInTheDocument();
      unmount();
    }
  });

  it("opens a demo PR, waits for its chat to start, then shows it", async () => {
    let answerPost: (answer: Answer) => void = () => {};
    let chatAsks = 0;
    const fetch = fakeApi({
      'GET /api/me': signedOut,
      'GET /healthz': health(true),
      'POST /api/demo': () => new Promise<Answer>((resolve) => (answerPost = resolve)),
      // The first look comes before GitHub's webhook made the chat.
      'GET /api/public/chats/acme/playground/7': (): Answer =>
        ++chatAsks === 1 ? [404, { error: { code: 'not_found', message: 'no such chat' } }] : [200, chatResponse({ view: { title: 'Demo: receipt' } })],
    });
    renderApp('/');
    await userEvent.click(await screen.findByRole('button', { name: 'Run a demo' }));
    expect(screen.getByRole('button', { name: 'Opening a demo PR…' })).toBeDisabled();
    answerPost([200, { url: 'http://localhost:8787/c/acme/playground/7' }]);
    expect(await screen.findByRole('button', { name: 'Starting the demo…' })).toBeDisabled();
    expect(await screen.findByRole('region', { name: 'PR chat: Demo: receipt' }, { timeout: 4000 })).toBeInTheDocument();
    expect(fetch.mock.calls.filter(([url]) => String(url) === '/api/demo')).toHaveLength(1);
  });

  it('says why when the demo can\'t start, and the button works again', async () => {
    fakeApi({
      'GET /api/me': signedOut,
      'GET /healthz': health(true),
      'POST /api/demo': (): Answer => [429, { error: { code: 'rate_limited', message: 'Too many demos from here. Try again in an hour.' } }],
    });
    renderApp('/');
    await userEvent.click(await screen.findByRole('button', { name: 'Run a demo' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't start the demo. Too many demos from here. Try again in an hour.");
    expect(screen.getByRole('button', { name: 'Run a demo' })).toBeEnabled();
  });
});
