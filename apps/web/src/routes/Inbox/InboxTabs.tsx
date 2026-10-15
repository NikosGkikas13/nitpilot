import type { Tab } from '../../lib/inbox';
import styles from './InboxTabs.module.css';

const TABS: [Tab, string][] = [
  ['review', 'To review'],
  ['mine', 'Mine'],
];

/** "To review" and "Mine", each with a badge counting what needs you (hidden at 0). */
export function InboxTabs({ tab, counts, pick }: { tab: Tab; counts: Record<Tab, number>; pick(tab: Tab): void }) {
  return (
    <div className={styles.tabs} role="tablist" aria-label="Inbox tabs">
      {TABS.map(([id, label]) => (
        <button key={id} type="button" role="tab" aria-selected={tab === id} className={styles.tab} onClick={() => pick(id)}>
          {label}
          {counts[id] > 0 && (
            <span className={styles.count} aria-label={`${counts[id]} need you`}>
              {counts[id]}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
