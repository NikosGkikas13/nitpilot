import type { ReactNode } from 'react';
import styles from './ChecklistRow.module.css';

/** Where a step stands: done, the one whose turn it is (the first one not done), or one still to come. */
export type StepState = 'done' | 'active' | 'pending';

/**
 * One step of the setup checklist (handoff §5): a 26 px icon (a green ✓ when done, a spinner while it's this step's
 * turn, its number in an outlined circle when still to come), the title (in `--fg3` once done), a line about it, and
 * whatever the step adds below (`children`: its command, a button, a status line, the agent chips).
 */
export function ChecklistRow({ n, state, title, body, children }: { n: number; state: StepState; title: string; body: ReactNode; children?: ReactNode }) {
  return (
    <li className={styles.row} data-state={state} aria-current={state === 'active' ? 'step' : undefined}>
      <span className={styles.iconBox}>
        {state === 'done' && (
          <span className={styles.done} role="img" aria-label="Done">
            ✓
          </span>
        )}
        {state === 'active' && <span className={styles.spinner} role="img" aria-label="In progress" />}
        {state === 'pending' && (
          <span className={styles.number} role="img" aria-label={`Step ${n}, to do`}>
            {n}
          </span>
        )}
      </span>
      <div className={styles.text}>
        <span className={styles.title}>{title}</span>
        <span className={styles.body}>{body}</span>
        {children}
      </div>
    </li>
  );
}
