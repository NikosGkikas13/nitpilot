import type { StatsResponse, WebMe } from '@nitpilot/protocol';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, renderApp, type Answer } from '../../test/render';

const me: WebMe = { id: 'u1', githubId: '1001', login: 'maya', avatarUrl: null, githubAuth: 'ok', agentOnline: true, settings: { autoReview: true, autoAddress: true, dailyJobCap: 40 }, usedToday: 0, push: { vapidPublicKey: null, subscribed: false }, onboarded: true };
const WEEK: StatsResponse = { days: 7, raised: 12, fixed: 8, declined: 2, escalated: 1, medianMsToReady: 65 * 60_000 };

function serve(stats: () => Answer | Promise<Answer>) {
  return fakeApi({
    'GET /api/me': (): Answer => [200, me],
    'GET /api/inbox': (): Answer => [200, { rows: [] }],
    'GET /api/me/stats': stats,
  });
}

/** Each stat as "label: number", the way a screen reader pairs them. */
async function stats() {
  const row = await screen.findByRole('region', { name: /Your agent, last/ });
  return within(row)
    .getAllByRole('term')
    .map((term) => `${term.textContent}: ${term.nextElementSibling?.textContent}`);
}

afterEach(() => vi.unstubAllGlobals());

describe('Inbox stats row', () => {
  it('shows raised, fixed, escalated and the median time to ready for the last 7 days', async () => {
    const fetch = serve(() => [200, WEEK]);
    renderApp('/');
    await screen.findByText('12');
    expect(await stats()).toEqual(['Raised: 12', 'Fixed: 8', 'Escalated: 1', 'To readyMedian time to ready: 1 h 5 min']);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/me/stats?days=7'), expect.anything());
  });

  it('switches to 30 days', async () => {
    const fetch = serve(() => [200, { ...WEEK, days: 30, raised: 40 }]);
    renderApp('/');
    await screen.findByText('40');
    await userEvent.click(screen.getByRole('button', { name: 'Last 30 days' }));
    expect(screen.getByRole('button', { name: 'Last 30 days' })).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByRole('region', { name: 'Your agent, last 30 days' })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/me/stats?days=30'), expect.anything());
  });

  it('shows zeros and a dash when nothing happened yet', async () => {
    serve(() => [200, { days: 7, raised: 0, fixed: 0, declined: 0, escalated: 0, medianMsToReady: null }]);
    renderApp('/');
    const row = await screen.findByRole('region', { name: 'Your agent, last 7 days' });
    expect(await within(row).findAllByText('0')).toHaveLength(3);
    expect(within(row).getByText('none yet')).toBeInTheDocument();
  });

  it('hides itself when the server fails, and the inbox still shows', async () => {
    serve(() => [500, { error: { code: 'internal', message: 'boom' } }]);
    renderApp('/');
    expect(await screen.findByText('All quiet.')).toBeInTheDocument();
    await vi.waitFor(() => expect(screen.queryByRole('region', { name: /Your agent, last/ })).not.toBeInTheDocument());
  });
});
