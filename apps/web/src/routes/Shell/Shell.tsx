import type { WebMe } from '@nitpilot/protocol';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Outlet, useMatch, useNavigate } from 'react-router';
import { InstallCard } from '../../components/InstallCard/InstallCard';
import { HomeScreenSheetProvider } from '../../components/IosHomeScreenSheet/IosHomeScreenSheet';
import { ToastProvider } from '../../components/Toast/Toast';
import { LiveProvider } from '../../live/LiveProvider';
import { useEscapeBack } from '../../lib/keys';
import { useIsDesktop } from '../../lib/viewport';
import { resyncPush } from '../../push/subscribe';
import { Inbox } from '../Inbox/Inbox';
import styles from './Shell.module.css';
import { UiStateProvider } from './UiState';

/**
 * The signed-in app (handoff "App shell and layout"). Desktop: the 360 px inbox sidebar beside the page that's
 * open. Phone: one pane, the inbox at `/` and the open page anywhere else, with Esc (or ‹) going back. One
 * `/ws/web` socket keeps it all live (live/LiveProvider.tsx); the pages read who you are from the outlet. What the
 * inbox and the composer remember lives here, above both (UiState.tsx), and so do the toasts. So do the two ways to
 * install the app (handoff §9): the install card where the browser offers it, and the iPhone's Home Screen sheet.
 */
export function Shell({ me }: { me: WebMe }) {
  const queryClient = useQueryClient();
  const userId = me.id;
  const vapidPublicKey = me.push.vapidPublicKey;

  // Once per signed-in person: send the server this browser's push subscription again (push/subscribe.ts), so one it
  // dropped, or one left by the last person on a shared browser, belongs to whoever is signed in now.
  useEffect(() => {
    if (!vapidPublicKey) return;
    let stale = false;
    void resyncPush(vapidPublicKey).then((sent) => {
      if (sent && !stale) queryClient.setQueryData<WebMe | null>(['me'], (old) => (old ? { ...old, push: { ...old.push, subscribed: true } } : old));
    });
    return () => {
      stale = true;
    };
  }, [userId, vapidPublicKey, queryClient]);

  return (
    <LiveProvider>
      <UiStateProvider>
        <ToastProvider>
          <HomeScreenSheetProvider>
            <Layout me={me} />
            <InstallCard />
          </HomeScreenSheetProvider>
        </ToastProvider>
      </UiStateProvider>
    </LiveProvider>
  );
}

function Layout({ me }: { me: WebMe }) {
  const desktop = useIsDesktop();
  const atInbox = useMatch('/') !== null;
  const navigate = useNavigate();
  useEscapeBack(!desktop && !atInbox, () => void navigate('/'));

  if (!desktop) {
    return atInbox ? (
      <div className={styles.phone}>
        <Inbox me={me} />
      </div>
    ) : (
      <main className={styles.phone}>
        <Outlet context={me} />
      </main>
    );
  }
  return (
    <div className={styles.shell}>
      <div className={styles.sidebar}>
        <Inbox me={me} />
      </div>
      <main className={styles.main}>
        <Outlet context={me} />
      </main>
    </div>
  );
}
