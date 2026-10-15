import { useSyncExternalStore } from 'react';

/** The handoff's breakpoint: the sidebar and the chat side by side from 760 px, one pane below. */
const DESKTOP = '(min-width: 760px)';

function subscribe(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia(DESKTOP);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

// Without matchMedia (tests, very old browsers), assume a desktop.
function isDesktop(): boolean {
  return typeof window.matchMedia !== 'function' || window.matchMedia(DESKTOP).matches;
}

/** True at 760 px and wider. Follows the window as it's resized. */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, isDesktop);
}
