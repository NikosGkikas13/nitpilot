import styles from './EmptyState.module.css';

/** The list has nothing to show: a calm inbox, or a search or filter that matched nothing (handoff §1, item 7). */
export function EmptyState({ query, filtering }: { query: string; filtering: boolean }) {
  const [title, body] = query
    ? ['No matches', `No pull requests match “${query}”.`]
    : filtering
      ? ['No matches', 'Nothing in this tab matches the filter.']
      : ['All quiet.', "Nitpilot will ping you when you're needed."];
  return (
    <div className={styles.empty}>
      <span className={styles.diamond} aria-hidden="true" />
      <div className={styles.title}>{title}</div>
      <div className={styles.body}>{body}</div>
    </div>
  );
}
