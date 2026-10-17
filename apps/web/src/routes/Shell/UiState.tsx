import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { StatusFilter, Tab } from '../../lib/inbox';

/** The inbox's choices: its tab (null until you pick one, so it opens on the one that needs you), search and filters. */
export type InboxUi = { tab: Tab | null; query: string; repos: ReadonlySet<string>; statuses: ReadonlySet<StatusFilter> };

type Change<T> = Partial<T> | ((current: T) => Partial<T>);
type UiState = {
  inbox: InboxUi;
  setInbox: (change: Change<InboxUi>) => void;
  drafts: ReadonlyMap<string, string>;
  setDraft: (chatId: string, text: string | ((current: string) => string)) => void;
};

const Context = createContext<UiState | null>(null);
const FRESH: InboxUi = { tab: null, query: '', repos: new Set(), statuses: new Set() };

/**
 * What the signed-in app remembers while you move around in it (routes/Shell/Shell.tsx): the inbox's tab, search
 * and filters, and a half-written note per chat. On a phone the inbox and the chat take turns on screen, so
 * neither can keep this in its own state: it would go each time the other opens. Gone on a reload, like any
 * other state in the page.
 */
export function UiStateProvider({ children }: { children: ReactNode }) {
  const [inbox, setInboxState] = useState<InboxUi>(FRESH);
  const [drafts, setDrafts] = useState<ReadonlyMap<string, string>>(new Map());
  const setInbox = useCallback((change: Change<InboxUi>) => setInboxState((ui) => ({ ...ui, ...(typeof change === 'function' ? change(ui) : change) })), []);
  const setDraft = useCallback(
    (chatId: string, text: string | ((current: string) => string)) =>
      setDrafts((all) => {
        const next = new Map(all);
        const value = typeof text === 'function' ? text(all.get(chatId) ?? '') : text;
        if (value === '') next.delete(chatId);
        else next.set(chatId, value);
        return next;
      }),
    [],
  );
  const value = useMemo(() => ({ inbox, setInbox, drafts, setDraft }), [inbox, setInbox, drafts, setDraft]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

function useUiState(): UiState {
  const state = useContext(Context);
  if (!state) throw new Error('needs a <UiStateProvider> above it (routes/Shell/Shell.tsx)');
  return state;
}

/** The inbox's tab, search and filters, kept while a chat is open. */
export function useInboxUi(): [InboxUi, UiState['setInbox']] {
  const { inbox, setInbox } = useUiState();
  return [inbox, setInbox];
}

/** The note you're writing in this chat, kept while you look at another. */
export function useDraft(chatId: string): [string, (text: string | ((current: string) => string)) => void] {
  const { drafts, setDraft } = useUiState();
  const set = useCallback((text: string | ((current: string) => string)) => setDraft(chatId, text), [chatId, setDraft]);
  return [drafts.get(chatId) ?? '', set];
}
