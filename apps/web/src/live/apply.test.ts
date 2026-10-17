import type { ChatResponse, InboxRow, WebMe } from '@nitpilot/protocol';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { chatResponse, chatView, item } from '../test/chat';
import { applyServerMessage, mergeItems } from './apply';
import { progressKey } from './progress';

describe('mergeItems (Review Focus 1)', () => {
  it('keeps each seq once, in order, whatever order the batches come in', () => {
    const merged = mergeItems([item(1), item(2), item(3)], [item(5), item(3), item(4)]);
    expect(merged.map((i) => i.seq)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('applyServerMessage', () => {
  const key = ['chat', 'acme', 'shop-api', '142'];
  function cache() {
    const queryClient = new QueryClient();
    queryClient.setQueryData<ChatResponse>(key, chatResponse({ items: [item(1), item(2)] }));
    return queryClient;
  }

  it("adds a chat's new items to the chat opened by its address", () => {
    const queryClient = cache();
    applyServerMessage(queryClient, { v: 1, t: 'chat.items', d: { chatId: 'chat_142', items: [item(2), item(3)], lastSeq: 3 } });
    applyServerMessage(queryClient, { v: 1, t: 'chat.items', d: { chatId: 'another_chat', items: [item(9)], lastSeq: 9 } });
    expect(queryClient.getQueryData<ChatResponse>(key)!.items.map((i) => i.seq)).toEqual([1, 2, 3]);
  });

  it('replaces the view on chat.state, and clears the progress line once nobody is working', () => {
    const queryClient = cache();
    applyServerMessage(queryClient, { v: 1, t: 'job.progress', d: { chatId: 'chat_142', who: 'leo', action: 'reviewing', stage: 'running_agent', text: 'reading' } });
    expect(queryClient.getQueryData(progressKey('chat_142'))).toMatchObject({ who: 'leo' });
    applyServerMessage(queryClient, { v: 1, t: 'chat.state', d: { chatId: 'chat_142', view: chatView({ phase: 'ready', lastSeq: 2 }) } });
    expect(queryClient.getQueryData<ChatResponse>(key)!.view.phase).toBe('ready');
    expect(queryClient.getQueryData(progressKey('chat_142'))).toBeNull();
  });

  it("replaces a chat's inbox rows, and who you are", () => {
    const queryClient = cache();
    const row = (chatId: string, title: string) => ({ chatId, title }) as InboxRow;
    queryClient.setQueryData<InboxRow[]>(['inbox'], [row('a', 'old'), row('b', 'other')]);
    applyServerMessage(queryClient, { v: 1, t: 'inbox.upsert', d: { chatId: 'a', rows: [row('a', 'new')] } });
    expect(queryClient.getQueryData<InboxRow[]>(['inbox'])!.map((r) => r.title)).toEqual(['other', 'new']);
    applyServerMessage(queryClient, { v: 1, t: 'inbox.upsert', d: { chatId: 'b', rows: [] } });
    expect(queryClient.getQueryData<InboxRow[]>(['inbox'])!.map((r) => r.title)).toEqual(['new']);
    const me = { login: 'maya', agentOnline: true } as WebMe;
    applyServerMessage(queryClient, { v: 1, t: 'me.update', d: { me } });
    expect(queryClient.getQueryData(['me'])).toBe(me);
  });
});
