import type { WebMe } from '@nitpilot/protocol';
import { Link } from 'react-router';
import { Avatar } from '../../components/Avatar/Avatar';
import { ThemeToggle } from '../../components/ThemeToggle/ThemeToggle';
import { Wordmark } from '../../components/Wordmark/Wordmark';
import styles from './InboxHeader.module.css';

/** The wordmark, the theme toggle, and your avatar, which leads to Settings. */
export function InboxHeader({ me }: { me: WebMe }) {
  return (
    <header className={styles.header}>
      <Wordmark />
      <span className={styles.spacer} />
      <ThemeToggle />
      <Link to="/settings" className={styles.me} aria-label={`Settings · ${me.login}`}>
        <Avatar login={me.login} src={me.avatarUrl} size={32} />
      </Link>
    </header>
  );
}
