import type { InboxRow, InboxStatus } from '@nitpilot/protocol';
import { describe, expect, it } from 'vitest';
import { chatPath, defaultTab, filterRows, sortRows, statusFilterOf, tabCounts, type InboxFilters } from './inbox';

const status = (kind: InboxStatus['kind'], who: string | null = null): InboxStatus => ({ kind, who, reason: null });

function row(over: Partial<InboxRow> = {}): InboxRow {
  return {
    chatId: 'chat-1', repo: 'acme/shop-api', number: 142, title: 'Add cursor pagination to /orders', url: 'https://github.com/acme/shop-api/pull/142',
    role: 'author', other: { login: 'leo', avatarUrl: null, agentActive: false }, status: status('quiet'),
    round: 1, maxRounds: 3, lastActivity: '', updatedAt: '2026-10-15T12:00:00.000Z', unread: 0, needsYou: false, ...over,
  };
}

const noFilters: InboxFilters = { tab: 'mine', query: '', repos: new Set(), statuses: new Set() };

describe('sortRows', () => {
  it('puts the rows that need you first, then the newest first', () => {
    const rows = [
      row({ chatId: 'old', updatedAt: '2026-10-15T09:00:00.000Z' }),
      row({ chatId: 'needs-old', needsYou: true, updatedAt: '2026-10-14T09:00:00.000Z' }),
      row({ chatId: 'new', updatedAt: '2026-10-15T11:00:00.000Z' }),
      row({ chatId: 'needs-new', needsYou: true, updatedAt: '2026-10-15T10:00:00.000Z' }),
    ];
    expect(sortRows(rows).map((r) => r.chatId)).toEqual(['needs-new', 'needs-old', 'new', 'old']);
  });
});

describe('filterRows', () => {
  const rows = [
    row({ chatId: 'mine-142' }),
    row({ chatId: 'review-139', role: 'reviewer', number: 139, title: 'Fix race in session refresh', other: { login: 'sam', avatarUrl: null, agentActive: false } }),
    row({ chatId: 'mine-other-repo', repo: 'acme/web', number: 7, title: 'Dark mode', status: status('working', 'leo') }),
    row({ chatId: 'mine-merged', number: 136, title: 'Remove legacy coupons', status: status('merged') }),
  ];
  const ids = (filters: Partial<InboxFilters>) => filterRows(rows, { ...noFilters, ...filters }).map((r) => r.chatId);

  it('keeps the tab’s rows: To review is where you review, Mine is your PRs', () => {
    expect(ids({ tab: 'review' })).toEqual(['review-139']);
    expect(ids({ tab: 'mine' })).toEqual(['mine-142', 'mine-other-repo', 'mine-merged']);
  });

  it('searches the repo, the number, the title and the other person, ignoring case', () => {
    expect(ids({ query: 'ACME/WEB' })).toEqual(['mine-other-repo']);
    expect(ids({ query: '#136' })).toEqual(['mine-merged']);
    expect(ids({ query: 'coupons' })).toEqual(['mine-merged']);
    expect(ids({ tab: 'review', query: 'sam' })).toEqual(['review-139']);
    expect(ids({ query: '   ' })).toHaveLength(3);
  });

  it('keeps only the chosen repos and statuses (Merged counts as Closed)', () => {
    expect(ids({ repos: new Set(['acme/web']) })).toEqual(['mine-other-repo']);
    expect(ids({ statuses: new Set(['working']) })).toEqual(['mine-other-repo']);
    expect(ids({ statuses: new Set(['closed']) })).toEqual(['mine-merged']);
    expect(ids({ statuses: new Set(['working', 'closed']) })).toEqual(['mine-other-repo', 'mine-merged']);
  });
});

describe('statusFilterOf', () => {
  it('files an escalation under Needs you, Merged under Closed, and a quiet row under nothing', () => {
    expect(statusFilterOf(status('escalated'))).toBe('needs_you');
    expect(statusFilterOf(status('merged'))).toBe('closed');
    expect(statusFilterOf(status('quiet'))).toBeNull();
    expect(statusFilterOf(status('their_turn'))).toBe('their_turn');
  });
});

describe('tabCounts', () => {
  it('counts the rows that need you, per tab', () => {
    const rows = [row({ needsYou: true }), row({ role: 'reviewer', needsYou: true }), row({ role: 'reviewer', needsYou: true }), row({ role: 'reviewer' })];
    expect(tabCounts(rows)).toEqual({ review: 2, mine: 1 });
  });
});

describe('defaultTab', () => {
  it('opens the tab that needs you, else To review if it has anything, else Mine', () => {
    expect(defaultTab([row({ needsYou: true }), row({ role: 'reviewer' })])).toBe('mine');
    expect(defaultTab([row({ needsYou: true }), row({ role: 'reviewer', needsYou: true })])).toBe('review');
    expect(defaultTab([row(), row({ role: 'reviewer' })])).toBe('review');
    expect(defaultTab([row()])).toBe('mine');
    expect(defaultTab([])).toBe('review');
  });
});

describe('chatPath', () => {
  it("is the chat's address in the app", () => {
    expect(chatPath(row())).toBe('/c/acme/shop-api/142');
  });
});
