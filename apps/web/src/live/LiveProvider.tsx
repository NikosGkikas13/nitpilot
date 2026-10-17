import type { ChatResponse } from '@nitpilot/protocol';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useEffectEvent, useState, type ReactNode } from 'react';
import { applyServerMessage } from './apply';
import { LiveSocket, liveUrl, type SocketLike } from './socket';

/** Where the socket comes from: the browser's WebSocket, or a test's pretend one (test/render.tsx). */
export const SocketFactory = createContext<(url: string) => SocketLike>((url) => new WebSocket(url));

const Live = createContext<LiveSocket | null>(null);

/**
 * The tab's one `/ws/web` socket, for everything signed in (routes/Shell/Shell.tsx). What it receives goes into the
 * data cache; a closed session sends the tab back to the landing page.
 */
export function LiveProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const open = useContext(SocketFactory);
  const [live] = useState(
    () =>
      new LiveSocket({
        url: liveUrl(),
        open,
        onMessage: (msg) => applyServerMessage(queryClient, msg),
        onSignedOut: () => void queryClient.invalidateQueries({ queryKey: ['me'] }),
        // The socket only brings back missed items: read the chats' views again (REST merges, so no item is lost).
        onResume: (chatIds) =>
          void queryClient.invalidateQueries({ queryKey: ['chat'], predicate: (q) => chatIds.includes((q.state.data as ChatResponse | undefined)?.view.id ?? '') }),
      }),
  );
  useEffect(() => {
    live.start();
    return () => live.stop();
  }, [live]);
  return <Live.Provider value={live}>{children}</Live.Provider>;
}

/** Follow this chat's new items and changes while the screen shows it, starting after `afterSeq`. */
export function useLiveChat(chatId: string, afterSeq: number): void {
  const live = useContext(Live);
  // Only a new chat subscribes again: the socket keeps the newest seq itself from then on.
  const subscribe = useEffectEvent(() => live?.subscribe(chatId, afterSeq));
  useEffect(() => {
    if (!live) return;
    subscribe();
    return () => live.unsubscribe(chatId);
  }, [live, chatId]);
}
