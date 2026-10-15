import { useParams } from 'react-router';
import { useInbox } from '../../api/inbox';
import { Pane } from '../Shell/Pane';
import styles from '../Shell/Pane.module.css';

/** `/c/:owner/:repo/:number` until the chat screen arrives (Task 10): the PR's name and the way to its transcript. */
export function ChatPlaceholder() {
  const { owner, repo, number } = useParams();
  const fullName = `${owner}/${repo}`;
  const row = useInbox().data?.find((r) => r.repo === fullName && String(r.number) === number);
  return (
    <Pane>
      <p className={styles.ref}>
        {fullName} #{number}
      </p>
      <h1 className={styles.title}>{row?.title ?? `Pull request #${number}`}</h1>
      <p className={styles.muted}>The live chat opens here soon. Until then, the transcript shows everything so far.</p>
      <div className={styles.actions}>
        {/* A full page load: the server still renders the transcript at this address. */}
        <a className={styles.button} href={`/c/${fullName}/${number}`}>
          Open the transcript
        </a>
        {row && (
          <a className={styles.button} href={row.url} target="_blank" rel="noreferrer">
            Open on GitHub <span aria-hidden="true">↗</span>
          </a>
        )}
      </div>
    </Pane>
  );
}
