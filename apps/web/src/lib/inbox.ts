import type { InboxRow, InboxStatus } from '@nitpilot/protocol';

/** The inbox tabs (spec §16): PRs you review, and your own. */
export type Tab = 'review' | 'mine';

/** The Filter popover's status choices, in the handoff's order. */
export const STATUS_FILTERS = [
  ['needs_you', 'Needs you'],
  ['working', 'Agent working'],
  ['waiting', 'Waiting'],
  ['their_turn', 'Their turn'],
  ['ready', 'Ready'],
  ['closed', 'Closed'],
] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number][0];

export type InboxFilters = { tab: Tab; query: string; repos: ReadonlySet<string>; statuses: ReadonlySet<StatusFilter> };

/** Which status filter a row falls under: an escalation is a Needs you, Merged is Closed, a quiet row is none. */
export function statusFilterOf(status: InboxStatus): StatusFilter | null {
  switch (status.kind) {
    case 'escalated':
      return 'needs_you';
    case 'merged':
      return 'closed';
    case 'quiet':
      return null;
    default:
      return status.kind;
  }
}

/** The rows that need you first, then the most recently changed (handoff §1). */
export function sortRows(rows: readonly InboxRow[]): InboxRow[] {
  return [...rows].sort((a, b) => Number(b.needsYou) - Number(a.needsYou) || b.updatedAt.localeCompare(a.updatedAt));
}

/** The rows of one tab that match the search and the filters. An empty set of repos or statuses means all. */
export function filterRows(rows: readonly InboxRow[], f: InboxFilters): InboxRow[] {
  const role = f.tab === 'review' ? 'reviewer' : 'author';
  const query = f.query.trim().toLowerCase();
  return rows.filter((row) => {
    if (row.role !== role) return false;
    if (f.repos.size > 0 && !f.repos.has(row.repo)) return false;
    if (f.statuses.size > 0) {
      const kind = statusFilterOf(row.status);
      if (kind === null || !f.statuses.has(kind)) return false;
    }
    if (query && !`${row.repo} #${row.number} ${row.title} ${row.other?.login ?? ''}`.toLowerCase().includes(query)) return false;
    return true;
  });
}

/** Each tab's badge: how many of its rows need you. */
export function tabCounts(rows: readonly InboxRow[]): Record<Tab, number> {
  return {
    review: rows.filter((r) => r.role === 'reviewer' && r.needsYou).length,
    mine: rows.filter((r) => r.role === 'author' && r.needsYou).length,
  };
}

/** The tab the inbox opens on: the one that needs you, else To review when it has anything, else Mine. */
export function defaultTab(rows: readonly InboxRow[]): Tab {
  const counts = tabCounts(rows);
  if (counts.review > 0) return 'review';
  if (counts.mine > 0) return 'mine';
  const reviews = rows.some((r) => r.role === 'reviewer');
  const mine = rows.some((r) => r.role === 'author');
  return mine && !reviews ? 'mine' : 'review';
}

/** A chat's address in the app: the same URL the summary comment links to (spec §10). */
export function chatPath(row: Pick<InboxRow, 'repo' | 'number'>): string {
  return `/c/${row.repo}/${row.number}`;
}
