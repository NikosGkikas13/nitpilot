import styles from './Ping.module.css';

/** "An agent is working": a 7 px accent dot with a ring that grows and fades, looping (handoff "Motion"). */
export function Ping() {
  return (
    <span className={styles.ping} aria-hidden="true">
      <span className={styles.ring} />
    </span>
  );
}
