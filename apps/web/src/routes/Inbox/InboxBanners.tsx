import { BRAND } from '@nitpilot/protocol';
import { useLocation } from 'react-router';
import { useCopy } from '../../lib/clipboard';
import styles from './InboxBanners.module.css';

const START = `${BRAND.cli} start`;

/** None of your CLIs is connected, so your agent can't pick anything up (handoff §1, item 2). */
export function OfflineBanner() {
  const { copied, copy } = useCopy(START);

  return (
    <div className={styles.offline} role="status">
      <div className={styles.offlineTitle}>
        <span className={styles.ring} aria-hidden="true" />
        Your agent is offline
      </div>
      <div className={styles.offlineRun}>
        Run
        <button type="button" className={styles.chip} onClick={copy} aria-label={`Copy ${START}`}>
          {START}
          <span className={styles.copy}>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
    </div>
  );
}

/** Your GitHub sign-in expired: Nitpilot can't act as you until you sign in again (handoff §10, `github`). */
export function ExpiredStrip() {
  const here = useLocation();
  const next = encodeURIComponent(here.pathname + here.search);
  return (
    <div className={styles.expired} role="alert">
      <span className={styles.bang} aria-hidden="true">
        !
      </span>
      <span className={styles.expiredText}>GitHub sign-in expired</span>
      {/* A full page load: the sign-in starts on the server. */}
      <a className={styles.reconnect} href={`/auth/github/login?next=${next}`}>
        Reconnect
      </a>
    </div>
  );
}
