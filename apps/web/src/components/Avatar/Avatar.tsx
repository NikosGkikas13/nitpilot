import { useState, type ReactNode } from 'react';
import styles from './Avatar.module.css';

/**
 * A person's GitHub picture in a circle, or their initials when there is none or it doesn't load.
 * `children` sits on top, bottom-right (the AgentBadge).
 */
export function Avatar({ login, src, size, children }: { login: string; src: string | null; size: 32 | 38; children?: ReactNode }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={styles.avatar} style={{ width: size, height: size }}>
      {src && !broken ? (
        <img className={styles.image} src={src} alt={login} width={size} height={size} loading="lazy" onError={() => setBroken(true)} />
      ) : (
        <span className={styles.initials} style={{ fontSize: size === 38 ? 13 : 11 }} role="img" aria-label={login}>
          {initials(login)}
        </span>
      )}
      {children}
    </span>
  );
}

/** "maya" → "MA", "leo-park" → "LP". */
export function initials(login: string): string {
  const parts = login.split(/[-_.\s]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0]![0]! + parts[1]![0]! : login.slice(0, 2);
  return letters.toUpperCase();
}
