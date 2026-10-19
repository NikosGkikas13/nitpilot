import styles from './Switch.module.css';

/**
 * The Settings page's switch (handoff §7): a 46×28 track with a 22 px thumb, `role=switch` with `aria-checked`. It
 * shows `on` as the server last said, or the value on its way; pressing asks for the other value. While `busy`
 * (a save on its way) presses are ignored and it says so (`aria-busy`).
 */
export function Switch({ label, on, busy = false, onToggle }: { label: string; on: boolean; busy?: boolean; onToggle: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      aria-busy={busy || undefined}
      className={styles.switch}
      onClick={() => {
        if (!busy) onToggle(!on);
      }}
    >
      <span className={styles.thumb} aria-hidden="true" />
    </button>
  );
}
