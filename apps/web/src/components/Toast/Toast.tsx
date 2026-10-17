import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import styles from './Toast.module.css';

/** How long a toast stays (handoff "Toasts"). */
export const TOAST_MS = 2600;

type Shown = { id: number; text: string; error: boolean };
type ToastApi = { show: (text: string, opts?: { error?: boolean }) => void };

const ShowContext = createContext<ToastApi | null>(null);
const ShownContext = createContext<Shown | null>(null);

/**
 * One toast at a time for the pages inside it (routes/Shell/Shell.tsx): a newer one replaces the one showing, with
 * its own 2.6 s. A page draws it where it wants with `<Toasts />`.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<Shown | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const nextId = useRef(0);
  const show = useCallback((text: string, opts: { error?: boolean } = {}) => {
    clearTimeout(timer.current);
    nextId.current += 1;
    setShown({ id: nextId.current, text, error: opts.error ?? false });
    timer.current = setTimeout(() => setShown(null), TOAST_MS);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  const api = useMemo(() => ({ show }), [show]);
  return (
    <ShowContext.Provider value={api}>
      <ShownContext.Provider value={shown}>{children}</ShownContext.Provider>
    </ShowContext.Provider>
  );
}

/** `show(text)` for what worked, `show(text, { error: true })` for what didn't, in the server's words. */
export function useToast(): ToastApi {
  const api = useContext(ShowContext);
  if (!api) throw new Error('useToast needs a <ToastProvider> above it');
  return api;
}

/**
 * Where the toast appears: centred, 8 px above the top of the nearest positioned box (the chat's footer, which holds
 * the composer, so it clears the field however tall it grows). The status line is always there, empty between toasts, so screen readers hear each new one.
 */
export function Toasts() {
  const shown = useContext(ShownContext);
  return (
    <div className={styles.place} role="status" aria-live="polite">
      {shown && (
        <div key={shown.id} className={styles.toast} data-error={shown.error || undefined}>
          {shown.error && <span className={styles.diamond} aria-hidden="true" />}
          {shown.text}
        </div>
      )}
    </div>
  );
}
