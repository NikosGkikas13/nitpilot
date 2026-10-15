import type { WebMe } from '@nitpilot/protocol';
import { Outlet, useMatch, useNavigate } from 'react-router';
import { useEscapeBack } from '../../lib/keys';
import { useIsDesktop } from '../../lib/viewport';
import { Inbox } from '../Inbox/Inbox';
import styles from './Shell.module.css';

/**
 * The signed-in app (handoff "App shell and layout"). Desktop: the 360 px inbox sidebar beside the page that's
 * open. Phone: one pane, the inbox at `/` and the open page anywhere else, with Esc (or ‹) going back.
 */
export function Shell({ me }: { me: WebMe }) {
  const desktop = useIsDesktop();
  const atInbox = useMatch('/') !== null;
  const navigate = useNavigate();
  useEscapeBack(!desktop && !atInbox, () => void navigate('/'));

  if (!desktop) {
    return atInbox ? (
      <div className={styles.phone}>
        <Inbox me={me} />
      </div>
    ) : (
      <main className={styles.phone}>
        <Outlet />
      </main>
    );
  }
  return (
    <div className={styles.shell}>
      <div className={styles.sidebar}>
        <Inbox me={me} />
      </div>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
