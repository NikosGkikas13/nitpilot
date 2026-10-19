import type { ChatResponse, InboxRow, ServerToWeb, TimelineItem } from '@nitpilot/protocol';
import type { QueryClient } from '@tanstack/react-query';
import { progressKey } from './progress';

/**
 * Two lists of timeline items as one, each `seq` once, in order (spec §10 "Resuming without gaps": after a
 * reconnect the server may send an item the tab already has).
 */
export function mergeItems(existing: TimelineItem[], incoming: TimelineItem[]): TimelineItem[] {
  const bySeq = new Map<number, TimelineItem>();
  for (const item of [...existing, ...incoming]) bySeq.set(item.seq, item);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

/**
 * Write a message from `/ws/web` into the data cache, where the screens read it: a chat's items and view, the
 * progress line, the inbox rows, who you are. Nothing else changes the cache but REST answers.
 */
export function applyServerMessage(queryClient: QueryClient, msg: ServerToWeb): void {
  switch (msg.t) {
    case 'chat.items':
      updateChat(queryClient, msg.d.chatId, (chat) => ({ ...chat, items: mergeItems(chat.items, msg.d.items) }));
      return;
    case 'chat.state':
      updateChat(queryClient, msg.d.chatId, (chat) => ({ ...chat, view: msg.d.view }));
      // Nobody's at work any more: the progress line goes.
      if (msg.d.view.activity.kind !== 'agent_working') queryClient.setQueryData(progressKey(msg.d.chatId), null);
      return;
    case 'chat.error':
      // GitHub couldn't be asked right now: the chat on screen stays, and the socket asks again itself (live/socket.ts).
      if (msg.d.code === 'unavailable') return;
      // Otherwise ask again over REST, which says what's wrong: a 404 ("Nothing here") or a 401 (sign in with GitHub again).
      void queryClient.invalidateQueries({ queryKey: ['chat'], predicate: (q) => (q.state.data as ChatResponse | undefined)?.view.id === msg.d.chatId });
      return;
    case 'job.progress':
      queryClient.setQueryData(progressKey(msg.d.chatId), msg.d);
      return;
    case 'inbox.upsert':
      queryClient.setQueryData<InboxRow[]>(['inbox'], (rows) => rows && [...rows.filter((r) => r.chatId !== msg.d.chatId), ...msg.d.rows]);
      return;
    case 'me.update':
      queryClient.setQueryData(['me'], msg.d.me);
      // Something about you changed (a device came or went, logged in, or was revoked): the Settings page's devices
      // may have too, and so may the setup checklist.
      void queryClient.invalidateQueries({ queryKey: ['devices'] });
      void queryClient.invalidateQueries({ queryKey: ['onboarding'] });
      return;
  }
}

/** The cached chat whose view has this id, whatever address it was opened by. */
function updateChat(queryClient: QueryClient, chatId: string, update: (chat: ChatResponse) => ChatResponse): void {
  queryClient.setQueriesData<ChatResponse>({ queryKey: ['chat'] }, (chat) => (chat && chat.view.id === chatId ? update(chat) : chat));
}
