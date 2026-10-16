import { useEffect, useEffectEvent, useRef } from 'react';
import { STATUS_FILTERS, type StatusFilter } from '../../lib/inbox';
import styles from './InboxFilter.module.css';

type Props = {
  open: boolean;
  setOpen(open: boolean): void;
  /** Every repo in your inbox. */
  repos: readonly string[];
  chosenRepos: ReadonlySet<string>;
  chosenStatuses: ReadonlySet<StatusFilter>;
  toggleRepo(repo: string): void;
  toggleStatus(status: StatusFilter): void;
};

/** The Filter button and its popover: repos, then statuses (handoff §1, item 4). Esc closes it (useInboxKeys). */
export function InboxFilter(p: Props) {
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const count = p.chosenRepos.size + p.chosenStatuses.size;

  // A press anywhere outside the button and the popover closes it.
  const close = useEffectEvent(() => p.setOpen(false));
  useEffect(() => {
    if (!p.open) return;
    const onPress = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) close();
    };
    document.addEventListener('pointerdown', onPress);
    return () => document.removeEventListener('pointerdown', onPress);
  }, [p.open]);

  return (
    <div className={styles.box} ref={box}>
      <button ref={button} type="button" className={count > 0 ? `${styles.button} ${styles.active}` : styles.button} aria-expanded={p.open} aria-haspopup="menu" onClick={() => p.setOpen(!p.open)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M4 6h16M7 12h10M10 18h4" />
        </svg>
        {count > 0 ? `Filter · ${count}` : 'Filter'}
      </button>
      {p.open && (
        <div
          className={styles.menu}
          role="menu"
          aria-label="Filter pull requests"
          onKeyDown={(e) => {
            // The focused item goes away with the menu, so Esc hands the focus back to the button that opened it.
            if (e.key === 'Escape') button.current?.focus();
          }}
        >
          <div role="group" aria-label="Repo">
            <div className={styles.group} aria-hidden="true">
              Repo
            </div>
            {p.repos.map((repo) => (
              <Choice key={repo} label={repo} mono on={p.chosenRepos.has(repo)} toggle={() => p.toggleRepo(repo)} />
            ))}
          </div>
          <div className={styles.divider} />
          <div role="group" aria-label="Status">
            <div className={styles.group} aria-hidden="true">
              Status
            </div>
            {STATUS_FILTERS.map(([status, label]) => (
              <Choice key={status} label={label} on={p.chosenStatuses.has(status)} toggle={() => p.toggleStatus(status)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Choice({ label, on, toggle, mono = false }: { label: string; on: boolean; toggle(): void; mono?: boolean }) {
  return (
    <button type="button" role="menuitemcheckbox" aria-checked={on} className={mono ? `${styles.choice} ${styles.mono}` : styles.choice} onClick={toggle}>
      <span className={styles.mark} aria-hidden="true">
        {on ? '✓' : ''}
      </span>
      {label}
    </button>
  );
}
