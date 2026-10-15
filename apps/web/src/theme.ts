import { BRAND } from '@nitpilot/protocol';

/** What the person picked. `system` follows the operating system's light or dark setting. */
export type ThemeChoice = 'system' | 'light' | 'dark';

export const THEME_KEY = `${BRAND.cli}.theme`;

/**
 * localStorage can be missing or throw (a private window, blocked site data), so every use is
 * wrapped: without it, the theme just follows the system.
 */
function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readTheme(store: Pick<Storage, 'getItem'> | null = storage()): ThemeChoice {
  try {
    const saved = store?.getItem(THEME_KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch {
    return 'system';
  }
}

export function writeTheme(choice: ThemeChoice, store: Pick<Storage, 'setItem' | 'removeItem'> | null = storage()): void {
  try {
    if (choice === 'system') store?.removeItem(THEME_KEY);
    else store?.setItem(THEME_KEY, choice);
  } catch {
    // Not remembered; the choice still applies until the page reloads.
  }
}

/** tokens.css reads `data-theme` on <html>: none means "follow the system". */
export function applyTheme(choice: ThemeChoice, root: HTMLElement = document.documentElement): void {
  if (choice === 'system') delete root.dataset.theme;
  else root.dataset.theme = choice;
}

export function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** The theme on screen right now. */
export function shownTheme(choice: ThemeChoice, systemDark: boolean): 'light' | 'dark' {
  if (choice === 'system') return systemDark ? 'dark' : 'light';
  return choice;
}
