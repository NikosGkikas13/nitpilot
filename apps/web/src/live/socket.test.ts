import type { ServerToWeb } from '@nitpilot/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { item } from '../test/chat';
import { fakeSockets } from '../test/socket';
import { LiveSocket, liveUrl } from './socket';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function start() {
  const sockets = fakeSockets();
  const received: ServerToWeb[] = [];
  const onSignedOut = vi.fn();
  // No jitter: random() 0.5 makes each wait exactly the backoff.
  const live = new LiveSocket({ url: 'ws://app/ws/web', onMessage: (m) => received.push(m), onSignedOut, open: sockets.open, backoff: { startMs: 1_000, maxMs: 30_000, random: () => 0.5 } });
  live.start();
  return { live, sockets, received, onSignedOut };
}

const items = (chatId: string, seqs: number[]): ServerToWeb => ({ v: 1, t: 'chat.items', d: { chatId, items: seqs.map((s) => item(s)), lastSeq: seqs.at(-1)! } });

describe('LiveSocket (spec §10 "Resuming without gaps")', () => {
  it('subscribes once open, and hands every message on', () => {
    const { live, sockets, received } = start();
    live.subscribe('chat_1', 4);
    sockets.last().open();
    expect(sockets.last().sent).toEqual([{ v: 1, t: 'chat.subscribe', d: { chatId: 'chat_1', afterSeq: 4 } }]);
    sockets.last().receive(items('chat_1', [5]));
    expect(received.map((m) => m.t)).toEqual(['chat.items']);
  });

  it('reconnects after a drop with a growing wait, and subscribes again from the newest item it has', () => {
    const { live, sockets } = start();
    sockets.last().open();
    live.subscribe('chat_1', 4);
    sockets.last().receive(items('chat_1', [5, 6]));
    sockets.last().drop();
    vi.advanceTimersByTime(999);
    expect(sockets.all).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets.all).toHaveLength(2);
    // That one never opens: the next wait is twice as long.
    sockets.last().drop();
    vi.advanceTimersByTime(2_000);
    expect(sockets.all).toHaveLength(3);
    sockets.last().open();
    expect(sockets.last().sent).toEqual([{ v: 1, t: 'chat.subscribe', d: { chatId: 'chat_1', afterSeq: 6 } }]);
    // Opening reset the wait to 1 s.
    sockets.last().drop();
    vi.advanceTimersByTime(1_000);
    expect(sockets.all).toHaveLength(4);
  });

  it('stops for good when the session ended (4401), and when stopped', () => {
    const { live, sockets, onSignedOut } = start();
    sockets.last().open();
    sockets.last().drop(4401);
    vi.advanceTimersByTime(60_000);
    expect(onSignedOut).toHaveBeenCalledOnce();
    expect(sockets.all).toHaveLength(1);
    live.stop();
  });

  it('forgets a chat the server refused, and asks again for one GitHub could not check', () => {
    const { live, sockets } = start();
    sockets.last().open();
    live.subscribe('gone', 0);
    live.subscribe('later', 0);
    sockets.last().receive({ v: 1, t: 'chat.error', d: { chatId: 'gone', code: 'not_found' } });
    sockets.last().receive({ v: 1, t: 'chat.error', d: { chatId: 'later', code: 'unavailable' } });
    sockets.last().sent.length = 0;
    vi.advanceTimersByTime(5_000);
    expect(sockets.last().sent).toEqual([{ v: 1, t: 'chat.subscribe', d: { chatId: 'later', afterSeq: 0 } }]);
    sockets.last().drop();
    vi.advanceTimersByTime(1_000);
    sockets.last().open();
    expect(sockets.last().sent.map((m) => m.d.chatId)).toEqual(['later']);
  });

  it('unsubscribes', () => {
    const { live, sockets } = start();
    sockets.last().open();
    live.subscribe('chat_1', 0);
    live.unsubscribe('chat_1');
    expect(sockets.last().sent.at(-1)).toEqual({ v: 1, t: 'chat.unsubscribe', d: { chatId: 'chat_1' } });
  });
});

describe('liveUrl', () => {
  it('is /ws/web on the same address, over wss: for an https: page', () => {
    expect(liveUrl({ protocol: 'https:', host: 'nitpilot.dev' })).toBe('wss://nitpilot.dev/ws/web');
    expect(liveUrl({ protocol: 'http:', host: 'localhost:5173' })).toBe('ws://localhost:5173/ws/web');
  });
});
