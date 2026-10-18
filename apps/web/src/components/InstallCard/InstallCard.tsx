import { BRAND } from '@nitpilot/protocol';
import { useId, useState, useSyncExternalStore } from 'react';
import { isStandalone } from '../../push/device';
import { installPrompt, type InstallPrompt } from '../../push/install';
import { isRemembered, remember } from '../../lib/remember';
import styles from './InstallCard.module.css';

export const INSTALL_DISMISSED_KEY = `${BRAND.cli}.install-dismissed`;

/**
 * "Install Nitpilot" (handoff §9 "Desktop install prompt"): a card at the bottom left, 380 px wide (full width on a
 * phone), once the browser says the app can be installed (Chromium's `beforeinstallprompt`, held by push/install.ts).
 * Install opens the browser's own dialog; Not now is remembered in this browser. Never inside the installed app.
 * Safari has no such event: on an iPhone the Home Screen sheet (IosHomeScreenSheet) explains it instead.
 */
export function InstallCard({ prompt = installPrompt }: { prompt?: InstallPrompt }) {
  const offer = useSyncExternalStore(prompt.subscribe, prompt.current);
  const [dismissed, setDismissed] = useState(() => isRemembered(INSTALL_DISMISSED_KEY));
  const titleId = useId();
  const textId = useId();
  if (!offer || dismissed || isStandalone()) return null;

  function notNow() {
    remember(INSTALL_DISMISSED_KEY);
    setDismissed(true);
  }

  return (
    // A dialog that doesn't take focus or block the page: the inbox stays usable behind it.
    <section role="dialog" aria-labelledby={titleId} aria-describedby={textId} className={styles.card}>
      <img src="/icons/icon.svg" alt="" width={52} height={52} className={styles.icon} />
      <div className={styles.body}>
        <div className={styles.text}>
          <h2 id={titleId} className={styles.title}>
            Install {BRAND.name}
          </h2>
          <p id={textId} className={styles.lede}>
            Its own window next to your editor, with notifications when you're needed.
          </p>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.install} onClick={() => void prompt.install()}>
            Install
          </button>
          <button type="button" className={styles.later} onClick={notNow}>
            Not now
          </button>
        </div>
      </div>
    </section>
  );
}
