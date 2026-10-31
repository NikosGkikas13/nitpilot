import { formatMsToReady, type StatsDays } from '@nitpilot/protocol';
import { useState } from 'react';
import { useStats } from '../../api/stats';
import styles from './InboxStats.module.css';

const WINDOWS: StatsDays[] = [7, 30];

/**
 * Four numbers about your agent's reviews (spec §16), under the inbox list. Loading keeps the row's height with
 * blank numbers; an error hides the row, since the inbox matters more. All zeros still show: a new account sees it working.
 */
export function InboxStats() {
  const [days, setDays] = useState<StatsDays>(7);
  const stats = useStats(days);
  if (stats.isError) return null;
  const s = stats.data;

  return (
    <section className={styles.stats} aria-labelledby="inbox-stats-title" aria-busy={stats.isFetching}>
      <div className={styles.head}>
        <h2 id="inbox-stats-title" className={styles.title}>
          Your agent, last {days} days
        </h2>
        <div className={styles.toggle} role="group" aria-label="Stats window">
          {WINDOWS.map((d) => (
            <button key={d} type="button" className={styles.window} aria-pressed={days === d} aria-label={`Last ${d} days`} onClick={() => setDays(d)}>
              {d}d
            </button>
          ))}
        </div>
      </div>
      <dl className={styles.grid}>
        <Stat label="Raised" value={s?.raised} />
        <Stat label="Fixed" value={s?.fixed} />
        <Stat label="Escalated" value={s?.escalated} />
        <Stat label="To ready" fullLabel="Median time to ready" value={s === undefined ? undefined : formatMsToReady(s.medianMsToReady)} />
      </dl>
    </section>
  );
}

/** One number with what it counts. `undefined` while loading: a blank of the same height. */
function Stat({ label, fullLabel, value }: { label: string; fullLabel?: string; value: number | string | undefined }) {
  return (
    <div className={styles.stat}>
      <dt className={styles.label}>
        {fullLabel ? (
          <>
            <span aria-hidden="true">{label}</span>
            <span className="visually-hidden">{fullLabel}</span>
          </>
        ) : (
          label
        )}
      </dt>
      <dd className={styles.value}>
        {value === NONE ? (
          <>
            <span aria-hidden="true">{NONE}</span>
            <span className="visually-hidden">none yet</span>
          </>
        ) : (
          (value ?? '\u00a0')
        )}
      </dd>
    </div>
  );
}

/** What `formatMsToReady` shows when nothing became ready; read out as "none yet". */
const NONE = '–';
