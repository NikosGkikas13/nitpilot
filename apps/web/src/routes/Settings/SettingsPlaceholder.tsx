import { useMe } from '../../api/me';
import { Pane } from '../Shell/Pane';
import styles from '../Shell/Pane.module.css';

/** `/settings` until the Settings page arrives (Task 21): who you are, and Sign out. */
export function SettingsPlaceholder() {
  const me = useMe().data;
  return (
    <Pane>
      <h1 className={styles.title}>Signed in as @{me?.login}</h1>
      <p className={styles.muted}>Devices, notifications and defaults come to this page later.</p>
      {/* A plain form: the browser sends our Origin, which /auth/logout checks, then follows its redirect. */}
      <form method="post" action="/auth/logout">
        <button type="submit" className={styles.button}>
          Sign out
        </button>
      </form>
    </Pane>
  );
}
