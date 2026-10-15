import type { WebMe } from '@nitpilot/protocol';
import { ErrorState } from '../../components/ErrorState/ErrorState';
import { ThemeToggle } from '../../components/ThemeToggle/ThemeToggle';
import { Wordmark } from '../../components/Wordmark/Wordmark';
import { useMe } from '../../api/me';
import { Landing } from '../Landing/Landing';
import styles from './Home.module.css';

/** `/`: the landing page when signed out; when signed in, a placeholder until the inbox arrives (Task 6). */
export function Home() {
  const me = useMe();
  if (me.isPending) {
    return (
      <div className={styles.loading} aria-busy="true">
        <Wordmark size={26} />
      </div>
    );
  }
  if (me.isError) return <ErrorState message={me.error.message} onRetry={() => void me.refetch()} />;
  if (me.data === null) return <Landing />;
  return <SignedIn me={me.data} />;
}

function SignedIn({ me }: { me: WebMe }) {
  return (
    <div className={styles.signedIn}>
      <header className={styles.header}>
        <Wordmark />
        <span className={styles.spacer} />
        <ThemeToggle />
      </header>
      <main>
        <h1>Signed in as @{me.login}</h1>
        {/* A plain form: the browser sends our Origin, which /auth/logout checks, then follows its redirect. */}
        <form method="post" action="/auth/logout">
          <button type="submit" className={styles.signOut}>
            Sign out
          </button>
        </form>
      </main>
    </div>
  );
}
