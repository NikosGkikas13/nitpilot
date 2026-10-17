import type { PointView, TimelineItem } from '@nitpilot/protocol';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { item, point } from '../../test/chat';
import { PointCard } from './PointCard';

const people = new Map([
  ['1001', { avatarUrl: 'https://avatars.githubusercontent.com/u/1001' }],
  ['1002', { avatarUrl: 'https://avatars.githubusercontent.com/u/1002' }],
]);
const maya = { githubId: '1001', login: 'maya' };
const leo = { githubId: '1002', login: 'leo' };

function card(p: PointView, thread: TimelineItem[] = []) {
  return render(<PointCard point={p} thread={thread} you="maya" people={people} repoUrl="https://github.com/acme/shop-api" />);
}

describe('PointCard (handoff §3)', () => {
  it('shows severity, category, where, what, and the snippet with its line highlighted', () => {
    card(point());
    const article = screen.getByRole('article', { name: 'P1, Major bug point, Open: parseCursor throws on an empty cursor' });
    expect(within(article).getByText('Major')).toBeInTheDocument();
    expect(within(article).getByText('bug')).toBeInTheDocument();
    expect(within(article).getByRole('link', { name: 'src/orders/list.ts:48' })).toHaveAttribute('href', 'https://github.com/acme/shop-api/blob/abc1234/src/orders/list.ts#L48');
    expect(within(article).getByRole('heading', { name: 'parseCursor throws on an empty cursor' })).toBeInTheDocument();
    expect(within(article).getByText('L47–49')).toBeInTheDocument();
    const highlighted = article.querySelectorAll('[data-highlighted]');
    expect([...highlighted].map((l) => l.textContent)).toEqual(['48  const [ts, id] = raw.split(":");']);
  });

  it('says every status in words, with a glyph', () => {
    for (const [status, word] of [['open', 'Open'], ['addressed', 'Addressed'], ['escalated', 'Escalated']] as const) {
      const { unmount } = card(point({ status }));
      expect(screen.getByRole('article', { name: new RegExp(`${word}:`) })).toHaveTextContent(word);
      unmount();
    }
  });

  it('starts collapsed when resolved, with how it ended, and opens and closes on click', async () => {
    const thread = [item(6, { kind: 'point_reply', author: maya, pointNumber: 1, body: 'Return null for empty cursors.', data: { resolution: 'fixed', commit: 'a1b2c3d4e5f6' } })];
    card(point({ status: 'resolved', authorResolution: 'fixed' }), thread);
    const line = screen.getByRole('button', { name: /P1, Major bug point, Resolved/ });
    expect(line).toHaveAttribute('aria-expanded', 'false');
    expect(line).toHaveTextContent('Fixed · a1b2c3d');
    await userEvent.click(line);
    expect(screen.getByRole('article')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Collapse point' }));
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('keeps the focus on the point when it opens or closes, but never takes it on the first render', async () => {
    card(point({ status: 'resolved', authorResolution: 'fixed' }));
    expect(document.body).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: /P1, Major bug point, Resolved/ }));
    expect(screen.getByRole('button', { name: 'Collapse point' })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Collapse point' }));
    expect(screen.getByRole('button', { name: /P1, Major bug point, Resolved/ })).toHaveFocus();
  });

  it('shows the thread: whose agent said what, the outcome, and the commit that fixed it', () => {
    const thread = [
      item(6, { kind: 'point_reply', author: maya, pointNumber: 1, body: 'Return null for empty cursors.', data: { resolution: 'fixed', commit: 'a1b2c3d4e5f6' } }),
      item(7, { kind: 'point_decision', author: leo, pointNumber: 1, body: 'Not yet: the test is missing.', data: { decision: 'keep_open' } }),
      item(8, { kind: 'human', author: leo, pointNumber: 1, body: 'Please add the test', data: { threadRootId: '900' } }),
    ];
    card(point(), thread);
    const replies = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(replies[0]).toHaveTextContent('Your agentFixed in a1b2c3d');
    expect(within(replies[0]!).getByRole('link', { name: 'a1b2c3d' })).toHaveAttribute('href', 'https://github.com/acme/shop-api/commit/a1b2c3d4e5f6');
    expect(replies[1]).toHaveTextContent("leo's agentKept open");
    expect(replies[2]).toHaveTextContent('leo');
    expect(replies[2]).toHaveTextContent('Please add the test');
  });

  it('has no snippet or file link for a point about the whole PR', () => {
    card(point({ path: null, line: null, url: null, snippet: null }));
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByText(/^L\d/)).not.toBeInTheDocument();
  });
});
