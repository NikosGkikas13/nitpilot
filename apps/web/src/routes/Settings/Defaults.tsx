import type { Settings, WebMe } from '@nitpilot/protocol';
import { useSaveSettings } from '../../api/settings';
import { Section } from './Section';
import styles from './Settings.module.css';
import { Switch } from './Switch';

/** The daily cap's range and step (the server checks the same range: protocol `Settings`). */
const CAP_MIN = 5;
const CAP_MAX = 200;
const CAP_STEP = 5;

/**
 * Your defaults for new chats (handoff §7): Auto-review, Auto-fix, and the daily cap on agent runs with today's usage.
 * Every press saves the whole of your settings at once. While that save is on its way the controls show the value
 * it carries and are busy (presses are ignored); the server's answer then becomes `me.settings`, and a refusal puts
 * back what the server has. The stepper's ends use `aria-disabled`, not `disabled`, so the button that was just
 * pressed keeps keyboard focus; the number is a polite live region, so the new cap is announced.
 */
export function Defaults({ me }: { me: WebMe }) {
  const save = useSaveSettings();
  const busy = save.isPending;
  const settings: Settings = (busy ? save.variables : undefined) ?? me.settings;
  const cap = settings.dailyJobCap;

  function change(next: Partial<Settings>) {
    if (!busy) save.mutate({ ...settings, ...next });
  }

  const used = me.usedToday;
  const full = used >= cap;
  const width = `${Math.min(100, (used / cap) * 100)}%`;

  return (
    <Section id="defaults" title="Defaults for new chats">
      <div className={styles.row}>
        <div className={styles.rowText}>
          <span className={styles.rowTitle}>Auto-review</span>
          <span className={styles.hint}>Your agent reviews as soon as you are requested</span>
        </div>
        <Switch label="Auto-review" on={settings.autoReview} busy={busy} onToggle={(autoReview) => change({ autoReview })} />
      </div>
      <div className={styles.row}>
        <div className={styles.rowText}>
          <span className={styles.rowTitle}>Auto-fix</span>
          <span className={styles.hint}>Off: fixes wait as drafts for you to send</span>
        </div>
        <Switch label="Auto-fix" on={settings.autoAddress} busy={busy} onToggle={(autoAddress) => change({ autoAddress })} />
      </div>
      <div className={`${styles.row} ${styles.capRow}`}>
        <div className={styles.capText}>
          <span className={styles.rowTitle}>Daily job cap</span>
          <span className={styles.hint}>
            Max {cap} agent runs per day · {used} used today
          </span>
          <div className={styles.track} aria-hidden="true">
            <div className={styles.usage} data-testid="usage-bar" data-full={full || undefined} style={{ width }} />
          </div>
        </div>
        <div className={styles.stepper} role="group" aria-label="Daily job cap" aria-busy={busy || undefined}>
          <button
            type="button"
            className={styles.step}
            aria-label="Lower cap"
            aria-disabled={cap <= CAP_MIN || undefined}
            onClick={() => cap > CAP_MIN && change({ dailyJobCap: Math.max(CAP_MIN, cap - CAP_STEP) })}
          >
            −
          </button>
          <span className={styles.capValue} aria-live="polite">
            {cap}
          </span>
          <button
            type="button"
            className={styles.step}
            aria-label="Raise cap"
            aria-disabled={cap >= CAP_MAX || undefined}
            onClick={() => cap < CAP_MAX && change({ dailyJobCap: Math.min(CAP_MAX, cap + CAP_STEP) })}
          >
            +
          </button>
        </div>
      </div>
    </Section>
  );
}
