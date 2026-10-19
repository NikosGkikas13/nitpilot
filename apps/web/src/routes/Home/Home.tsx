import { ErrorState } from '../../components/ErrorState/ErrorState';
import { Wordmark } from '../../components/Wordmark/Wordmark';
import { useMe } from '../../api/me';
import { Landing } from '../Landing/Landing';
import { SignedIn } from '../Shell/Shell';
import styles from './Home.module.css';

/** Every page starts here: the landing page when signed out, the app (the pages under routes/Shell/Shell.tsx `SignedIn`) when signed in. */
export function Home() {
  const me = useMe();
  if (me.isPending) {
    return (
      <div className={styles.loading} role="status" aria-busy="true">
        <Wordmark size={26} />
        <span className="visually-hidden">Loading…</span>
      </div>
    );
  }
  if (me.isError) return <ErrorState message={me.error.message} onRetry={() => void me.refetch()} />;
  if (me.data === null) return <Landing />;
  return <SignedIn me={me.data} />;
}
