import { BRAND } from '@nitpilot/protocol';
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { isRemembered, remember } from '../../lib/remember';
import { isIos, isStandalone } from '../../push/device';
import styles from './IosHomeScreenSheet.module.css';

export const HOME_SCREEN_SHEET_SEEN_KEY = `${BRAND.cli}.home-screen-sheet-seen`;

type SheetApi = { open: () => void };
const SheetContext = createContext<SheetApi | null>(null);

/**
 * The iPhone's Home Screen sheet for the signed-in app (routes/Shell/Shell.tsx). On an iPhone or iPad outside the
 * Home Screen app it opens by itself once, after sign-in (remembered in this browser), because iOS only allows push
 * from there. Settings opens it again with `useHomeScreenSheet().open()`.
 */
export function HomeScreenSheetProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(() => isIos() && !isStandalone() && !isRemembered(HOME_SCREEN_SHEET_SEEN_KEY));
  // Where focus was before the sheet opened, to give it back when it closes.
  const opener = useRef<HTMLElement | null>(null);
  const api = useMemo<SheetApi>(
    () => ({
      open: () => {
        opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setOpen(true);
      },
    }),
    [],
  );
  const close = useCallback(() => {
    remember(HOME_SCREEN_SHEET_SEEN_KEY);
    setOpen(false);
    opener.current?.focus();
    opener.current = null;
  }, []);
  return (
    <SheetContext.Provider value={api}>
      {children}
      {open && <IosHomeScreenSheet onClose={close} />}
    </SheetContext.Provider>
  );
}

export function useHomeScreenSheet(): SheetApi {
  const api = useContext(SheetContext);
  if (!api) throw new Error('useHomeScreenSheet needs a <HomeScreenSheetProvider> above it');
  return api;
}

/**
 * "Add Nitpilot to your Home Screen" (handoff §9 "iOS Home Screen hint"): a bottom sheet over the dimmed page, with a
 * grabber, the three steps and "Got it". A modal dialog: focus moves to Got it and stays inside; Esc, Got it and a tap
 * on the dimmed page close it.
 */
export function IosHomeScreenSheet({ onClose }: { onClose: () => void }) {
  const gotIt = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const textId = useId();
  useEffect(() => gotIt.current?.focus(), []);

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      // Stopped here: on a phone, Esc would otherwise also go back to the inbox (lib/keys.ts).
      e.stopPropagation();
      onClose();
    } else if (e.key === 'Tab') {
      // Got it is the only control, so focus stays on it.
      e.preventDefault();
      gotIt.current?.focus();
    }
  }

  return (
    <div className={styles.layer} onKeyDown={onKeyDown}>
      <div className={styles.backdrop} data-testid="sheet-backdrop" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={textId} className={styles.sheet}>
        <span className={styles.grabber} aria-hidden="true" />
        <div className={styles.head}>
          <img src="/icons/icon.svg" alt="" width={56} height={56} className={styles.icon} />
          <div className={styles.text}>
            <h2 id={titleId} className={styles.title}>
              Add {BRAND.name} to your Home Screen
            </h2>
            <p id={textId} className={styles.lede}>
              On iPhone, notifications only work from the Home Screen app.
            </p>
          </div>
        </div>
        <ol className={styles.steps}>
          <li className={styles.step}>
            <span className={styles.number} aria-hidden="true">
              1
            </span>
            <span>
              Tap <b>Share</b> in Safari's toolbar
            </span>
          </li>
          <li className={styles.step}>
            <span className={styles.number} aria-hidden="true">
              2
            </span>
            <span>
              Choose <b>Add to Home Screen</b>
            </span>
          </li>
          <li className={styles.step}>
            <span className={styles.number} aria-hidden="true">
              3
            </span>
            <span>Open {BRAND.name} from there and allow notifications</span>
          </li>
        </ol>
        <button ref={gotIt} type="button" className={styles.gotIt} onClick={onClose}>
          Got it
        </button>
        {/* Points down at Safari's toolbar, where Share is. */}
        <span className={styles.pointer} aria-hidden="true" />
      </div>
    </div>
  );
}
