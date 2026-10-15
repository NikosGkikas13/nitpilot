import type { ReactNode } from 'react';
import { Link } from 'react-router';
import styles from './Pane.module.css';

/** A page on the right of the inbox (or on its own on a phone, with a way back). */
export function Pane({ children }: { children: ReactNode }) {
  return (
    <div className={styles.pane}>
      <Link to="/" className={styles.back} aria-label="Back to inbox">
        <span className={styles.chevron} aria-hidden="true" />
      </Link>
      {children}
    </div>
  );
}

/** The right side when nothing is open, or when the address leads nowhere. */
export function EmptyPane({ title, body }: { title: string; body: string }) {
  return (
    <Pane>
      <div className={styles.empty}>
        <span className={styles.diamond} aria-hidden="true" />
        <h1 className={styles.emptyTitle}>{title}</h1>
        <p className={styles.muted}>{body}</p>
      </div>
    </Pane>
  );
}
