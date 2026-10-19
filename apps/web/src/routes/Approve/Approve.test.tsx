import type { CliRequestView } from '@nitpilot/protocol';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browser } from '../../lib/browser';
import { fakeApi, fakeViewport, renderApp, type Answer } from '../../test/render';
import { sent, settingsMe } from '../../test/settings';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const CODE = 'WDJB-MJHT';
const PATH = `/cli/approve?code=${CODE}`;
const API = `/api/cli/requests/${CODE}`;

/** maya's laptop asked to log in at 18:02 (local time), with 9 minutes 41 seconds left. */
function pending(over: Partial<CliRequestView> = {}): CliRequestView {
  const requestedAt = new Date();
  requestedAt.setHours(18, 2, 0, 0);
  return {
    userCode: CODE,
    deviceName: "Maya's MacBook Pro",
    requestedAt: requestedAt.toISOString(),
    expiresAt: new Date(Date.now() + (9 * 60 + 41) * 1000).toISOString(),
    status: 'pending',
    ...over,
  };
}

type Route = () => Answer | Promise<Answer>;

/** maya, signed in, and the server's answers about the login: `view` for the read, `decide` for Approve or Deny. */
function serveApprove(opts: { view?: Route; decide?: Route; me?: Route } = {}) {
  fakeViewport(true);
  return fakeApi({
    'GET /api/me': opts.me ?? ((): Answer => [200, settingsMe]),
    [`GET ${API}`]: opts.view ?? ((): Answer => [200, pending()]),
    [`POST ${API}`]: opts.decide ?? ((): Answer => [200, pending({ status: 'approved' })]),
  });
}

const card = () => screen.findByRole('main');

describe('Approve (handoff §6): pending', () => {
  it('shows the code to compare, the device, Approve and Deny, and the time left', async () => {
    const fetch = serveApprove();
    renderApp(PATH);
    expect(await screen.findByRole('heading', { level: 1, name: 'Approve this device?' })).toBeInTheDocument();
    expect(screen.getByText('Device login')).toBeInTheDocument();
    expect(screen.getByText('Check that this code matches the one in your terminal.')).toBeInTheDocument();
    // The code is read out letter by letter, so a screen reader can compare it too.
    expect(screen.getByRole('img', { name: 'Code W D J B M J H T' })).toHaveTextContent(CODE);
    expect(screen.getByText("Maya's MacBook Pro")).toBeInTheDocument();
    expect(screen.getByText('requested 18:02')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeEnabled();
    expect(screen.getByText(/Only approve if you just ran npx nitpilot login\. The code expires in 9:4\d\./)).toBeInTheDocument();
    // A page of its own: no inbox, no socket.
    expect(sent(fetch, '/api/inbox')).toEqual([]);
  });

  it('counts down every second, and turns to expired at zero without asking the server', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetch = serveApprove({ view: (): Answer => [200, pending({ expiresAt: new Date(Date.now() + 3_000).toISOString() })] });
    renderApp(PATH);
    expect(await screen.findByText(/The code expires in 0:0[23]\./)).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByText(/The code expires in 0:0[12]\./)).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(3_000));
    expect(await screen.findByRole('heading', { level: 1, name: 'This code expired' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(sent(fetch, API)).toEqual(['GET ']);
  });
});

describe('Approve (handoff §6): deciding', () => {
  it('Approve sends the decision, keeps both buttons busy meanwhile, then shows Device approved', async () => {
    let answer!: (a: Answer) => void;
    const fetch = serveApprove({ decide: () => new Promise<Answer>((resolve) => (answer = resolve)) });
    renderApp(PATH);
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    for (const name of ['Approve', 'Deny']) {
      const button = screen.getByRole('button', { name });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('aria-busy', 'true');
    }
    expect(sent(fetch, API)).toEqual(['GET ', 'POST {"decision":"approve"}']);
    answer([200, pending({ status: 'approved' })]);
    expect(await screen.findByRole('heading', { level: 1, name: 'Device approved' })).toBeInTheDocument();
    expect(screen.getByText("Maya's MacBook Pro can now run your agent. You can close this tab.")).toBeInTheDocument();
  });

  it('Deny shows Login denied', async () => {
    const fetch = serveApprove({ decide: (): Answer => [200, pending({ status: 'denied' })] });
    renderApp(PATH);
    await userEvent.click(await screen.findByRole('button', { name: 'Deny' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Login denied' })).toBeInTheDocument();
    expect(screen.getByText("Nothing was connected. If you didn't start this login, you're all set.")).toBeInTheDocument();
    expect(sent(fetch, API)).toEqual(['GET ', 'POST {"decision":"deny"}']);
  });

  it("shows what the server says happened, even if it isn't what was pressed (decided in another tab)", async () => {
    serveApprove({ decide: (): Answer => [200, pending({ status: 'denied' })] });
    renderApp(PATH);
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Login denied' })).toBeInTheDocument();
  });

  it('a decision that fails offers Try again, which reads the login again', async () => {
    let views = 0;
    serveApprove({
      view: (): Answer => [200, pending(views++ === 0 ? {} : { status: 'approved' })],
      decide: (): Answer => [500, { error: { code: 'server_error', message: 'internal server error' } }],
    });
    renderApp(PATH);
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('internal server error');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Device approved' })).toBeInTheDocument();
  });
});

describe('Approve (handoff §6): the other states', () => {
  it('a login already approved reads Device approved, with no buttons', async () => {
    serveApprove({ view: (): Answer => [200, pending({ status: 'approved' })] });
    renderApp(PATH);
    expect(await screen.findByRole('heading', { level: 1, name: 'Device approved' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('an expired login says so, with the login command to run again', async () => {
    serveApprove({ view: (): Answer => [200, pending({ status: 'expired' })] });
    renderApp(PATH);
    expect(await screen.findByRole('heading', { level: 1, name: 'This code expired' })).toBeInTheDocument();
    expect(screen.getByText('Codes last 10 minutes. Run the login again in your terminal:')).toBeInTheDocument();
    expect(within(await card()).getByText('npx nitpilot login')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy npx nitpilot login' })).toBeInTheDocument();
  });

  it('an unknown code says Code not found, with the command to start again', async () => {
    serveApprove({ view: (): Answer => [404, { error: { code: 'not_found', message: 'No such code.' } }] });
    renderApp(PATH);
    expect(await screen.findByRole('heading', { level: 1, name: 'Code not found' })).toBeInTheDocument();
    expect(screen.getByText('Check the code in your terminal, or start again:')).toBeInTheDocument();
    expect(within(await card()).getByText('npx nitpilot login')).toBeInTheDocument();
  });

  it('no code at all says Code not found without asking the server', async () => {
    const fetch = serveApprove();
    renderApp('/cli/approve');
    expect(await screen.findByRole('heading', { level: 1, name: 'Code not found' })).toBeInTheDocument();
    expect(fetch.mock.calls.filter(([url]) => String(url).startsWith('/api/cli/requests'))).toEqual([]);
  });

  it("a read that fails (the server's down) offers Try again", async () => {
    let views = 0;
    serveApprove({ view: (): Answer => (views++ < 3 ? [503, {}] : [200, pending()]) });
    renderApp(PATH);
    expect(await screen.findByRole('alert')).toHaveTextContent('Nitpilot answered 503. Try again in a moment.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Approve this device?' })).toBeInTheDocument();
  });
});

describe('Approve: signed out', () => {
  it('goes to GitHub sign-in first, coming back to this page with its code', async () => {
    const leave = vi.spyOn(browser, 'goTo').mockImplementation(() => {});
    const fetch = serveApprove({ me: (): Answer => [401, { error: { code: 'unauthorized', message: 'Sign in with GitHub first.' } }] });
    renderApp(PATH);
    await waitFor(() => expect(leave).toHaveBeenCalledWith(`/auth/github/login?next=${encodeURIComponent(PATH)}`));
    expect(sent(fetch, API)).toEqual([]);
  });
});
