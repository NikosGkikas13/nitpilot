import { useEffect, useEffectEvent } from 'react';

/** True while the person is typing somewhere: then the letters are theirs, not shortcuts. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable;
}

/** A focused button or link handles Enter itself. */
function isButton(target: EventTarget | null): boolean {
  return target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement;
}

type InboxKeys = {
  /** The rows on screen, in order. */
  rows: readonly { chatId: string }[];
  cursor: string | null;
  setCursor(chatId: string | null): void;
  open(chatId: string): void;
  focusSearch(): void;
  /** Esc outside a text field: closes the filter, and on a phone goes back to the inbox. */
  escape(): void;
};

/**
 * The inbox's keyboard (handoff "Keyboard"): j/k or ↓/↑ move the cursor, Enter opens its row, / jumps to the
 * search box, Esc leaves it. Ignored while typing, and when ⌘, Ctrl or Alt is held (those are the browser's).
 */
export function useInboxKeys(keys: InboxKeys): void {
  // An effect event always sees the latest rows and cursor, so the listener is added once, not on every render.
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (isTyping(e.target)) {
      if (e.key === 'Escape' && e.target instanceof HTMLElement) e.target.blur();
      return;
    }
    // ↑/↓ inside the page beside the inbox scroll that page (the chat's feed); j/k still move the cursor.
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && e.target instanceof Element && e.target.closest('main')) return;
    const at = keys.cursor === null ? -1 : keys.rows.findIndex((r) => r.chatId === keys.cursor);
    const last = keys.rows.length - 1;
    if (e.key === 'j' || e.key === 'ArrowDown') {
      e.preventDefault();
      const next = keys.rows[Math.min(last, at + 1)];
      if (next) keys.setCursor(next.chatId);
    } else if (e.key === 'k' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = keys.rows[Math.max(0, at - 1)];
      if (next) keys.setCursor(next.chatId);
    } else if (e.key === 'Enter' && at >= 0 && !isButton(e.target)) {
      // The cursor's row has focus, so Enter usually reaches it as a button press; this covers the rest.
      keys.open(keys.rows[at]!.chatId);
    } else if (e.key === '/') {
      e.preventDefault();
      keys.focusSearch();
    } else if (e.key === 'Escape') {
      keys.escape();
    }
  });

  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
}

/** Esc goes back to the inbox. For the phone, where an open chat or page covers the inbox. */
export function useEscapeBack(active: boolean, back: () => void): void {
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (active && e.key === 'Escape' && !isTyping(e.target)) back();
  });
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
}
