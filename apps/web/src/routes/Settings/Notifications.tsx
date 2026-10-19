import { BRAND, type WebMe } from '@nitpilot/protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useHomeScreenSheet } from '../../components/IosHomeScreenSheet/IosHomeScreenSheet';
import { pushState, turnPushOff, turnPushOn } from '../../push/subscribe';
import { Section } from './Section';
import styles from './Settings.module.css';
import { Switch } from './Switch';

const HINT = "Only when you're needed: approvals, escalations, failures";

/**
 * Push for this browser (handoff §7 "Notifications", docs/why/service-workers-and-pwa.md): the switch when this
 * browser can subscribe, or why it can't. On an iPhone outside the Home Screen app, the tip and the way to the steps.
 */
export function Notifications({ me }: { me: WebMe }) {
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
      // The server's me.update reaches this tab too, but this browser knows its own state now.
      try {
        const now = await pushState();
        queryClient.setQueryData(['pushState'], now);
        if (now === 'on') queryClient.setQueryData<WebMe | null>(['me'], (old) => (old ? { ...old, push: { ...old.push, subscribed: true } } : old));
        // Off here; your other devices may still have one: ask the server.
        else void queryClient.invalidateQueries({ queryKey: ['me'] });
      } catch {
        // Couldn't read the browser's state: leave the switch as it was. It must not stay busy.
      }
      setBusy(false);
    }
  }

  // What the row says under its title, and whether the switch is offered.
  let hint = HINT;
  let control = null;
  if (!vapidPublicKey) {
    hint = "Push isn't set up on this server.";
  } else if (state.data === 'unsupported') {
    hint = "This browser can't show push notifications.";
  } else if (state.data === 'denied') {
    hint = "Blocked in your browser's settings. Allow notifications for this site there, then reload this page.";
  } else if (state.data === 'on' || state.data === 'off') {
    control = <Switch label="Push notifications" on={state.data === 'on'} busy={busy} onToggle={(on) => void change(on)} />;
  }

  return (
    <Section id="notifications" title="Notifications">
      <div className={styles.row}>
        <div className={styles.rowText}>
          <span className={styles.rowTitle}>Push notifications</span>
          <span className={styles.hint}>{hint}</span>
        </div>
        {control}
      </div>
      {vapidPublicKey && state.data === 'needs_home_screen' && (
        <div className={styles.tip}>
          <span className={styles.tipDiamond} aria-hidden="true" />
          <div className={styles.tipBody}>
            <span>
              <b>On iPhone?</b> Add {BRAND.name} to your Home Screen to get notifications. In Safari, tap Share, then Add to Home Screen.
            </span>
            <button type="button" className={styles.button} onClick={sheet.open}>
              Show me how
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </Section>
  );
}
