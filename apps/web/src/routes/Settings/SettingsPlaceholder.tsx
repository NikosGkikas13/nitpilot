import { BRAND, type WebMe } from '@nitpilot/protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useMe } from '../../api/me';
import { useHomeScreenSheet } from '../../components/IosHomeScreenSheet/IosHomeScreenSheet';
import { pushState, turnPushOff, turnPushOffBeforeSignOut, turnPushOn } from '../../push/subscribe';
import { Pane } from '../Shell/Pane';
import styles from '../Shell/Pane.module.css';

/** `/settings` until the Settings page arrives (Task 21): who you are, push for this browser, and Sign out. */
export function SettingsPlaceholder() {
  const me = useMe().data;

  // Sign out removes this browser's push subscription first (never for longer than a moment), then sends the form.
  function signOut(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    // form.submit() doesn't fire this handler again.
    void turnPushOffBeforeSignOut().then(() => form.submit());
  }

  return (
    <Pane>
      <h1 className={styles.title}>Signed in as @{me?.login}</h1>
      <p className={styles.muted}>Devices, notifications and defaults come to this page later.</p>
      {me && <PushRow me={me} />}
      {/* A plain form: the browser sends our Origin, which /auth/logout checks, then follows its redirect. */}
      <form method="post" action="/auth/logout" onSubmit={signOut}>
        <button type="submit" className={styles.button}>
          Sign out
        </button>
      </form>
    </Pane>
  );
}

/**
 * Push for this browser (docs/why/service-workers-and-pwa.md), temporary until Task 21's Notifications section: what
 * `pushState()` says, with the button that changes it, or why there's none.
 */
function PushRow({ me }: { me: WebMe }) {
  const queryClient = useQueryClient();
  const sheet = useHomeScreenSheet();
  const state = useQuery({ queryKey: ['pushState'], queryFn: pushState, retry: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const vapidPublicKey = me.push.vapidPublicKey;

  async function change(on: boolean) {
    if (!vapidPublicKey) return;
    setBusy(true);
    setError(null);
    try {
      if (on) {
        await turnPushOn(vapidPublicKey);
      } else {
        await turnPushOff();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      // The server sends no me.update for this: you now have a subscription, or maybe not (other devices may have one).
      const now = await pushState();
      queryClient.setQueryData(['pushState'], now);
      if (now === 'on') queryClient.setQueryData<WebMe | null>(['me'], (old) => (old ? { ...old, push: { ...old.push, subscribed: true } } : old));
      else void queryClient.invalidateQueries({ queryKey: ['me'] });
      setBusy(false);
    }
  }

  let body;
  if (!vapidPublicKey) {
    body = <p className={styles.muted}>Push isn't set up on this server.</p>;
  } else if (state.data === undefined) {
    body = null;
  } else if (state.data === 'unsupported') {
    body = <p className={styles.muted}>This browser can't show push notifications.</p>;
  } else if (state.data === 'needs_home_screen') {
    body = (
      <>
        <p className={styles.muted}>
          <b>On iPhone?</b> Add {BRAND.name} to your Home Screen to get notifications. In Safari, tap Share, then Add to Home Screen.
        </p>
        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={sheet.open}>
            Show me how
          </button>
        </div>
      </>
    );
  } else if (state.data === 'denied') {
    body = <p className={styles.muted}>Notifications are blocked for this site. Allow them in your browser's site settings, then reload this page.</p>;
  } else {
    const on = state.data === 'on';
    body = (
      <>
        <p className={styles.muted}>{on ? "On: this browser gets a notification when you're needed." : 'Off for this browser.'}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.button} disabled={busy} aria-busy={busy} onClick={() => void change(!on)}>
            {on ? 'Turn push off' : 'Turn push on'}
          </button>
        </div>
      </>
    );
  }

  return (
    <section className={styles.section} aria-labelledby="push-heading">
      <h2 id="push-heading" className={styles.heading}>
        Push notifications
      </h2>
      {body}
      {error && (
        <p className={styles.muted} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
