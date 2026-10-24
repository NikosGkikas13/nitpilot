import { Link } from 'react-router';
import { Wordmark } from '../Wordmark/Wordmark';
import styles from './FirstRunNeeded.module.css';

/**
 * What every page shows while the server is in first-run mode (it has no GitHub App yet, so `/api/me` answers 503
 * `first_run`): the server's message and the way to the setup page. See docs/why/first-run-and-app-manifests.md.
 */
export function FirstRunNeeded({ message }: { message: string }) {
  return (
    <div className={styles.page}>
      <header className={styles.topBar}>
        <Wordmark />
      </header>
      <main className={styles.main}>
        <section className={styles.card} aria-labelledby="first-run-needed-title">
          <h1 id="first-run-needed-title" className={styles.title}>
            This server isn't set up yet
          </h1>
          <p className={styles.body}>{message}</p>
          <Link to="/first-run" className={styles.button}>
            Open the setup page
          </Link>
        </section>
      </main>
    </div>
  );
}
