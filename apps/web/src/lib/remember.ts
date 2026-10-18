/**
 * Remembers a "done" in this browser (localStorage), like "Not now" on the install card. localStorage can be missing
 * or throw (a private window, blocked site data), so every use is wrapped: then nothing is remembered, and the page
 * still works for as long as it stays open.
 */
export function isRemembered(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function remember(key: string): void {
  try {
    localStorage.setItem(key, '1');
  } catch {
    // Not remembered: it may come back on the next visit.
  }
}
