import { useCopy } from '../../lib/clipboard';
import styles from './CommandBlock.module.css';

/**
 * A command to run in a terminal (handoff §5): a 44 px `--code` block with a `$` prefix. `active` (the step whose turn
 * it is) adds Copy; a later step's command shows in `--fg3`, without Copy, so you can read ahead.
 */
export function CommandBlock({ command, active }: { command: string; active: boolean }) {
  const { copied, copy } = useCopy(command);
  return (
    <div className={styles.block} data-active={active}>
      <span className={styles.prompt} aria-hidden="true">
        $
      </span>
      <code className={styles.command}>{command}</code>
      {active && (
        <button type="button" className={styles.copy} onClick={copy} aria-label={`Copy ${command}`}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      )}
    </div>
  );
}
