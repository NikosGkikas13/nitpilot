import type { Onboarding } from '@nitpilot/protocol';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from '../../test/push';
import { fakeViewport, renderApp, type Answer } from '../../test/render';
import { sent, serveSettings, settingsMe } from '../../test/settings';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const NOTHING_YET: Onboarding = {
  steps: { appInstalled: false, cliConnected: false, repoLinked: false, agentStarted: false },
  done: false,
  deviceName: null,
  appSlug: 'nitpilot-dev',
  publicReposOnly: false,
};

/** maya, not set up yet, on a server whose `/api/onboarding` answers `facts()` each time it's asked. */
function serveSetup(facts: () => Onboarding) {
  fakeViewport(true);
  fakeBrowser();
  return serveSettings({ me: { ...settingsMe, onboarded: false }, routes: { 'GET /api/onboarding': (): Answer => [200, facts()] } });
}

/** The checklist's five rows, top to bottom. */
async function rows() {
  const list = await screen.findByRole('list', { name: 'Setup steps' });
  return within(list).getAllByRole('listitem');
}

describe('Setup (handoff §5): the checklist', () => {
  it('starts with only the sign-in done: the install step is next, the commands wait their turn', async () => {
    serveSetup(() => NOTHING_YET);
    renderApp('/setup');
    expect(await screen.findByRole('heading', { level: 1, name: 'Set up Nitpilot' })).toBeInTheDocument();
    expect(screen.getByText('This list ticks itself off as each step completes.')).toBeInTheDocument();
    expect(await screen.findByText('1 of 5')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Setup progress' })).toHaveAttribute('aria-valuenow', '1');

    const [signIn, install, connect, link, start] = await rows();
    expect(within(signIn!).getByRole('img', { name: 'Done' })).toBeInTheDocument();
    expect(signIn).toHaveTextContent('Sign in with GitHub');
    expect(signIn).toHaveTextContent('Signed in as @maya.');

    expect(install).toHaveAttribute('aria-current', 'step');
    expect(within(install!).getByRole('img', { name: 'In progress' })).toBeInTheDocument();
    const button = within(install!).getByRole('link', { name: 'Install on GitHub' });
    expect(button).toHaveAttribute('href', 'https://github.com/apps/nitpilot-dev/installations/new');
    expect(button).toHaveAttribute('target', '_blank');
    expect(button).toHaveAttribute('rel', 'noopener');
    expect(install).not.toHaveTextContent('public repos only');

    // Later rows show their command, but no Copy until it's their turn.
    for (const [row, n, command] of [[connect, 3, 'npx nitpilot login'], [link, 4, 'nitpilot repos add'], [start, 5, 'nitpilot start']] as const) {
      expect(within(row!).getByRole('img', { name: `Step ${n}, to do` })).toHaveTextContent(String(n));
      expect(row).toHaveTextContent(command);
      expect(within(row!).queryByRole('button')).not.toBeInTheDocument();
    }
    expect(start).toHaveTextContent('Claude Code · detected automatically');
    expect(start).toHaveTextContent('GitHub Copilot CLI · set "agent": "copilot" in the config');
    expect(start).not.toHaveTextContent('Gemini');

    expect(screen.getByRole('link', { name: 'Skip for now' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('link', { name: 'Open your inbox' })).not.toBeInTheDocument();
  });

  it('says a public-only server covers public repos only', async () => {
    serveSetup(() => ({ ...NOTHING_YET, publicReposOnly: true }));
    renderApp('/setup');
    const [, install] = await rows();
    await waitFor(() => expect(install).toHaveTextContent('nitpilot.dev covers public repos only.'));
  });

  it('names the connected computer, and gives the next command a Copy button', async () => {
    serveSetup(() => ({ ...NOTHING_YET, steps: { ...NOTHING_YET.steps, appInstalled: true, cliConnected: true }, deviceName: "Maya's MacBook Pro" }));
    // After serveSetup: its pretend browser replaces `navigator` too.
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(async () => {}) } });
    renderApp('/setup');
    expect(await screen.findByText('3 of 5')).toBeInTheDocument();
    const [, install, connect, link] = await rows();
    expect(within(install!).getByRole('img', { name: 'Done' })).toBeInTheDocument();
    expect(within(install!).queryByRole('link', { name: 'Install on GitHub' })).not.toBeInTheDocument();
    expect(connect).toHaveTextContent("✓ Connected: Maya's MacBook Pro");
    expect(connect).not.toHaveTextContent('npx nitpilot login');
    expect(link).toHaveAttribute('aria-current', 'step');
    expect(link).toHaveTextContent("Run it inside your clone. It's ticked off once nitpilot start connects.");
    const copy = within(link!).getByRole('button', { name: 'Copy nitpilot repos add' });
    await userEvent.click(copy);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('nitpilot repos add');
    expect(copy).toHaveTextContent('Copied');
  });

  it('waits for the terminal on the connect step', async () => {
    serveSetup(() => ({ ...NOTHING_YET, steps: { ...NOTHING_YET.steps, appInstalled: true } }));
    renderApp('/setup');
    const [, , connect] = await rows();
    await waitFor(() => expect(connect).toHaveAttribute('aria-current', 'step'));
    expect(connect).toHaveTextContent('Waiting for your terminal…');
    expect(within(connect!).getByRole('button', { name: 'Copy npx nitpilot login' })).toBeInTheDocument();
  });

  it('ticks itself off: a me.update reads the facts again, and the next step is up, without a reload', async () => {
    let facts: Onboarding = { ...NOTHING_YET, steps: { ...NOTHING_YET.steps, appInstalled: true } };
    const fetch = serveSetup(() => facts);
    const { sockets } = renderApp('/setup');
    expect(await screen.findByText('2 of 5')).toBeInTheDocument();
    facts = { ...facts, steps: { ...facts.steps, cliConnected: true }, deviceName: "Maya's MacBook Pro" };
    act(() => sockets.last().receive({ v: 1, t: 'me.update', d: { me: { ...settingsMe, onboarded: false } } }));
    expect(await screen.findByText('3 of 5')).toBeInTheDocument();
    const [, , connect, link] = await rows();
    expect(connect).toHaveTextContent("✓ Connected: Maya's MacBook Pro");
    expect(link).toHaveAttribute('aria-current', 'step');
    expect(sent(fetch, '/api/onboarding')).toHaveLength(2);
  });

  it("asks again when the window comes back into view (GitHub's install page is another tab)", async () => {
    let facts = NOTHING_YET;
    const fetch = serveSetup(() => facts);
    renderApp('/setup');
    expect(await screen.findByText('1 of 5')).toBeInTheDocument();
    facts = { ...NOTHING_YET, steps: { ...NOTHING_YET.steps, appInstalled: true } };
    act(() => void window.dispatchEvent(new Event('visibilitychange')));
    expect(await screen.findByText('2 of 5')).toBeInTheDocument();
    expect(sent(fetch, '/api/onboarding')).toHaveLength(2);
  });

  it('offers the inbox once every step is done', async () => {
    serveSetup(() => ({ ...NOTHING_YET, steps: { appInstalled: true, cliConnected: true, repoLinked: true, agentStarted: true }, done: true, deviceName: "Maya's MacBook Pro" }));
    renderApp('/setup');
    expect(await screen.findByText('5 of 5')).toBeInTheDocument();
    for (const row of await rows()) expect(within(row).getByRole('img', { name: 'Done' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open your inbox' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('link', { name: 'Skip for now' })).not.toBeInTheDocument();
  });

  it('goes to the inbox with "Skip for now"', async () => {
    serveSetup(() => NOTHING_YET);
    renderApp('/setup');
    await userEvent.click(await screen.findByRole('link', { name: 'Skip for now' }));
    expect(await screen.findByRole('region', { name: 'Inbox' })).toBeInTheDocument();
  });

  it('shows "Checking your setup…" while the facts are on their way', async () => {
    fakeViewport(true);
    fakeBrowser();
    serveSettings({ me: { ...settingsMe, onboarded: false }, routes: { 'GET /api/onboarding': () => new Promise<Answer>(() => {}) } });
    renderApp('/setup');
    expect(await screen.findByText('Checking your setup…')).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('list', { name: 'Setup steps' })).not.toBeInTheDocument();
  });

  it('writes onboarded: true into the cached me once the facts say done, without reading me again', async () => {
    const fetch = serveSetup(() => ({ ...NOTHING_YET, steps: { appInstalled: true, cliConnected: true, repoLinked: true, agentStarted: true }, done: true, deviceName: "Maya's MacBook Pro" }));
    const { queryClient } = renderApp('/setup');
    expect(await screen.findByText('5 of 5')).toBeInTheDocument();
    await waitFor(() => expect(queryClient.getQueryData<{ onboarded: boolean }>(['me'])?.onboarded).toBe(true));
    expect(sent(fetch, '/api/me')).toHaveLength(1);
  });

  it("says so when the checklist can't be read, and tries again", async () => {
    let fail = true;
    fakeViewport(true);
    fakeBrowser();
    serveSettings({
      me: { ...settingsMe, onboarded: false },
      routes: { 'GET /api/onboarding': (): Answer => (fail ? [500, { error: { code: 'internal', message: 'boom' } }] : [200, NOTHING_YET]) },
    });
    renderApp('/setup');
    expect(await screen.findByRole('alert', {}, { timeout: 3000 })).toHaveTextContent("Couldn't check your setup.");
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('1 of 5')).toBeInTheDocument();
  });
});
