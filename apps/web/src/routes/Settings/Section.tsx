import type { ReactNode } from 'react';
import styles from './Settings.module.css';

/** One section of the Settings page: its 16 px heading over an 18 px-radius card. `id` is the nav's anchor. */
export function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className={styles.section} aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className={styles.heading}>
        {title}
      </h2>
      <div className={styles.card}>{children}</div>
    </section>
  );
}
