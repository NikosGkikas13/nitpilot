import type { ChatView, WebMe } from '@nitpilot/protocol';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatResponse, chatView } from '../../test/chat';
import { fakeApi, renderApp, type Answer } from '../../test/render';
import { AutoSwitch } from './AutoSwitch';

const REASONS = {
  outside_contributor: 'Off for PRs from outside contributors.',
  team_review: 'Your team turned off auto-review in .nitpilot.yml.',
  team_address: 'Your team turned off auto-fix in .nitpilot.yml.',
} as const;

afterEach(() => vi.unstubAllGlobals());

describe('AutoSwitch (handoff §2 "Header")', () => {
  it('is "Auto-review" for a reviewer and "Auto-fix" for the author, a switch that says whether it is on', () => {
    const { rerender } = render(<AutoSwitch role="reviewer" on disabledReason={null} onToggle={() => {}} />);
    expect(screen.getByRole('switch', { name: 'Auto-review' })).toHaveAttribute('aria-checked', 'true');
    rerender(<AutoSwitch role="author" on={false} disabledReason={null} onToggle={() => {}} />);
    expect(screen.getByRole('switch', { name: 'Auto-fix' })).toHaveAttribute('aria-checked', 'false');
  });

  it('asks for the other value when pressed, and says what the switch does', async () => {
    const onToggle = vi.fn();
    render(<AutoSwitch role="author" on disabledReason={null} onToggle={onToggle} />);
    const toggle = screen.getByRole('switch', { name: 'Auto-fix' });
    await userEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith(false);
    expect(toggle).toHaveAccessibleDescription('Your agent pushes its fixes as soon as they are done.');
  });

  it.each(Object.entries(REASONS))('when disabled for %s, says only that reason', async (reason, text) => {
    const onToggle = vi.fn();
    render(<AutoSwitch role={reason === 'team_address' ? 'author' : 'reviewer'} on={false} disabledReason={reason as keyof typeof REASONS} onToggle={onToggle} />);
    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveAttribute('aria-disabled', 'true');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(toggle).toHaveAccessibleDescription(text);
    // Hover (or focus, or a tap on a phone) shows it: one tooltip, with one reason in it.
    await userEvent.hover(toggle);
    expect(screen.getAllByRole('tooltip').map((t) => t.textContent)).toEqual([text]);
    for (const other of Object.values(REASONS).filter((t) => t !== text)) expect(screen.queryByText(other)).not.toBeInTheDocument();
    await userEvent.click(toggle);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('shows its tooltip on keyboard focus too, and Escape hides it', async () => {
    render(<AutoSwitch role="reviewer" on={false} disabledReason="outside_contributor" onToggle={() => {}} />);
    await userEvent.tab();
    expect(screen.getByRole('tooltip')).toHaveTextContent(REASONS.outside_contributor);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});

describe('the Auto switch in the chat header', () => {
  const mayaMe: WebMe = { id: 'u1', githubId: '1001', login: 'maya', avatarUrl: null, githubAuth: 'ok', agentOnline: true, settings: { autoReview: true, autoAddress: true, dailyJobCap: 40 }, usedToday: 0 };

  function serve(view: Partial<ChatView>, routes: Record<string, () => Answer | Promise<Answer>> = {}) {
    return fakeApi({
      'GET /api/me': (): Answer => [200, mayaMe],
      'GET /api/inbox': (): Answer => [200, { rows: [] }],
      'GET /api/chats/acme/shop-api/142': (): Answer => [200, chatResponse({ view })],
      ...routes,
    });
  }

  it("turns maya's Auto-fix off, says what that means, and waits for the server to show it", async () => {
    let answer: (a: Answer) => void = () => {};
    const fetch = serve({}, { 'PUT /api/chats/chat_142/auto': () => new Promise<Answer>((resolve) => (answer = resolve)) });
    renderApp('/c/acme/shop-api/142');
    await userEvent.click(await screen.findByRole('switch', { name: 'Auto-fix' }));
    const sent = fetch.mock.calls.find(([url]) => String(url).endsWith('/api/chats/chat_142/auto'));
    expect(sent?.[1]?.method).toBe('PUT');
    expect(JSON.parse(String(sent?.[1]?.body))).toEqual({ role: 'author', on: false });
    // While it's on its way, a second press sends nothing.
    await userEvent.click(screen.getByRole('switch', { name: 'Auto-fix' }));
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/auto'))).toHaveLength(1);
    answer([200, { ok: true }]);
    expect(await screen.findByText("Auto-fix is off. Your agent's work will wait as drafts.")).toBeInTheDocument();
    // No optimistic update: the switch moves when chat.state says so.
    expect(screen.getByRole('switch', { name: 'Auto-fix' })).toHaveAttribute('aria-checked', 'true');
  });

  it("shows the server's words when it refuses", async () => {
    serve({}, { 'PUT /api/chats/chat_142/auto': (): Answer => [409, { error: { code: 'conflict', message: 'Auto-fix is already off.' } }] });
    renderApp('/c/acme/shop-api/142');
    await userEvent.click(await screen.findByRole('switch', { name: 'Auto-fix' }));
    expect((await screen.findByText('Auto-fix is already off.')).closest('[data-error]')).not.toBeNull();
  });

  it('is not there for someone who only reads along', async () => {
    serve({ viewer: { role: null, attention: 'none', failure: null }, permissions: { ...chatView().permissions, auto: [] } });
    renderApp('/c/acme/shop-api/142');
    expect(await screen.findByRole('heading', { name: 'Add cursor pagination to /orders' })).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });
});
