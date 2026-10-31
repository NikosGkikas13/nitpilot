import { ChatResponse, FilesResponse, MessagesResponse, type InboxRow } from '@nitpilot/protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { mergeItems } from '../live/apply';
import { api } from './client';

/** Where a chat lives in the data cache: by its address, as the screen opens it. `/ws/web` finds it by its id (live/apply.ts). */
export const chatKey = (owner: string, repo: string, number: string) => ['chat', owner, repo, number] as const;

/**
 * A chat and its newest items (spec §10 `GET /api/chats/:owner/:repo/:number`). Kept fresh by `/ws/web`, and a REST
 * answer (on mount, on window focus, after a `chat.error`) is merged with what the socket and "Load earlier" already
 * put in the cache: that answer was read on the server before the items that arrived while it travelled.
 */
export function useChat(owner: string, repo: string, number: string) {
  const queryClient = useQueryClient();
  const key = chatKey(owner, repo, number);
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const fresh = await api.get(`/api/chats/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(number)}`, ChatResponse);
      // Read the cache only now, after the await, so items the socket added during the fetch are in it.
      return mergeWithCached(queryClient.getQueryData<ChatResponse>(key), fresh);
    },
  });
}

/** The fresh answer's view, with every item either side has; `hasOlder` follows whichever list reaches further back. */
function mergeWithCached(cached: ChatResponse | undefined, fresh: ChatResponse): ChatResponse {
  if (!cached || cached.view.id !== fresh.view.id) return fresh;
  const cachedFirst = cached.items[0]?.seq ?? Infinity;
  const freshFirst = fresh.items[0]?.seq ?? Infinity;
  return { view: fresh.view, items: mergeItems(cached.items, fresh.items), hasOlder: cachedFirst < freshFirst ? cached.hasOlder : fresh.hasOlder };
}

/**
 * A public repo's chat for someone who isn't signed in (spec §16 "Who can see a chat"): trimmed by the server, the
 * newest items only, and no live updates, so it's read once. A 404 means it isn't public (or doesn't exist).
 */
export function usePublicChat(owner: string, repo: string, number: string) {
  return useQuery({
    queryKey: ['public-chat', owner, repo, number],
    queryFn: () => api.get(`/api/public/chats/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(number)}`, ChatResponse),
  });
}

/** The page of items before `beforeSeq`, for "Load earlier". */
export function fetchOlderItems(chatId: string, beforeSeq: number): Promise<MessagesResponse> {
  return api.get(`/api/chats/${chatId}/messages?before=${beforeSeq}`, MessagesResponse);
}

/** The PR's changed files (spec §10 `GET /api/chats/:id/files`). The server keeps them per head commit, so asking again is cheap. */
export function useFiles(chatId: string) {
  return useQuery({ queryKey: ['files', chatId], queryFn: () => api.get(`/api/chats/${chatId}/files`, FilesResponse), staleTime: 60_000 });
}

/**
 * You've read the chat up to `seq` (spec §10 `POST /api/chats/:id/read`): once a second at most, while the tab is
 * visible, and only for someone in the chat (for anyone else there's no cursor to move). The inbox row's unread
 * count goes to 0 at once.
 */
export function useMarkRead(chatId: string, seq: number, participant: boolean): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!participant || seq === 0) return;
    const timer = setTimeout(() => {
      if (document.visibilityState !== 'visible') return;
      api
        .send('POST', `/api/chats/${chatId}/read`, { seq })
        .then(() => queryClient.setQueryData<InboxRow[]>(['inbox'], (rows) => rows?.map((r) => (r.chatId === chatId ? { ...r, unread: 0 } : r))))
        .catch(() => {});
    }, 1_000);
    return () => clearTimeout(timer);
  }, [chatId, seq, participant, queryClient]);
}
