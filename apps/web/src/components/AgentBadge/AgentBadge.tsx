import styles from './AgentBadge.module.css';

/**
 * The mark on a person's avatar for their agent (handoff: a dark rounded square holding a diamond): large on an
 * inbox row, small in the chat's feed, tiny in a point's thread. Beside an agent's name it only decorates, so it
 * says nothing to a screen reader; on its own it says the agent is at work.
 */
export function AgentBadge({ login, size = 'large', decorative = false }: { login: string; size?: 'large' | 'small' | 'tiny'; decorative?: boolean }) {
  return (
    <span className={`${styles.badge} ${styles[size]}`} {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': `${login}'s agent is active` })}>
      <span className={styles.diamond} />
    </span>
  );
}
