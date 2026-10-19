import type { WebMe } from '@nitpilot/protocol';
import { useState, type FormEvent } from 'react';
import { Avatar } from '../../components/Avatar/Avatar';
import { turnPushOffBeforeSignOut } from '../../push/subscribe';
import { Section } from './Section';
import styles from './Settings.module.css';

/**
 * Who you are on GitHub, and Sign out (handoff §7 "Account"). The login is the name: Nitpilot stores no display name.
 * Sign out removes this browser's push subscription first (never for longer than a moment), then sends the form.
 */
export function Account({ me }: { me: WebMe }) {
  const [signingOut, setSigningOut] = useState(false);

  function signOut(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (signingOut) return;
    setSigningOut(true);
    const form = e.currentTarget;
    // form.submit() doesn't fire this handler again.
    void turnPushOffBeforeSignOut().then(() => form.submit());
  }

  return (
    <Section id="account" title="Account">
      <div className={`${styles.row} ${styles.account}`}>
        <Avatar login={me.login} src={me.avatarUrl} size={40} />
        <div className={styles.rowText}>
          <span className={styles.rowTitle}>{me.login}</span>
          <span className={`${styles.hint} ${styles.mono}`}>github.com/{me.login}</span>
        </div>
        {/* A plain form: the browser sends our Origin, which /auth/logout checks, then follows its redirect. */}
        <form method="post" action="/auth/logout" onSubmit={signOut}>
          <button type="submit" className={`${styles.button} ${styles.signOut}`} disabled={signingOut} aria-busy={signingOut}>
            Sign out
          </button>
        </form>
      </div>
    </Section>
  );
}
