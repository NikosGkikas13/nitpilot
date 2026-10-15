import styles from './AgentBadge.module.css';

/** The mark on a person's avatar while their agent works (handoff: a dark rounded square holding a diamond). */
export function AgentBadge({ login }: { login: string }) {
  return (
    <span className={styles.badge} role="img" aria-label={`${login}'s agent is active`}>
      <span className={styles.diamond} />
    </span>
  );
}
