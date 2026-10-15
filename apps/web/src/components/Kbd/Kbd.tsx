import type { ReactNode } from 'react';
import styles from './Kbd.module.css';

/** A key, as in "/ search". `boxed` draws the outline the search box's hint has. */
export function Kbd({ children, boxed = false }: { children: ReactNode; boxed?: boolean }) {
  return <kbd className={boxed ? `${styles.kbd} ${styles.boxed}` : styles.kbd}>{children}</kbd>;
}
