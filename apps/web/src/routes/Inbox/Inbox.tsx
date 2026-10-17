import type { InboxRow, WebMe } from '@nitpilot/protocol';
import { useRef, useState } from 'react';
import { useMatch, useNavigate } from 'react-router';
import { ApiError } from '../../api/client';
import { useInbox } from '../../api/inbox';
import { ErrorState } from '../../components/ErrorState/ErrorState';
import { Kbd } from '../../components/Kbd/Kbd';
import { chatPath, defaultTab, filterRows, sortRows, tabCounts, type StatusFilter, type Tab } from '../../lib/inbox';
import { useInboxKeys } from '../../lib/keys';
import { useNow } from '../../lib/time';
import { EmptyState } from './EmptyState';
import styles from './Inbox.module.css';
import { ExpiredStrip, OfflineBanner } from './InboxBanners';
import { InboxFilter } from './InboxFilter';
import { InboxHeader } from './InboxHeader';
import { InboxRowItem } from './InboxRow';
import { InboxTabs } from './InboxTabs';

/** The inbox (spec §16, handoff §1): the sidebar on a desktop, the whole screen on a phone. */
export function Inbox({ me }: { me: WebMe }) {
  const inbox = useInbox();
  const navigate = useNavigate();
  const open = useMatch('/c/:owner/:repo/:number')?.params;
  const search = useRef<HTMLInputElement>(null);

  // Until you pick a tab, the inbox shows the one that needs you.
  const [chosenTab, setChosenTab] = useState<Tab | null>(null);
  const [query, setQuery] = useState('');
  const [repos, setRepos] = useState<ReadonlySet<string>>(new Set());
  const [statuses, setStatuses] = useState<ReadonlySet<StatusFilter>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const now = useNow();

  const all = inbox.data ?? [];
  // Settle the opening tab once, when the first data arrives: a later refetch must not flip the tab under you.
  if (chosenTab === null && inbox.data) setChosenTab(defaultTab(inbox.data));
  const tab = chosenTab ?? defaultTab(all);
  const rows = sortRows(filterRows(all, { tab, query, repos, statuses }));
  const allRepos = [...new Set(all.map((r) => r.repo))].sort();
  const isOpen = (row: InboxRow) => open !== undefined && row.repo === `${open.owner}/${open.repo}` && String(row.number) === open.number;
  // The server asks GitHub which repos you can read; a 401 means your GitHub sign-in expired, and trying again can't help.
  const reauthMessage = inbox.error instanceof ApiError && inbox.error.status === 401 ? inbox.error.message : null;

  useInboxKeys({
    rows,
    cursor,
    setCursor,
    open: (chatId) => {
      const row = rows.find((r) => r.chatId === chatId);
      if (row) void navigate(chatPath(row));
    },
    focusSearch: () => search.current?.focus(),
    escape: () => setFilterOpen(false),
  });

  function pickTab(next: Tab) {
    setChosenTab(next);
    setCursor(null);
  }

  return (
    <section className={styles.inbox} aria-label="Inbox">
      <InboxHeader me={me} />
      {!me.agentOnline && <OfflineBanner />}
      {(me.githubAuth === 'needs_reauth' || reauthMessage !== null) && <ExpiredStrip />}

      <div className={styles.tools}>
        <label className={styles.search}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            ref={search}
            className={styles.searchInput}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(null);
            }}
            placeholder="Search pull requests"
            aria-label="Search pull requests"
          />
          {!query && (
            <span className={styles.slashHint}>
              <Kbd boxed>/</Kbd>
            </span>
          )}
        </label>
        <InboxFilter
          open={filterOpen}
          setOpen={setFilterOpen}
          repos={allRepos}
          chosenRepos={repos}
          chosenStatuses={statuses}
          toggleRepo={(repo) => setRepos((set) => toggled(set, repo))}
          toggleStatus={(status) => setStatuses((set) => toggled(set, status))}
        />
      </div>

      <InboxTabs tab={tab} counts={tabCounts(all)} pick={pickTab} />

      <div className={styles.scroll}>
        {inbox.isPending ? (
          <p className={styles.loading} role="status">
            Loading…
          </p>
        ) : reauthMessage !== null ? (
          <p className={styles.notice}>{reauthMessage}</p>
        ) : inbox.isError ? (
          <ErrorState message={inbox.error.message} onRetry={() => void inbox.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState query={query.trim()} filtering={repos.size + statuses.size > 0} />
        ) : (
          <div className={styles.list} role="listbox" aria-label="Pull requests">
            {rows.map((row) => (
              <InboxRowItem
                key={row.chatId}
                row={row}
                viewerLogin={me.login}
                selected={isOpen(row)}
                cursor={row.chatId === cursor}
                now={now}
                onOpen={() => {
                  setCursor(null);
                  void navigate(chatPath(row));
                }}
              />
            ))}
          </div>
        )}
      </div>

      <footer className={styles.footer}>
        <span>
          <Kbd>j</Kbd> <Kbd>k</Kbd> move
        </span>
        <span>
          <Kbd>↵</Kbd> open
        </span>
        <span>
          <Kbd>/</Kbd> search
        </span>
      </footer>
    </section>
  );
}

/** A copy of `set` with `item` added, or removed if it was there. */
function toggled<T>(set: ReadonlySet<T>, item: T): ReadonlySet<T> {
  const next = new Set(set);
  if (next.has(item)) next.delete(item);
  else next.add(item);
  return next;
}
