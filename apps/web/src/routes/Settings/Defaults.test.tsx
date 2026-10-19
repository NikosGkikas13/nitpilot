import type { Settings, WebMe } from '@nitpilot/protocol';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from '../../test/push';
import { fakeViewport, renderApp, type Answer } from '../../test/render';
import { sent, serveSettings, settingsMe } from '../../test/settings';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The server answers a save with what it saved (the body it got), unless `answer` says otherwise. */
function serve(opts: { me?: WebMe; answer?: (body: Settings) => Answer | Promise<Answer> } = {}) {
  let current = opts.me ?? settingsMe;
  return serveSettings({
    me: (): Answer => [200, current],
    routes: {
      'PUT /api/me/settings': async (): Promise<Answer> => {
        const body = JSON.parse(String(fetchMock.mock.calls.at(-1)![1]!.body)) as Settings;
        const answer = opts.answer ? await opts.answer(body) : ([200, body] as Answer);
        if (answer[0] === 200) current = { ...current, settings: answer[1] as Settings };
        return answer;
      },
    },
  });
}
let fetchMock: ReturnType<typeof serveSettings>;

async function openDefaults(opts: Parameters<typeof serve>[0] = {}) {
  fakeViewport(true);
  fakeBrowser();
  fetchMock = serve(opts);
  const app = renderApp('/settings');
  const section = within(await screen.findByRole('region', { name: 'Defaults for new chats' }));
  // The page asks for you again when it opens (usedToday may have moved): let that settle first.
  await waitFor(() => expect(meReads()).toBeGreaterThanOrEqual(2));
  return { ...app, section };
}

const meReads = () => fetchMock.mock.calls.filter(([url]) => String(url) === '/api/me').length;
const saves = () => sent(fetchMock, '/api/me/settings').map((s) => JSON.parse(s.slice('PUT '.length)) as Settings);

describe('Defaults (handoff §7 "Defaults for new chats")', () => {
  it('shows your Auto defaults, the daily cap and what your CLIs used today', async () => {
    const { section } = await openDefaults();
    expect(section.getByRole('switch', { name: 'Auto-review' })).toHaveAttribute('aria-checked', 'true');
    expect(section.getByRole('switch', { name: 'Auto-fix' })).toHaveAttribute('aria-checked', 'false');
    expect(section.getByText('Your agent reviews as soon as you are requested')).toBeInTheDocument();
    expect(section.getByText('Off: fixes wait as drafts for you to send')).toBeInTheDocument();
    expect(section.getByText('Max 40 agent runs per day · 12 used today')).toBeInTheDocument();
    expect(section.getByTestId('usage-bar')).toHaveStyle({ width: '30%' });
    expect(section.getByTestId('usage-bar')).not.toHaveAttribute('data-full');
  });

  it('steps the cap by 5 and saves every press at once, with the whole of your settings', async () => {
    const { section, queryClient } = await openDefaults();
    await userEvent.click(section.getByRole('button', { name: 'Raise cap' }));
    expect(await section.findByText('Max 45 agent runs per day · 12 used today')).toBeInTheDocument();
    await waitFor(() => expect(queryClient.getQueryData<WebMe>(['me'])?.settings.dailyJobCap).toBe(45));
    await userEvent.click(section.getByRole('button', { name: 'Lower cap' }));
    await userEvent.click(section.getByRole('button', { name: 'Lower cap' }));
    await waitFor(() => expect(queryClient.getQueryData<WebMe>(['me'])?.settings.dailyJobCap).toBe(35));
    expect(saves()).toEqual([
      { autoReview: true, autoAddress: false, dailyJobCap: 45 },
      { autoReview: true, autoAddress: false, dailyJobCap: 40 },
      { autoReview: true, autoAddress: false, dailyJobCap: 35 },
    ]);
  });

  it('stops at 5 and at 200', async () => {
    const low = await openDefaults({ me: { ...settingsMe, settings: { ...settingsMe.settings, dailyJobCap: 10 } } });
    await userEvent.click(low.section.getByRole('button', { name: 'Lower cap' }));
    expect(await low.section.findByText(/^Max 5 agent runs per day/)).toBeInTheDocument();
    const lower = low.section.getByRole('button', { name: 'Lower cap' });
    await waitFor(() => expect(lower).toHaveAttribute('aria-disabled', 'true'));
    // aria-disabled, not disabled: the button keeps focus at the end of its range, and a press sends nothing.
    lower.focus();
    await userEvent.click(lower);
    expect(lower).toHaveFocus();
    expect(saves().map((s) => s.dailyJobCap)).toEqual([5]);
    low.unmount();

    const high = await openDefaults({ me: { ...settingsMe, usedToday: 0, settings: { ...settingsMe.settings, dailyJobCap: 200 } } });
    expect(high.section.getByRole('button', { name: 'Raise cap' })).toHaveAttribute('aria-disabled', 'true');
    expect(high.section.getByRole('button', { name: 'Lower cap' })).not.toHaveAttribute('aria-disabled');
    await userEvent.click(high.section.getByRole('button', { name: 'Raise cap' }));
    expect(saves()).toEqual([]);
  });

  it('announces the new cap to a screen reader (a polite live region)', async () => {
    const { section } = await openDefaults();
    const value = section.getByText('40', { selector: 'output, span' });
    expect(value).toHaveAttribute('aria-live', 'polite');
  });

  it('saves a switch at once, and it shows the saved value', async () => {
    const { section, queryClient } = await openDefaults();
    const autoFix = section.getByRole('switch', { name: 'Auto-fix' });
    await userEvent.click(autoFix);
    await waitFor(() => expect(queryClient.getQueryData<WebMe>(['me'])?.settings.autoAddress).toBe(true));
    expect(autoFix).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(section.getByRole('switch', { name: 'Auto-review' }));
    await waitFor(() => expect(section.getByRole('switch', { name: 'Auto-review' })).toHaveAttribute('aria-checked', 'false'));
    expect(saves()).toEqual([
      { autoReview: true, autoAddress: true, dailyJobCap: 40 },
      { autoReview: false, autoAddress: true, dailyJobCap: 40 },
    ]);
  });

  it('keeps all three controls busy while a save is on its way, and ignores presses meanwhile', async () => {
    let finish: () => void = () => {};
    const { section } = await openDefaults({ answer: (body) => new Promise<Answer>((resolve) => (finish = () => resolve([200, body]))) });
    await userEvent.click(section.getByRole('button', { name: 'Raise cap' }));
    for (const control of [section.getByRole('switch', { name: 'Auto-review' }), section.getByRole('switch', { name: 'Auto-fix' }), section.getByRole('group', { name: 'Daily job cap' })]) {
      expect(control).toHaveAttribute('aria-busy', 'true');
    }
    await userEvent.click(section.getByRole('button', { name: 'Raise cap' }));
    await userEvent.click(section.getByRole('switch', { name: 'Auto-fix' }));
    finish();
    await waitFor(() => expect(section.getByRole('switch', { name: 'Auto-fix' })).not.toHaveAttribute('aria-busy'));
    expect(saves()).toHaveLength(1);
  });

  it('does not let a read of you that was already on its way overwrite the cap you just saved', async () => {
    let release: () => void = () => {};
    let held = false;
    let current = settingsMe;
    fetchMock = serveSettings({
      me: async (): Promise<Answer> => {
        const stale = current;
        // The third read (after the page's own two) is the slow one: it carries what the server had before the save.
        if (meReads() === 3 && !held) {
          held = true;
          await new Promise<void>((resolve) => (release = resolve));
        }
        return [200, stale];
      },
      routes: {
        'PUT /api/me/settings': async (): Promise<Answer> => {
          const body = JSON.parse(String(fetchMock.mock.calls.at(-1)![1]!.body)) as Settings;
          current = { ...current, settings: body };
          return [200, body];
        },
      },
    });
    fakeViewport(true);
    fakeBrowser();
    const app = renderApp('/settings');
    const section = within(await screen.findByRole('region', { name: 'Defaults for new chats' }));
    await waitFor(() => expect(meReads()).toBeGreaterThanOrEqual(2));
    // A read starts (a me.update or focus refetch would do this) ...
    void app.queryClient.invalidateQueries({ queryKey: ['me'] });
    await waitFor(() => expect(held).toBe(true));
    // ... and the save lands while it is still on its way.
    await userEvent.click(section.getByRole('button', { name: 'Raise cap' }));
    await waitFor(() => expect(app.queryClient.getQueryData<WebMe>(['me'])?.settings.dailyJobCap).toBe(45));
    release();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(app.queryClient.getQueryData<WebMe>(['me'])?.settings.dailyJobCap).toBe(45);
    expect(section.getByText(/^Max 45 agent runs per day/)).toBeInTheDocument();
  });

  it('says why a save was refused, goes back to what the server has, and asks for it again', async () => {
    const { section } = await openDefaults({ answer: () => [400, { error: { code: 'bad_request', message: 'dailyJobCap: Too big' } }] });
    const before = meReads();
    await userEvent.click(section.getByRole('button', { name: 'Raise cap' }));
    expect(await screen.findByText('dailyJobCap: Too big')).toBeInTheDocument();
    expect(section.getByText('Max 40 agent runs per day · 12 used today')).toBeInTheDocument();
    await waitFor(() => expect(meReads()).toBeGreaterThan(before));
  });

  it('turns the usage bar amber once today reaches the cap, and never past full', async () => {
    const { section } = await openDefaults({ me: { ...settingsMe, usedToday: 52, settings: { ...settingsMe.settings, dailyJobCap: 50 } } });
    expect(section.getByTestId('usage-bar')).toHaveStyle({ width: '100%' });
    expect(section.getByTestId('usage-bar')).toHaveAttribute('data-full', 'true');
  });
});
