import { BRAND } from '@nitpilot/protocol';
import styles from './Wordmark.module.css';

// The wordmark is the CLI name with its first "i" drawn as a dotless ı under a teal diamond.
const SPLIT = BRAND.cli.indexOf('i');
const BEFORE = BRAND.cli.slice(0, SPLIT);
const AFTER = BRAND.cli.slice(SPLIT + 1);

/** `nıtpilot` in Fragment Mono with the teal diamond (handoff: "Mark"). 19 px in the sidebar, 22 on the landing nav, 26 on the splash. */
export function Wordmark({ size = 19 }: { size?: 19 | 22 | 26 }) {
  return (
    <span className={styles.wordmark} style={{ fontSize: size }} role="img" aria-label={BRAND.name}>
      <span aria-hidden="true">
        {BEFORE}
        <span className={styles.dot}>
          ı<span className={styles.diamond} />
        </span>
        {AFTER}
      </span>
    </span>
  );
}
