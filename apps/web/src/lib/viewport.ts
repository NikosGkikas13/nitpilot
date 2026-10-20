import { useCallback, useSyncExternalStore } from 'react';

/** The handoff's breakpoints: the sidebar and the chat side by side from 760 px, one pane below. */
const DESKTOP = '(min-width: 760px)';
/** The chat's details panel has room from 1180 px. */
const WIDE = '(min-width: 1180px)';

/** True while the media query matches, following the window as it's resized. Without matchMedia (very old browsers), true. */
function useMediaQuery(query: string): boolean {
  // The same function each render, or React would stop listening and start again every time the page re-renders.
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window.matchMedia !== 'function') return () => {};
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => typeof window.matchMedia !== 'function' || window.matchMedia(query).matches,
  );
}

/** True at 760 px and wider. */
export function useIsDesktop(): boolean {
  return useMediaQuery(DESKTOP);
}

/** True at 1180 px and wider: room for the chat's details panel. */
export function useIsWide(): boolean {
  return useMediaQuery(WIDE);
}
